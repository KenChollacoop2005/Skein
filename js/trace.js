import { advance } from './sensors.js';
import { normalizeLayout, bounds } from './store.js';

export const WALL_GAP = 0.8; // meters between your path and the wall
export const SIMPLIFY = 1.0; // outline corner tolerance in meters
export const BAY_WIDTH = 1.22; // one 4 ft shelf bay in meters
export const AISLE_WIDTH = 2.1; // default walkway width
export const ZONE_PAD = 1.5; // zone size around its marks
const MARGIN = 1; // meters from the origin after shifting

// Department marks and how they map to Kroger data
export const DEPARTMENTS = {
  Produce: { match: ['PRODUCE', 'FRUIT', 'VEGETABLES'], cold: false, bays: 25 },
  Bakery: { match: ['BAKERY'], cold: false, bays: 6 },
  Deli: { match: ['DELI'], cold: true, bays: 12 },
  Meat: { match: ['MEAT'], cold: true, bays: 40 },
  Seafood: { match: ['SEAFOOD'], cold: true, bays: 10 },
  Dairy: { match: ['DAIRY'], cold: true, bays: 40 },
  Pharmacy: { match: ['PHARMACY'], cold: false, bays: 4 },
  Checklanes: { match: ['CHECKLANE'], cold: false, bays: 12 }
};

export function newWalk(stepLength, snap = true) {
  return { version: 1, started: new Date().toISOString(), stepLength, snap, startHeading: null, exit: { steps: 0, side: 'right' }, steps: [], marks: [] };
}

// Position after each step, starting at the entrance
export function positions(walk) {
  const pts = [[0, 0]];
  for (const s of walk.steps) pts.push(advance(pts[pts.length - 1], s.h, walk.stepLength));
  return pts;
}

export function markAt(walk, type, extra = {}) {
  const m = { type, step: walk.steps.length, t: Date.now(), ...extra };
  walk.marks.push(m);
  return m;
}

// Spread the loop error over the perimeter walk
export function closeLoop(points, end, target) {
  const err = [points[end][0] - target[0], points[end][1] - target[1]];
  const dist = [0];
  for (let i = 1; i < points.length; i++) dist.push(dist[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = dist[end] || 1;
  return points.map((p, i) => {
    const f = i <= end ? dist[i] / total : 1;
    return [p[0] - err[0] * f, p[1] - err[1] * f];
  });
}

// Ramer, Douglas and Peucker line simplification
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// Push each corner outward by d meters
export function offsetOutline(poly, d) {
  const n = poly.length;
  const sign = signedArea(poly) > 0 ? 1 : -1;
  const normal = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-9;
    return [(sign * dy) / l, (-sign * dx) / l];
  };
  return poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p), n2 = normal(p, poly[(i + 1) % n]);
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) return [p[0] + n1[0] * d, p[1] + n1[1] * d];
    mx /= ml; my /= ml;
    const k = d / Math.max(0.3, mx * n1[0] + my * n1[1]);
    return [p[0] + mx * k, p[1] + my * k];
  });
}

// Drop repeated closing corners
function tidy(poly) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) out.push(p);
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.3) out.pop();
  return out;
}

const round = p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

// Turn a recorded walk into a store layout
export function buildLayout(walk) {
  const raw = positions(walk);
  const notes = [];
  const report = { steps: walk.steps.length, closure: null, perimeter: 0, aisles: 0, registers: 0, warnings: [] };
  const endMark = walk.marks.find(m => m.type === 'perimeter-end');
  let pts = raw;
  let outline = [];
  if (endMark && endMark.step >= 4) {
    const side = walk.exit?.side === 'left' ? -1 : 1;
    const target = [side * (walk.exit?.steps || 0) * walk.stepLength, 0];
    const e = raw[endMark.step];
    report.closure = Math.hypot(e[0] - target[0], e[1] - target[1]);
    pts = closeLoop(raw, endMark.step, target);
    const loop = pts.slice(0, endMark.step + 1);
    for (let i = 1; i < loop.length; i++) report.perimeter += Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]);
    outline = tidy(offsetOutline(tidy(simplify(loop, SIMPLIFY)), WALL_GAP));
    if (outline.length < 3) report.warnings.push('The perimeter walk is too short to make an outline.');
  } else {
    report.warnings.push('No finished perimeter walk yet.');
  }
  const at = m => pts[Math.min(m.step, pts.length - 1)];

  const registers = walk.marks.filter(m => m.type === 'register').map(at);
  report.registers = registers.length;

  const aisles = [];
  let open = null;
  for (const m of walk.marks) {
    if (m.type === 'aisle-start') open = m;
    else if (m.type === 'aisle-end' && open) {
      const start = at(open), end = at(m);
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (len < 1) report.warnings.push(`Aisle ${open.number} was shorter than 1 m, so it was left out.`);
      else aisles.push({ number: String(open.number), start, end, width: AISLE_WIDTH, shelf: 0.6, bays: Math.max(1, Math.round(len / BAY_WIDTH)), bay1: 'start', flip: false, cold: false });
      open = null;
    }
  }
  report.aisles = aisles.length;

  const zoneMarks = new Map();
  for (const m of walk.marks.filter(x => x.type === 'zone')) {
    if (!zoneMarks.has(m.label)) zoneMarks.set(m.label, []);
    zoneMarks.get(m.label).push(at(m));
  }
  const zones = [...zoneMarks.entries()].map(([name, picks]) => {
    const b = bounds(picks);
    const d = DEPARTMENTS[name] || { match: [name.toUpperCase()], cold: false, bays: 0 };
    const polygon = [[b.x0 - ZONE_PAD, b.y0 - ZONE_PAD], [b.x1 + ZONE_PAD, b.y0 - ZONE_PAD], [b.x1 + ZONE_PAD, b.y1 + ZONE_PAD], [b.x0 - ZONE_PAD, b.y1 + ZONE_PAD]];
    return { name, match: d.match, cold: d.cold, bays: d.bays, polygon, picks };
  });
  for (const m of walk.marks.filter(x => x.type === 'note')) notes.push({ label: m.label, point: at(m) });

  // Shift so the store sits at positive coordinates
  const all = [...outline, [0, 0], ...registers, ...aisles.flatMap(a => [a.start, a.end]), ...zones.flatMap(z => z.polygon)];
  const box = bounds(all);
  const dx = MARGIN - box.x0, dy = MARGIN - box.y0;
  const shift = p => round([p[0] + dx, p[1] + dy]);
  const layout = normalizeLayout({
    name: 'Kroger - University City (traced)',
    placeholder: false,
    outline: outline.map(shift),
    entrance: shift([0, 0]),
    registers: registers.map(shift),
    aisles: aisles.map(a => ({ ...a, start: shift(a.start), end: shift(a.end) })),
    zones: zones.map(z => ({ ...z, polygon: z.polygon.map(shift), picks: z.picks.map(shift) })),
    obstacles: []
  });
  return { layout, report, notes: notes.map(n => ({ ...n, point: shift(n.point) })), path: pts.map(shift) };
}
