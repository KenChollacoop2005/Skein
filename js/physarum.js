import { buildGrid, snapCell, cellCenter } from './store.js';
import { rng, evaluate } from './route.js';

// Tero network model settings
export const TERO = {
  cell: 1.0, // graph spacing in meters
  steps: 260, // adaptation steps
  flow: 2.0, // total flow I0 per step
  gamma: 1.8, // flux response exponent
  dt: 0.35, // time step
  cgTol: 1e-6, // solver tolerance
  cgMax: 600 // solver iteration cap
};

// Jones agent model settings
export const JONES = {
  cell: 0.25, // raster cell in meters
  sensorAngle: Math.PI / 4, // SA
  turnAngle: Math.PI / 4, // RA
  sensorOffset: 9, // SO in cells
  deposit: 5, // trail left per move
  decay: 0.1, // trail lost per step
  food: 12, // chemoattractant per food cell
  spawnPerStep: 60 // agents added per step
};

// 4-connected graph on a coarse walk grid
export function moldGraph(L, cell = TERO.cell) {
  const grid = buildGrid(L, cell);
  const { cols, rows, walk } = grid;
  const id = new Int32Array(cols * rows).fill(-1);
  const cells = [];
  for (let i = 0; i < walk.length; i++) if (walk[i]) { id[i] = cells.length; cells.push(i); }
  const ea = [], eb = [];
  for (const c of cells) {
    const x = c % cols;
    if (x + 1 < cols && walk[c + 1]) { ea.push(id[c]); eb.push(id[c + 1]); }
    if (c + cols < walk.length && walk[c + cols]) { ea.push(id[c]); eb.push(id[c + cols]); }
  }
  return { grid, id, cells, n: cells.length, ea: Int32Array.from(ea), eb: Int32Array.from(eb), len: cell };
}

export function foodNodes(G, points) {
  return points.map(p => G.id[snapCell(G.grid, p)]);
}

// Tero, Kobayashi and Nakagaki adaptive tubes
export class TeroModel {
  constructor(G, food, { seed = 1, ...opts } = {}) {
    this.G = G;
    this.food = food;
    this.o = { ...TERO, ...opts };
    this.rand = rng(seed);
    const m = G.ea.length;
    this.D = new Float64Array(m);
    for (let e = 0; e < m; e++) this.D[e] = 0.5 + 0.5 * this.rand();
    this.p = new Float64Array(G.n);
    this.t = 0;
    this.ground = food[food.length - 1];
  }

  // Conjugate gradient on the weighted Laplacian
  solve(q) {
    const { G } = this;
    const n = G.n, m = G.ea.length;
    const w = new Float64Array(m);
    const diag = new Float64Array(n);
    for (let e = 0; e < m; e++) {
      w[e] = this.D[e] / G.len;
      diag[G.ea[e]] += w[e];
      diag[G.eb[e]] += w[e];
    }
    const g = this.ground;
    const A = (x, out) => {
      out.fill(0);
      for (let e = 0; e < m; e++) {
        const a = G.ea[e], b = G.eb[e], f = w[e] * (x[a] - x[b]);
        out[a] += f;
        out[b] -= f;
      }
      out[g] = x[g];
    };
    const x = this.p;
    x[g] = 0;
    const r = new Float64Array(n), z = new Float64Array(n), d = new Float64Array(n), Ad = new Float64Array(n);
    A(x, Ad);
    for (let i = 0; i < n; i++) r[i] = (i === g ? 0 : q[i]) - Ad[i];
    const pre = i => (i === g ? 1 : 1 / Math.max(diag[i], 1e-12));
    let rz = 0, bnorm = 0;
    for (let i = 0; i < n; i++) { z[i] = r[i] * pre(i); d[i] = z[i]; rz += r[i] * z[i]; bnorm += q[i] * q[i]; }
    const tol = this.o.cgTol * this.o.cgTol * Math.max(bnorm, 1e-30);
    for (let it = 0; it < this.o.cgMax; it++) {
      let rr = 0;
      for (let i = 0; i < n; i++) rr += r[i] * r[i];
      if (rr < tol) break;
      A(d, Ad);
      let dAd = 0;
      for (let i = 0; i < n; i++) dAd += d[i] * Ad[i];
      if (dAd <= 0) break;
      const alpha = rz / dAd;
      let rz2 = 0;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * d[i];
        r[i] -= alpha * Ad[i];
        z[i] = r[i] * pre(i);
        rz2 += r[i] * z[i];
      }
      const beta = rz2 / rz;
      rz = rz2;
      for (let i = 0; i < n; i++) d[i] = z[i] + beta * d[i];
    }
    return x;
  }

  step() {
    const { G, food, o } = this;
    const k = food.length;
    const src = food[Math.floor(this.rand() * k)];
    const q = new Float64Array(G.n);
    for (const f of food) q[f] -= o.flow / (k - 1);
    q[src] += o.flow + o.flow / (k - 1);
    const p = this.solve(q);
    for (let e = 0; e < G.ea.length; e++) {
      const Q = Math.abs((this.D[e] / G.len) * (p[G.ea[e]] - p[G.eb[e]]));
      const fq = Q ** o.gamma / (1 + Q ** o.gamma);
      this.D[e] += o.dt * (fq - this.D[e]);
    }
    this.t++;
  }

  run(steps = this.o.steps) {
    for (let s = 0; s < steps; s++) this.step();
    return this;
  }

  // Strongest tubes that still join every food source
  network() {
    const { G, food } = this;
    const m = G.ea.length;
    const order = Array.from({ length: m }, (_, e) => e).sort((a, b) => this.D[b] - this.D[a]);
    const parent = new Int32Array(G.n).map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    let joined = 1, threshold = 0;
    const foodSet = new Set(food);
    const groups = new Map(food.map(f => [f, 1]));
    for (const e of order) {
      const a = find(G.ea[e]), b = find(G.eb[e]);
      if (a === b) continue;
      parent[a] = b;
      const fa = groups.get(a) || 0, fb = groups.get(b) || 0;
      groups.delete(a);
      if (fa + fb) groups.set(b, fa + fb);
      joined = Math.max(joined, fa + fb);
      if (joined >= foodSet.size) { threshold = this.D[e]; break; }
    }
    const edges = [];
    for (let e = 0; e < m; e++) if (this.D[e] >= threshold) edges.push(e);
    return { edges, threshold, max: this.D[order[0]] };
  }
}

// Depth first tour of the surviving network
export function networkOrder(G, food, edges) {
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const e of edges) { link(G.ea[e], G.eb[e]); link(G.eb[e], G.ea[e]); }
  const root = food[0];
  const parent = new Map([[root, -1]]);
  const kids = new Map();
  const queue = [root];
  while (queue.length) {
    const u = queue.shift();
    for (const v of adj.get(u) || []) {
      if (parent.has(v)) continue;
      parent.set(v, u);
      if (!kids.has(u)) kids.set(u, []);
      kids.get(u).push(v);
      queue.push(v);
    }
  }
  const foodIndex = new Map();
  food.forEach((f, i) => { if (!foodIndex.has(f)) foodIndex.set(f, []); foodIndex.get(f).push(i); });
  const size = new Map();
  const count = u => {
    if (size.has(u)) return size.get(u);
    let s = 0;
    const stack = [u], post = [];
    while (stack.length) { const x = stack.pop(); post.push(x); for (const c of kids.get(x) || []) stack.push(c); }
    for (let i = post.length - 1; i >= 0; i--) {
      const x = post[i];
      let t = (foodIndex.get(x) || []).length;
      for (const c of kids.get(x) || []) t += size.get(c);
      size.set(x, t);
    }
    s = size.get(u);
    return s;
  };
  count(root);
  const order = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const u = stack.pop();
    for (const i of foodIndex.get(u) || []) if (i > 0 && !seen.has(i)) { seen.add(i); order.push(i - 1); }
    const ch = (kids.get(u) || []).filter(c => size.get(c) > 0).sort((a, b) => size.get(b) - size.get(a));
    for (const c of ch) stack.push(c);
  }
  return order;
}

// Mold route on the shared routing problem
export function moldRoute(L, P, stopPoints, opts = {}) {
  const G = opts.graph || moldGraph(L);
  const food = foodNodes(G, [L.entrance, ...stopPoints]);
  const model = new TeroModel(G, food, opts).run(opts.steps);
  const net = model.network();
  let order = networkOrder(G, food, net.edges);
  const missing = Array.from({ length: P.n }, (_, i) => i).filter(i => !order.includes(i));
  order = order.concat(missing);
  if (P.cold.some(Boolean)) order = order.filter(i => !P.cold[i]).concat(order.filter(i => P.cold[i]));
  const lines = net.edges.map(e => [cellCenter(G.grid, G.cells[G.ea[e]]), cellCenter(G.grid, G.cells[G.eb[e]])]);
  return { ...evaluate(P, order, 'mold'), network: net, lines, model, food };
}

// Jones agent model on a floor raster
export class JonesModel {
  constructor(L, foodPoints, { agents = 4000, seed = 1, ...opts } = {}) {
    this.o = { ...JONES, ...opts };
    const grid = buildGrid(L, this.o.cell);
    this.grid = grid;
    this.cols = grid.cols;
    this.rows = grid.rows;
    this.walk = grid.walk;
    this.trail = new Float32Array(grid.cols * grid.rows);
    this.next = new Float32Array(grid.cols * grid.rows);
    this.occupied = new Uint8Array(grid.cols * grid.rows);
    this.max = agents;
    this.n = 0;
    this.x = new Float32Array(agents);
    this.y = new Float32Array(agents);
    this.h = new Float32Array(agents);
    this.rand = rng(seed);
    this.food = foodPoints.map(p => snapCell(grid, p)).filter(i => i >= 0);
    this.start = this.food[0];
    this.t = 0;
  }

  spawn(count) {
    const sc = this.start % this.cols, sr = (this.start - sc) / this.cols;
    for (let k = 0; k < count && this.n < this.max; k++) {
      const x = sc + 0.5 + (this.rand() - 0.5) * 4, y = sr + 0.5 + (this.rand() - 0.5) * 4;
      const c = Math.floor(x), r = Math.floor(y);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || !this.walk[r * this.cols + c]) continue;
      this.x[this.n] = x;
      this.y[this.n] = y;
      this.h[this.n] = this.rand() * Math.PI * 2;
      this.n++;
    }
  }

  sense(i, angle) {
    const a = this.h[i] + angle;
    const c = Math.floor(this.x[i] + Math.cos(a) * this.o.sensorOffset);
    const r = Math.floor(this.y[i] + Math.sin(a) * this.o.sensorOffset);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    const j = r * this.cols + c;
    return this.walk[j] ? this.trail[j] : -1;
  }

  step() {
    const { o, cols, rows, walk, trail } = this;
    this.spawn(o.spawnPerStep);
    for (const f of this.food) {
      const fc = f % cols, fr = (f - fc) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const r = fr + dr, c = fc + dc;
        if (r >= 0 && c >= 0 && r < rows && c < cols && walk[r * cols + c]) trail[r * cols + c] += o.food;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const F = this.sense(i, 0), FL = this.sense(i, -o.sensorAngle), FR = this.sense(i, o.sensorAngle);
      if (F > FL && F > FR) { /* keep heading */ }
      else if (F < FL && F < FR) this.h[i] += (this.rand() < 0.5 ? -1 : 1) * o.turnAngle;
      else if (FL < FR) this.h[i] += o.turnAngle;
      else if (FR < FL) this.h[i] -= o.turnAngle;
      const nx = this.x[i] + Math.cos(this.h[i]), ny = this.y[i] + Math.sin(this.h[i]);
      const c = Math.floor(nx), r = Math.floor(ny);
      const from = Math.floor(this.y[i]) * cols + Math.floor(this.x[i]);
      const to = r * cols + c;
      if (c < 0 || r < 0 || c >= cols || r >= rows || !walk[to] || (to !== from && this.occupied[to])) {
        this.h[i] = this.rand() * Math.PI * 2;
        continue;
      }
      this.occupied[from] = 0;
      this.occupied[to] = 1;
      this.x[i] = nx;
      this.y[i] = ny;
      trail[to] += o.deposit;
    }
    // Diffuse with a 3 by 3 mean, then decay
    const next = this.next, keep = 1 - o.decay;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!walk[i]) { next[i] = 0; continue; }
        let s = 0, k = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= cols || !walk[rr * cols + cc]) continue;
            s += trail[rr * cols + cc];
            k++;
          }
        }
        next[i] = (s / k) * keep;
      }
    }
    this.next = trail;
    this.trail = next;
    this.t++;
  }
}
