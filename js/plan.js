import * as S from './store.js';
import { gridGraph, allPairs } from './graph.js';
import { makeProblem, solve, keyOrder, heldKarp, heuristic, nearestNeighbor, EXACT_MAX } from './route.js';
import { guessDepartment, MATCH_MIN } from './match.js';

export const TURN_PENALTY = 12; // meters charged per aisle entry
export const WALK_SPEED = 0.9; // default walking speed m/s

export function prepare(layout) {
  const L = S.normalizeLayout(layout);
  const grid = S.buildGrid(L);
  return { L, grid, graph: gridGraph(grid) };
}

// Where one list line goes on the map
export function resolveSpot(L, { item = null, manual = null, line = '', alts = [] }) {
  if (manual) return { point: manual, where: 'Placed by you', cold: !!item?.cold, aisle: null, zone: null, approx: false, manual: true };
  const found = item ? S.locate(L, item.loc) : null;
  if (found) return { ...found, cold: found.cold || !!item.cold, approx: false };
  // Closest similar item with a real spot
  for (const a of alts) {
    if (a.score < MATCH_MIN || (item && a.item.id === item.id)) continue;
    const near = S.locate(L, a.item.loc);
    if (near) return { ...near, where: `${near.where}, near ${a.item.term}`, cold: near.cold || !!a.item.cold, approx: true };
  }
  const dept = guessDepartment(`${line} ${item ? item.name : ''}`);
  const zi = dept ? L.zones.findIndex(z => z.name.toLowerCase() === dept.toLowerCase()) : -1;
  if (zi >= 0) {
    const s = S.zoneSpot(L, zi);
    return { ...s, cold: s.cold || !!item?.cold, approx: true };
  }
  return null;
}

// Merge spots that share a grid cell
export function buildStops(ctx, spots) {
  const byCell = new Map();
  for (const s of spots) {
    const cell = S.snapCell(ctx.grid, s.point);
    if (cell < 0) continue;
    if (!byCell.has(cell)) byCell.set(cell, { cell, point: S.cellCenter(ctx.grid, cell), items: [], where: s.where, cold: false, aisle: s.aisle, approx: false });
    const stop = byCell.get(cell);
    stop.items.push(s.label);
    stop.cold = stop.cold || !!s.cold;
    stop.approx = stop.approx || !!s.approx;
    if (stop.aisle !== s.aisle) stop.aisle = stop.aisle ?? s.aisle;
  }
  return [...byCell.values()];
}

// Front to back, aisle by aisle walking order
export function aisleKeys(L, points) {
  const cols = [...new Set(L.aisles.map(a => Math.round(((a.start[0] + a.end[0]) / 2) * 2) / 2))].sort((a, b) => a - b);
  const outline = S.bounds(L.outline);
  const leftOf = cols.length ? cols[0] - 4 : outline.x0;
  const rightOf = cols.length ? cols[cols.length - 1] + 4 : outline.x1;
  const bands = [leftOf, ...cols, rightOf];
  return points.map(([x, y]) => {
    let band = 0, bestD = Infinity;
    bands.forEach((bx, i) => { const d = Math.abs(x - bx); if (d < bestD) { bestD = d; band = i; } });
    const yKey = band % 2 === 0 ? -y : y;
    return band * 1e4 + yKey;
  });
}

// Straight segments where the grid allows
export function smoothLine(grid, cells) {
  const pts = cells.map(c => S.cellCenter(grid, c));
  if (pts.length < 3) return pts;
  const clear = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / (grid.cell * 0.25));
    for (let k = 1; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
      for (const [ox, oy] of [[0, 0], [0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) {
        if (!grid.walk[S.cellOf(grid, [x + ox, y + oy])]) return false;
      }
    }
    return true;
  };
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// Distances between the entrance, stops and registers
export function distances(ctx, stops) {
  const { L, grid, graph } = ctx;
  const entrance = S.snapCell(grid, L.entrance);
  const regs = L.registers.map(r => S.snapCell(grid, r));
  const nodes = [entrance, ...stops.map(s => s.cell), ...regs];
  const ap = allPairs(graph, nodes);
  return { nodes, ap, start: 0, stopIds: stops.map((_, i) => i + 1), endIds: regs.map((_, i) => stops.length + 1 + i) };
}

export function problemFor(dist, stops, opts = {}) {
  return makeProblem({
    D: dist.ap.D, start: dist.start, stops: dist.stopIds, ends: dist.endIds,
    cold: stops.map(s => s.cold), aisle: stops.map(s => s.aisle),
    coldLast: !!opts.coldLast, penalty: opts.fewerTurns ? TURN_PENALTY : 0
  });
}

export function lineFor(ctx, dist, result) {
  const line = [];
  for (let k = 1; k < result.nodes.length; k++) {
    const seg = smoothLine(ctx.grid, dist.ap.path(result.nodes[k - 1], result.nodes[k]));
    line.push(...(line.length ? seg.slice(1) : seg));
  }
  return line;
}

// Full plan for a set of stops
export function planRoute(ctx, stops, opts = {}) {
  const dist = distances(ctx, stops);
  const P = problemFor(dist, stops, opts);
  const result = solve(P, { seed: 1 });
  const plain = opts.fewerTurns ? solve(problemFor(dist, stops, { ...opts, fewerTurns: false }), { seed: 1 }) : result;
  const P0 = problemFor(dist, stops, { coldLast: opts.coldLast });
  const baseline = keyOrder(P0, aisleKeys(ctx.L, stops.map(s => s.point)), 'aisle');
  const register = result.end - dist.endIds[0];
  return {
    stops: result.order.map(i => stops[i]),
    legs: result.legs,
    length: result.length,
    exact: !!result.exact,
    gap: result.gap ?? 0,
    register,
    registerPoint: ctx.L.registers[register],
    baseline: baseline.length,
    turnCost: opts.fewerTurns ? result.length - plain.length : 0,
    line: lineFor(ctx, dist, result),
    result,
    dist
  };
}

// Every method on the same stops
export function compareMethods(ctx, stops, opts = {}) {
  const dist = distances(ctx, stops);
  const P = problemFor(dist, stops, opts);
  const best = P.n <= EXACT_MAX ? heldKarp(P) : solve(P, { seed: 1 });
  return {
    dist, P,
    exact: { ...best, label: P.n <= EXACT_MAX ? 'Exact optimal' : 'Near optimal' },
    heuristic: heuristic(P, { seed: 1 }),
    nearest: nearestNeighbor(P),
    aisle: keyOrder(P, aisleKeys(ctx.L, stops.map(s => s.point)), 'aisle')
  };
}
