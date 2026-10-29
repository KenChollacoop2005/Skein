export const CELL = 0.5; // walk grid cell size in meters
export const DEFAULT_SHELF = 0.6; // shelf depth each side in meters
export const SIDE_INSET = 0.35; // stop point distance from shelf face
export const CLEARANCE = 0.3; // body clearance from shelves
const EPS = 0.01; // overlap tolerance in meters

// Geometry helpers

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

export function aisleFrame(a) {
  const [sx, sy] = a.start, [ex, ey] = a.end;
  const len = Math.hypot(ex - sx, ey - sy) || 1e-9;
  const ux = (ex - sx) / len, uy = (ey - sy) / len;
  // Walker's left with y pointing down
  const lx = uy, ly = -ux;
  return { sx, sy, ux, uy, lx, ly, len, w: a.width, shelf: a.shelf ?? DEFAULT_SHELF };
}

function rect(f, off0, off1) {
  const { sx, sy, ux, uy, lx, ly, len } = f;
  return [
    [sx + lx * off0, sy + ly * off0],
    [sx + lx * off1, sy + ly * off1],
    [sx + ux * len + lx * off1, sy + uy * len + ly * off1],
    [sx + ux * len + lx * off0, sy + uy * len + ly * off0]
  ];
}

export function aisleWalkway(a) {
  const f = aisleFrame(a);
  return rect(f, -f.w / 2, f.w / 2);
}

export function aisleShelves(a) {
  const f = aisleFrame(a);
  return [rect(f, f.w / 2, f.w / 2 + f.shelf), rect(f, -f.w / 2 - f.shelf, -f.w / 2)];
}

export function aisleFootprint(a) {
  const f = aisleFrame(a);
  return rect(f, -f.w / 2 - f.shelf, f.w / 2 + f.shelf);
}

function shrink(poly, d) {
  const [cx, cy] = centroid(poly);
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1;
    return [x - (dx / r) * d, y - (dy / r) * d];
  });
}

// Separating axis test for convex polygons
export function convexOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const [x, y] of a) { const p = x * nx + y * ny; amin = Math.min(amin, p); amax = Math.max(amax, p); }
      for (const [x, y] of b) { const p = x * nx + y * ny; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
      if (amax <= bmin || bmax <= amin) return false;
    }
  }
  return true;
}

export function bounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

// Lengths typed as meters or steps
export function parseLength(text, stepLength) {
  const m = String(text).trim().toLowerCase().match(/^(-?\d*\.?\d+)\s*(m|meters?|s|steps?)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return m[2] && m[2].startsWith('s') ? n * stepLength : n;
}

// Validation

export function validateLayout(L) {
  const problems = [];
  const add = (msg, ref) => problems.push({ msg, ref });
  const outline = L.outline || [];
  if (outline.length < 3) {
    add('Draw the store outline first.');
    return problems;
  }
  const inside = p => pointInPolygon(p, outline);
  const allInside = poly => poly.every(p => inside(p) || onEdge(p, outline));
  if (!L.entrance) add('Place the entrance.');
  else if (!inside(L.entrance)) add('The entrance is outside the outline.', { kind: 'entrance' });
  if (!L.registers || !L.registers.length) add('Place at least one register.');
  (L.registers || []).forEach((r, i) => { if (!inside(r)) add(`Register ${i + 1} is outside the outline.`, { kind: 'register', index: i }); });

  const seen = new Set();
  const feet = (L.aisles || []).map(a => aisleFootprint(a));
  (L.aisles || []).forEach((a, i) => {
    const ref = { kind: 'aisle', index: i };
    const name = `Aisle ${a.number || '?'}`;
    if (!String(a.number || '').trim()) add(`Aisle ${i + 1} needs a number.`, ref);
    else if (seen.has(String(a.number))) add(`${name} is used twice.`, ref);
    seen.add(String(a.number));
    if (!(a.width > 0)) add(`${name} needs a width above 0.`, ref);
    if (!(a.bays >= 1)) add(`${name} needs at least 1 bay.`, ref);
    if (aisleFrame(a).len < 1) add(`${name} is shorter than 1 m.`, ref);
    if (!allInside(feet[i])) add(`${name} sticks out of the outline.`, ref);
    for (let j = 0; j < i; j++) {
      if (convexOverlap(shrink(feet[i], EPS), shrink(feet[j], EPS))) add(`${name} overlaps aisle ${L.aisles[j].number}.`, ref);
    }
  });
  (L.zones || []).forEach((z, i) => {
    const ref = { kind: 'zone', index: i };
    if (!z.name) add(`Zone ${i + 1} needs a name.`, ref);
    if (!z.polygon || z.polygon.length < 3) add(`Zone ${z.name || i + 1} needs at least 3 corners.`, ref);
    if (!z.picks || !z.picks.length) add(`Zone ${z.name || i + 1} needs a pick point.`, ref);
    (z.picks || []).forEach(p => { if (!inside(p)) add(`A pick point of ${z.name} is outside the outline.`, ref); });
  });
  (L.obstacles || []).forEach((o, i) => {
    if (!o.polygon || o.polygon.length < 3) add(`Obstacle ${i + 1} needs at least 3 corners.`, { kind: 'obstacle', index: i });
  });
  return problems;
}

function nearEdge([x, y], poly, d) {
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) < d) return true;
  }
  return false;
}

function onEdge([x, y], poly) {
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    const t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (len * len);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    if (Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / len < 1e-6) return true;
  }
  return false;
}

// Walk grid

export function buildGrid(L, cell = CELL) {
  const b = bounds(L.outline);
  const cols = Math.max(1, Math.ceil((b.x1 - b.x0) / cell));
  const rows = Math.max(1, Math.ceil((b.y1 - b.y0) / cell));
  const walk = new Uint8Array(cols * rows);
  const blocks = [];
  const pad = Math.min(CLEARANCE, cell * 0.75);
  const addBlock = poly => {
    const b = bounds(poly);
    blocks.push({ poly, box: { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad } });
  };
  for (const a of L.aisles || []) for (const s of aisleShelves(a)) addBlock(s);
  for (const o of L.obstacles || []) if (o.polygon && o.polygon.length > 2) addBlock(o.polygon);
  for (let r = 0; r < rows; r++) {
    const y = b.y0 + (r + 0.5) * cell;
    for (let c = 0; c < cols; c++) {
      const x = b.x0 + (c + 0.5) * cell;
      if (!pointInPolygon([x, y], L.outline)) continue;
      let open = true;
      for (const k of blocks) {
        if (x < k.box.x0 || x > k.box.x1 || y < k.box.y0 || y > k.box.y1) continue;
        if (pointInPolygon([x, y], k.poly) || nearEdge([x, y], k.poly, pad)) { open = false; break; }
      }
      if (open) walk[r * cols + c] = 1;
    }
  }
  return { cell, x0: b.x0, y0: b.y0, cols, rows, walk };
}

export function cellOf(grid, [x, y]) {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.x0) / grid.cell)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.y0) / grid.cell)));
  return r * grid.cols + c;
}

export function cellCenter(grid, i) {
  const c = i % grid.cols, r = (i - c) / grid.cols;
  return [grid.x0 + (c + 0.5) * grid.cell, grid.y0 + (r + 0.5) * grid.cell];
}

// Nearest open cell by straight distance
export function snapCell(grid, p) {
  const start = cellOf(grid, p);
  if (grid.walk[start]) return start;
  const c0 = start % grid.cols, r0 = (start - c0) / grid.cols;
  const maxR = Math.max(grid.cols, grid.rows);
  for (let rad = 1; rad < maxR; rad++) {
    let best = -1, bestD = Infinity;
    for (let r = r0 - rad; r <= r0 + rad; r++) {
      for (let c = c0 - rad; c <= c0 + rad; c++) {
        if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue;
        const i = r * grid.cols + c;
        if (!grid.walk[i]) continue;
        const [x, y] = cellCenter(grid, i);
        const d = Math.hypot(x - p[0], y - p[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// Cells reachable from the entrance
export function reachable(grid, from) {
  const seen = new Uint8Array(grid.walk.length);
  if (from < 0) return seen;
  const stack = [from];
  seen[from] = 1;
  const { cols, rows, walk } = grid;
  while (stack.length) {
    const i = stack.pop();
    const c = i % cols, r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if ((!dr && !dc) || nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const j = nr * cols + nc;
      if (!walk[j] || seen[j]) continue;
      if (dr && dc && (!walk[r * cols + nc] || !walk[nr * cols + c])) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

// Points the route must reach
export function keyPoints(L) {
  const pts = [];
  if (L.entrance) pts.push({ label: 'Entrance', p: L.entrance });
  (L.registers || []).forEach((p, i) => pts.push({ label: `Register ${i + 1}`, p }));
  for (const z of L.zones || []) (z.picks || []).forEach((p, i) => pts.push({ label: `${z.name} pick ${i + 1}`, p }));
  for (const a of L.aisles || []) {
    for (const bay of [1, a.bays]) for (const side of ['L', 'R']) pts.push({ label: `Aisle ${a.number} bay ${bay}`, p: aislePoint(a, bay, side) });
  }
  return pts;
}

export function checkReachable(L, grid) {
  const problems = [];
  if (!L.entrance) return problems;
  const seen = reachable(grid, snapCell(grid, L.entrance));
  for (const k of keyPoints(L)) {
    const i = snapCell(grid, k.p);
    if (i < 0 || !seen[i]) problems.push({ msg: `${k.label} can't be reached from the entrance.` });
  }
  return problems;
}

// Item placement

export function aislePoint(a, bay, side) {
  const f = aisleFrame(a);
  const n = Math.max(1, a.bays || 1);
  const b = Math.min(n, Math.max(1, Number(bay) || Math.ceil(n / 2)));
  let t = (b - 0.5) / n;
  if (a.bay1 === 'end') t = 1 - t;
  let off = 0;
  if (side === 'L' || side === 'R') {
    off = Math.max(0, f.w / 2 - SIDE_INSET) * (side === 'L' ? 1 : -1) * (a.flip ? -1 : 1);
  }
  return [f.sx + f.ux * f.len * t + f.lx * off, f.sy + f.uy * f.len * t + f.ly * off];
}

function polylinePoint(pts, t) {
  if (pts.length === 1) return pts[0];
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(d); total += d; }
  let goal = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (goal <= lens[i] || i === lens.length - 1) {
      const u = lens[i] ? Math.min(1, goal / lens[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
    }
    goal -= lens[i];
  }
  return pts[pts.length - 1];
}

// Pick index for a bay, or the middle one
export function zonePickIndex(z, bay) {
  const picks = z.picks || [];
  if (picks.length <= 1) return 0;
  const b = Number(bay);
  let target;
  if (b > 0 && z.bays > 0) target = polylinePoint(picks, Math.min(1, (Math.min(b, z.bays) - 0.5) / z.bays));
  else target = centroid(picks);
  let best = 0, bestD = Infinity;
  picks.forEach((p, i) => {
    const d = Math.hypot(p[0] - target[0], p[1] - target[1]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

export function findZone(L, text) {
  const t = String(text || '').toUpperCase();
  if (!t) return -1;
  return (L.zones || []).findIndex(z => (z.match || []).some(m => m && t.includes(String(m).toUpperCase())));
}

// Catalog location to a map spot
export function locate(L, loc) {
  if (!loc) return null;
  const zi = findZone(L, loc.description);
  if (zi >= 0) {
    const z = L.zones[zi];
    const pi = zonePickIndex(z, loc.bay);
    return { point: z.picks[pi], zone: zi, pick: pi, aisle: null, cold: !!z.cold, where: z.name };
  }
  const num = String(loc.number || '').trim();
  const hit = num && num !== '0' ? (L.aisles || []).findIndex(a => String(a.number) === num) : -1;
  if (hit >= 0) {
    const a = L.aisles[hit];
    const bay = loc.bay ? `, bay ${loc.bay}` : '';
    return { point: aislePoint(a, loc.bay, loc.side), zone: null, aisle: hit, cold: !!a.cold, where: `Aisle ${a.number}${bay}` };
  }
  return null;
}

export function zoneSpot(L, zi) {
  const z = L.zones[zi];
  const pi = zonePickIndex(z);
  return { point: z.picks[pi], zone: zi, pick: pi, aisle: null, cold: !!z.cold, where: z.name };
}

// Fill defaults on an imported layout
export function normalizeLayout(raw) {
  const L = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw || {}));
  const point = p => (Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null);
  const poly = list => (Array.isArray(list) ? list.map(point).filter(Boolean) : []);
  return {
    version: 1,
    name: String(L.name || 'Store'),
    placeholder: !!L.placeholder,
    units: 'm',
    outline: poly(L.outline),
    entrance: point(L.entrance),
    registers: poly(L.registers),
    aisles: (L.aisles || []).map(a => ({
      number: String(a.number ?? ''),
      start: point(a.start) || [0, 0],
      end: point(a.end) || [0, 1],
      width: Number(a.width) || 2,
      shelf: Number.isFinite(Number(a.shelf)) ? Number(a.shelf) : DEFAULT_SHELF,
      bays: Math.max(1, Math.round(Number(a.bays) || 1)),
      bay1: a.bay1 === 'end' ? 'end' : 'start',
      flip: !!a.flip,
      cold: !!a.cold
    })),
    zones: (L.zones || []).map(z => ({
      name: String(z.name || ''),
      match: (z.match || []).map(String).filter(Boolean),
      cold: !!z.cold,
      bays: Math.max(0, Math.round(Number(z.bays) || 0)),
      polygon: poly(z.polygon),
      picks: poly(z.picks)
    })),
    obstacles: (L.obstacles || []).map(o => ({ name: String(o.name || ''), polygon: poly(o.polygon) }))
  };
}
