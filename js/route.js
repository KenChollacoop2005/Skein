export const EXACT_MAX = 16; // most stops for the exact solver
const RESTARTS = 8; // heuristic random restarts
const BOUND_ROUNDS = 120; // subgradient rounds for the lower bound
const EPS = 1e-9;

// Seeded random numbers
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// D: node distances; start, stops, ends: node ids
export function makeProblem({ D, start, stops, ends, cold = [], aisle = [], penalty = 0, coldLast = false }) {
  const n = stops.length;
  const isCold = stops.map((_, i) => coldLast && !!cold[i]);
  const ais = stops.map((_, i) => (aisle[i] == null ? null : aisle[i]));
  const pen = (j, i) => (penalty && ais[j] != null && (i < 0 || ais[i] !== ais[j]) ? penalty : 0);
  const C = Array.from({ length: n }, (_, i) => stops.map((s, j) => D[stops[i]][s] + pen(j, i)));
  const S = stops.map((s, j) => D[start][s] + pen(j, -1));
  const E = new Array(n), endOf = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity, arg = ends[0];
    for (const e of ends) if (D[stops[i]][e] < best) { best = D[stops[i]][e]; arg = e; }
    E[i] = best; endOf[i] = arg;
  }
  let direct = Infinity, directEnd = ends[0];
  for (const e of ends) if (D[start][e] < direct) { direct = D[start][e]; directEnd = e; }
  return { D, start, stops, ends, n, C, S, E, endOf, direct, directEnd, cold: isCold, aisle: ais, penalty };
}

export function isValidOrder(P, order) {
  if (order.length !== P.n || new Set(order).size !== P.n) return false;
  let seenCold = false;
  for (const i of order) {
    if (P.cold[i]) seenCold = true;
    else if (seenCold) return false;
  }
  return true;
}

export function cost(P, order) {
  if (!order.length) return P.direct;
  let c = P.S[order[0]];
  for (let k = 1; k < order.length; k++) c += P.C[order[k - 1]][order[k]];
  return c + P.E[order[order.length - 1]];
}

// True walking legs, penalty left out
export function evaluate(P, order, method = '') {
  const nodes = [P.start, ...order.map(i => P.stops[i])];
  const end = order.length ? P.endOf[order[order.length - 1]] : P.directEnd;
  nodes.push(end);
  const legs = [];
  for (let k = 1; k < nodes.length; k++) legs.push(P.D[nodes[k - 1]][nodes[k]]);
  return { method, order: [...order], end, nodes, legs, length: legs.reduce((a, b) => a + b, 0), cost: cost(P, order) };
}

// Held and Karp, fixed start, open end
export function heldKarp(P) {
  const n = P.n;
  if (n === 0) return { ...evaluate(P, [], 'exact'), exact: true };
  if (n > EXACT_MAX + 4) throw new Error('Too many stops for the exact solver.');
  const full = (1 << n) - 1;
  let warmMask = 0;
  for (let i = 0; i < n; i++) if (!P.cold[i]) warmMask |= 1 << i;
  const size = (full + 1) * n;
  const dp = new Float64Array(size).fill(Infinity);
  const par = new Int8Array(size).fill(-1);
  for (let j = 0; j < n; j++) if (!P.cold[j] || warmMask === 0) dp[(1 << j) * n + j] = P.S[j];
  for (let mask = 1; mask <= full; mask++) {
    const base = mask * n;
    const warmDone = (mask & warmMask) === warmMask;
    for (let j = 0; j < n; j++) {
      const cur = dp[base + j];
      if (cur === Infinity) continue;
      const row = P.C[j];
      for (let k = 0; k < n; k++) {
        const bit = 1 << k;
        if (mask & bit) continue;
        if (P.cold[k] && !warmDone) continue;
        const idx = (mask | bit) * n + k;
        const v = cur + row[k];
        if (v < dp[idx]) { dp[idx] = v; par[idx] = j; }
      }
    }
  }
  let best = Infinity, last = -1;
  for (let j = 0; j < n; j++) {
    const v = dp[full * n + j] + P.E[j];
    if (v < best) { best = v; last = j; }
  }
  const order = [];
  let mask = full, j = last;
  while (j >= 0) {
    order.push(j);
    const pj = par[mask * n + j];
    mask &= ~(1 << j);
    j = pj;
  }
  order.reverse();
  return { ...evaluate(P, order, 'exact'), exact: true };
}

export function nearestNeighbor(P) {
  const left = new Set(Array.from({ length: P.n }, (_, i) => i));
  const order = [];
  let cur = -1;
  while (left.size) {
    const warmLeft = [...left].some(i => !P.cold[i]);
    let best = -1, bestD = Infinity;
    for (const i of left) {
      if (warmLeft && P.cold[i]) continue;
      const d = cur < 0 ? P.S[i] : P.C[cur][i];
      if (d < bestD - EPS) { bestD = d; best = i; }
    }
    order.push(best);
    left.delete(best);
    cur = best;
  }
  return evaluate(P, order, 'nearest');
}

// Walk stops in a given key order
export function keyOrder(P, keys, method = 'aisle') {
  const idx = Array.from({ length: P.n }, (_, i) => i);
  idx.sort((a, b) => (P.cold[a] - P.cold[b]) || (keys[a] - keys[b]) || (a - b));
  return evaluate(P, idx, method);
}

function improve(P, order) {
  let best = order.slice();
  let bestCost = cost(P, best);
  let better = true;
  while (better) {
    better = false;
    // 2-opt segment reversal
    for (let i = 0; i < best.length - 1 && !better; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        if (!isValidOrder(P, cand)) continue;
        const c = cost(P, cand);
        if (c < bestCost - EPS) { best = cand; bestCost = c; better = true; break; }
      }
    }
    if (better) continue;
    // Or-opt segment moves
    for (let len = 1; len <= 3 && !better; len++) {
      for (let i = 0; i + len <= best.length && !better; i++) {
        const seg = best.slice(i, i + len);
        const rest = best.slice(0, i).concat(best.slice(i + len));
        for (let k = 0; k <= rest.length && !better; k++) {
          if (k === i) continue;
          for (const s of len > 1 ? [seg, seg.slice().reverse()] : [seg]) {
            const cand = rest.slice(0, k).concat(s, rest.slice(k));
            if (!isValidOrder(P, cand)) continue;
            const c = cost(P, cand);
            if (c < bestCost - EPS) { best = cand; bestCost = c; better = true; break; }
          }
        }
      }
    }
  }
  return best;
}

function randomStart(P, rand) {
  const warm = [], coldList = [];
  for (let i = 0; i < P.n; i++) (P.cold[i] ? coldList : warm).push(i);
  const shuffle = a => {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  return shuffle(warm).concat(shuffle(coldList));
}

// Nearest neighbor plus 2-opt and Or-opt with restarts
export function heuristic(P, { restarts = RESTARTS, seed = 1 } = {}) {
  if (P.n === 0) return evaluate(P, [], 'heuristic');
  const rand = rng(seed);
  let best = improve(P, nearestNeighbor(P).order);
  let bestCost = cost(P, best);
  for (let r = 0; r < restarts; r++) {
    const cand = improve(P, randomStart(P, rand));
    const c = cost(P, cand);
    if (c < bestCost - EPS) { best = cand; bestCost = c; }
  }
  return { ...evaluate(P, best, 'heuristic'), exact: false };
}

// Spanning tree bound with node penalties
export function lowerBound(P) {
  const n = P.n;
  if (n === 0) return P.direct;
  // nodes: 0 start, 1..n stops, n+1 end
  const N = n + 2;
  const w = (a, b) => {
    if (a > b) [a, b] = [b, a];
    if (a === 0 && b === N - 1) return P.direct;
    if (a === 0) return P.S[b - 1];
    if (b === N - 1) return P.E[a - 1];
    return Math.min(P.C[a - 1][b - 1], P.C[b - 1][a - 1]);
  };
  const target = i => (i === 0 || i === N - 1 ? 1 : 2);
  const pi = new Float64Array(N);
  let best = 0;
  const ub = cost(P, nearestNeighbor(P).order);
  let step = 2 * ub / N;
  for (let round = 0; round < BOUND_ROUNDS; round++) {
    const inTree = new Uint8Array(N), key = new Float64Array(N).fill(Infinity), deg = new Int32Array(N);
    const parent = new Int32Array(N).fill(-1);
    key[0] = 0;
    let total = 0;
    for (let it = 0; it < N; it++) {
      let u = -1;
      for (let v = 0; v < N; v++) if (!inTree[v] && (u < 0 || key[v] < key[u])) u = v;
      inTree[u] = 1;
      total += key[u];
      if (parent[u] >= 0) { deg[u]++; deg[parent[u]]++; }
      for (let v = 0; v < N; v++) {
        if (inTree[v]) continue;
        const d = w(u, v) + pi[u] + pi[v];
        if (d < key[v]) { key[v] = d; parent[v] = u; }
      }
    }
    let sumPi = 0;
    for (let i = 0; i < N; i++) sumPi += pi[i] * target(i);
    const value = total - sumPi;
    if (value > best) best = value;
    let norm = 0;
    for (let i = 0; i < N; i++) norm += (deg[i] - target(i)) ** 2;
    if (norm === 0) break;
    for (let i = 0; i < N; i++) pi[i] += step * (deg[i] - target(i));
    step *= 0.95;
  }
  return Math.min(best, ub);
}

// Pick the solver by list size
export function solve(P, opts = {}) {
  if (P.n <= EXACT_MAX) return { ...heldKarp(P), bound: null };
  const res = heuristic(P, opts);
  const bound = lowerBound(P);
  return { ...res, bound, gap: bound > 0 ? Math.max(0, res.cost / bound - 1) : 0 };
}
