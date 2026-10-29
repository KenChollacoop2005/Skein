import { advance } from './sensors.js';
import { normalizeLayout, bounds } from './store.js';
import { DEPARTMENTS, sectionInfo } from './departments.js';

export const WALL_GAP = 0.8; // meters between your path and the wall
export const SIMPLIFY = 1.0; // outline corner tolerance in meters
export const BAY_WIDTH = 1.22; // one 4 ft shelf bay in meters
export const AISLE_WIDTH = 2.1; // default walkway width
export const SHELF = 0.6; // shelf depth each side
export const MIN_WALKWAY = 1.2; // narrowest walkway allowed
export const ZONE_PAD = 1.5; // zone size around its marks
const MARGIN = 1; // meters from the origin after shifting

export const ARRANGE = { lineUp: true, even: true, fill: true }; // default aisle cleanup

export function newWalk(stepLength, snap = 90, rows = 1) {
  return { version: 2, started: new Date().toISOString(), stepLength, snap, rows, startHeading: null, exit: { steps: 0, side: 'right' }, steps: [], marks: [] };
}

// Snap angle from old and new walk files
export const snapStep = walk => (walk.snap === true ? 90 : walk.snap === false ? 0 : Number(walk.snap) || 0);

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

function rdp(pts, a, b, tol, keep) {
  const stack = [[a, b]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [x1, y1] = pts[i0], [x2, y2] = pts[i1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let best = -1, bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
}

// Ramer, Douglas and Peucker, with corners you marked kept
export function simplify(pts, tol, corners = []) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  const fixed = [...new Set([0, pts.length - 1, ...corners.filter(i => i > 0 && i < pts.length - 1)])].sort((a, b) => a - b);
  for (const i of fixed) keep[i] = 1;
  for (let k = 1; k < fixed.length; k++) rdp(pts, fixed[k - 1], fixed[k], tol, keep);
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
const dot = (p, u) => p[0] * u[0] + p[1] * u[1];
const median = list => { const s = [...list].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Split aisles into rows at the biggest gap
function rowGroups(aisles, rows, u) {
  if (rows < 2 || aisles.length < 2) return [aisles];
  const mids = aisles.map(a => ({ a, m: (dot(a.start, u) + dot(a.end, u)) / 2 })).sort((x, y) => x.m - y.m);
  let cut = 1, gap = -1;
  for (let i = 1; i < mids.length; i++) if (mids[i].m - mids[i - 1].m > gap) { gap = mids[i].m - mids[i - 1].m; cut = i; }
  return [mids.slice(0, cut).map(x => x.a), mids.slice(cut).map(x => x.a)];
}

// Line up, space and fill in walked aisles
export function arrangeAisles(aisles, rows = 1, opts = ARRANGE) {
  const o = { ...ARRANGE, ...opts };
  if (!aisles.length || !(o.lineUp || o.even || o.fill)) return { aisles, filled: [] };
  let ux = 0, uy = 0;
  const first = [aisles[0].end[0] - aisles[0].start[0], aisles[0].end[1] - aisles[0].start[1]];
  for (const a of aisles) {
    let dx = a.end[0] - a.start[0], dy = a.end[1] - a.start[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const s = dx * first[0] + dy * first[1] < 0 ? -1 : 1;
    ux += s * dx; uy += s * dy;
  }
  const ul = Math.hypot(ux, uy) || 1;
  const u = [ux / ul, uy / ul], n = [-u[1], u[0]];
  const out = [], filled = [];
  for (const group of rowGroups(aisles, rows, u)) {
    const info = group.map(a => {
      const flip = (a.end[0] - a.start[0]) * u[0] + (a.end[1] - a.start[1]) * u[1] < 0;
      const s = dot(flip ? a.end : a.start, u), e = dot(flip ? a.start : a.end, u);
      return { a, flip, s, e, p: (dot(a.start, n) + dot(a.end, n)) / 2, num: parseFloat(a.number) };
    });
    const front = median(info.map(i => i.s)), back = median(info.map(i => i.e));
    const numbered = info.filter(i => Number.isFinite(i.num));
    let fit = null;
    if (numbered.length >= 2) {
      const mx = numbered.reduce((t, i) => t + i.num, 0) / numbered.length;
      const my = numbered.reduce((t, i) => t + i.p, 0) / numbered.length;
      let sxy = 0, sxx = 0;
      for (const i of numbered) { sxy += (i.num - mx) * (i.p - my); sxx += (i.num - mx) ** 2; }
      if (sxx > 0) fit = { b: sxy / sxx, a: my - (sxy / sxx) * mx };
    }
    const pitch = fit ? Math.abs(fit.b) : null;
    const width = pitch ? Math.max(MIN_WALKWAY, Math.min(AISLE_WIDTH, pitch - 2 * SHELF - 0.1)) : null;
    const place = (base, p, s, e, flip) => {
      const A = [u[0] * s + n[0] * p, u[1] * s + n[1] * p], B = [u[0] * e + n[0] * p, u[1] * e + n[1] * p];
      const len = Math.abs(e - s);
      return { ...base, start: flip ? B : A, end: flip ? A : B, width: width ?? base.width, bays: Math.max(1, Math.round(len / BAY_WIDTH)) };
    };
    for (const i of info) {
      const p = o.even && fit && Number.isFinite(i.num) ? fit.a + fit.b * i.num : i.p;
      out.push(place(i.a, p, o.lineUp ? front : i.s, o.lineUp ? back : i.e, i.flip));
    }
    if (o.fill && fit) {
      const have = new Set(numbered.map(i => i.num));
      const lo = Math.min(...have), hi = Math.max(...have);
      for (let k = Math.ceil(lo); k <= hi; k++) {
        if (have.has(k)) continue;
        out.push(place({ ...numbered[0].a, number: String(k) }, fit.a + fit.b * k, front, back, numbered[0].flip));
        filled.push(String(k));
      }
    }
  }
  out.sort((x, y) => (parseFloat(x.number) || 0) - (parseFloat(y.number) || 0));
  return { aisles: out, filled };
}

// Zones from department marks, with fallbacks for unmarked ones
export function zonesFrom(marks, at) {
  const byLabel = new Map();
  for (const m of marks.filter(x => x.type === 'zone')) {
    const info = m.match ? { label: m.label, match: m.match, cold: !!m.cold, bays: m.bays || 0, base: m.base || null } : sectionInfo(m.label, m.number);
    if (!byLabel.has(info.label)) byLabel.set(info.label, { ...info, picks: [] });
    byLabel.get(info.label).picks.push(at(m));
  }
  const zones = [...byLabel.values()];
  const marked = name => zones.find(z => z.base === name && z.label === name) || zones.find(z => z.base === name);
  // Marked zone that takes a department's items
  const homeOf = (name, seen = new Set()) => {
    if (seen.has(name)) return null;
    seen.add(name);
    const own = marked(name);
    if (own) return own;
    const d = DEPARTMENTS.find(x => x.name === name);
    return (d?.parent && homeOf(d.parent, seen)) || zones.find(z => DEPARTMENTS.find(c => c.name === z.base)?.parent === name) || null;
  };
  for (const d of DEPARTMENTS) {
    if (marked(d.name) || !d.match.length) continue;
    const home = homeOf(d.name);
    if (home) home.match = [...new Set([...home.match, ...d.match])];
  }
  return zones.map(z => {
    const b = bounds(z.picks);
    const polygon = [[b.x0 - ZONE_PAD, b.y0 - ZONE_PAD], [b.x1 + ZONE_PAD, b.y0 - ZONE_PAD], [b.x1 + ZONE_PAD, b.y1 + ZONE_PAD], [b.x0 - ZONE_PAD, b.y1 + ZONE_PAD]];
    return { name: z.label, match: z.match, cold: z.cold, bays: z.bays, polygon, picks: z.picks };
  });
}

// Turn a recorded walk into a store layout
export function buildLayout(walk, opts = ARRANGE) {
  const raw = positions(walk);
  const report = { steps: walk.steps.length, closure: null, perimeter: 0, aisles: 0, filled: [], registers: 0, warnings: [] };
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
    const corners = walk.marks.filter(m => m.type === 'corner' && m.step <= endMark.step).map(m => m.step);
    outline = tidy(offsetOutline(tidy(simplify(loop, SIMPLIFY, corners)), WALL_GAP));
    if (outline.length < 3) report.warnings.push('The perimeter walk is too short to make an outline.');
  } else {
    report.warnings.push('No finished perimeter walk yet.');
  }
  const at = m => pts[Math.min(m.step, pts.length - 1)];

  const registers = walk.marks.filter(m => m.type === 'register').map(at);
  report.registers = registers.length;

  const walked = [];
  let open = null;
  for (const m of walk.marks) {
    if (m.type === 'aisle-start') open = m;
    else if (m.type === 'aisle-end' && open) {
      const start = at(open), end = at(m);
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (len < 1) report.warnings.push(`Aisle ${open.number} was shorter than 1 m, so it was left out.`);
      else walked.push({ number: String(open.number), start, end, width: AISLE_WIDTH, shelf: SHELF, bays: Math.max(1, Math.round(len / BAY_WIDTH)), bay1: 'start', flip: false, cold: false });
      open = null;
    }
  }
  const { aisles, filled } = arrangeAisles(walked, walk.rows || 1, opts);
  report.aisles = walked.length;
  report.filled = filled;

  const zones = zonesFrom(walk.marks, at);
  const notes = walk.marks.filter(x => x.type === 'note').map(m => ({ label: m.label, point: at(m) }));

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
