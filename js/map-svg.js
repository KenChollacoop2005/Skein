import { aisleShelves, aisleFrame, bounds, centroid } from './store.js';

const NS = 'http://www.w3.org/2000/svg';
const MARGIN = 1.5; // meters around the outline
const TINTS = ['#E4E8D6', '#EFE3D0', '#EADBD3', '#DCE2E8', '#E8E0EC', '#E6E4D3', '#DDE6E2', '#ECE4D8']; // faint zone fills

export function el(tag, attrs = {}, parent = null, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

export const pts = list => list.map(p => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`).join(' ');
export const pathD = list => list.map((p, i) => `${i ? 'L' : 'M'}${+p[0].toFixed(2)} ${+p[1].toFixed(2)}`).join('');

export function viewBoxFor(L) {
  const b = bounds(L.outline && L.outline.length ? L.outline : [[0, 0], [60, 45]]);
  return [b.x0 - MARGIN, b.y0 - MARGIN, b.x1 - b.x0 + 2 * MARGIN, b.y1 - b.y0 + 2 * MARGIN];
}

// Draws the store plan into an svg element
export function drawStore(svg, L, opts = {}) {
  const { labels = true, problems = new Set(), selected = null } = opts;
  svg.replaceChildren();
  if (!opts.keepViewBox) svg.setAttribute('viewBox', viewBoxFor(L).join(' '));
  const g = el('g', { class: 'plan' }, svg);
  if (L.outline && L.outline.length > 2) {
    el('polygon', { points: pts(L.outline), fill: '#FBF8F2', stroke: '#24221F', 'stroke-width': 0.15 }, g);
  } else if (L.outline && L.outline.length) {
    el('polyline', { points: pts(L.outline), fill: 'none', stroke: '#24221F', 'stroke-width': 0.15, 'stroke-dasharray': '0.4 0.3' }, g);
  }
  (L.zones || []).forEach((z, i) => {
    if (!z.polygon || z.polygon.length < 2) return;
    const sel = selected && selected.kind === 'zone' && selected.index === i;
    el('polygon', {
      points: pts(z.polygon), fill: TINTS[i % TINTS.length], stroke: sel ? '#B23B2E' : '#D8D0C2',
      'stroke-width': sel ? 0.2 : 0.08, 'data-kind': 'zone', 'data-index': i
    }, g);
  });
  (L.obstacles || []).forEach((o, i) => {
    if (!o.polygon || o.polygon.length < 2) return;
    const sel = selected && selected.kind === 'obstacle' && selected.index === i;
    el('polygon', { points: pts(o.polygon), fill: '#D8D0C2', stroke: sel ? '#B23B2E' : '#5E5850', 'stroke-width': sel ? 0.2 : 0.06, 'data-kind': 'obstacle', 'data-index': i }, g);
  });
  (L.aisles || []).forEach((a, i) => {
    const bad = problems.has(i);
    const sel = selected && selected.kind === 'aisle' && selected.index === i;
    for (const s of aisleShelves(a)) {
      el('polygon', { points: pts(s), fill: '#E2DACB', stroke: bad ? '#B23B2E' : '#24221F', 'stroke-width': bad || sel ? 0.18 : 0.06,
        'stroke-dasharray': bad ? '0.3 0.2' : null, 'data-kind': 'aisle', 'data-index': i }, g);
    }
    const f = aisleFrame(a);
    if (sel) {
      const walk = [[f.sx, f.sy], [f.sx + f.ux * f.len, f.sy + f.uy * f.len]];
      el('polyline', { points: pts(walk), stroke: '#B23B2E', 'stroke-width': 0.12, 'stroke-dasharray': '0.3 0.3', fill: 'none' }, g);
    }
    if (labels) {
      const front = a.bay1 === 'end' ? 1 : 0;
      const lx = f.sx + f.ux * f.len * (front ? 0.97 : 0.03) + (front ? -f.ux : f.ux) * 0.6;
      const ly = f.sy + f.uy * f.len * (front ? 0.97 : 0.03) + (front ? -f.uy : f.uy) * 0.6;
      el('text', { x: f.sx - f.ux * 0.9, y: f.sy - f.uy * 0.9, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 1.0, 'font-weight': 700, fill: '#24221F', 'pointer-events': 'none' }, g, a.number);
      if (sel) {
        el('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 0.8, fill: '#B23B2E' }, g, '1');
        const side = a.flip ? -1 : 1;
        const mx = f.sx + f.ux * f.len / 2 + f.lx * side * (f.w / 2 + f.shelf + 0.8);
        const my = f.sy + f.uy * f.len / 2 + f.ly * side * (f.w / 2 + f.shelf + 0.8);
        el('text', { x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 0.9, 'font-weight': 700, fill: '#B23B2E' }, g, 'L');
      }
    }
  });
  if (labels) {
    for (const z of L.zones || []) {
      if (!z.polygon || z.polygon.length < 3) continue;
      const [cx, cy] = centroid(z.polygon);
      const b = bounds(z.polygon);
      const tall = b.y1 - b.y0 > (b.x1 - b.x0) * 1.5;
      el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: tall ? `rotate(-90 ${cx} ${cy})` : null,
        'font-size': 1.1, fill: '#5E5850', stroke: '#FBF8F2', 'stroke-width': 0.3, 'paint-order': 'stroke', 'pointer-events': 'none' }, g, z.name);
    }
  }
  (L.zones || []).forEach((z, zi) => (z.picks || []).forEach((p, pi) => {
    el('circle', { cx: p[0], cy: p[1], r: 0.25, fill: '#5E5850', 'data-kind': 'pick', 'data-index': zi, 'data-sub': pi }, g);
  }));
  const marks = el('g', { class: 'marks' }, svg);
  (L.registers || []).forEach((r, i) => {
    el('rect', { x: r[0] - 0.45, y: r[1] - 0.45, width: 0.9, height: 0.9, fill: '#3B4A6B', 'data-kind': 'register', 'data-index': i }, marks);
  });
  if (L.entrance) {
    const [x, y] = L.entrance;
    el('path', { d: `M${x - 0.8} ${y + 0.6}L${x} ${y - 0.7}L${x + 0.8} ${y + 0.6}Z`, fill: '#24221F', 'data-kind': 'entrance' }, marks);
    if (labels) el('text', { x: x + 1.2, y: y + 0.1, 'font-size': 1.0, 'dominant-baseline': 'middle', fill: '#24221F' }, marks, 'In');
  }
  return { plan: g, marks, route: el('g', { class: 'route' }, svg), top: el('g', { class: 'overlay' }, svg) };
}

// The route as a twisted thread
export function drawThread(parent, line, width = 0.5) {
  const d = pathD(line);
  const g = el('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent);
  el('path', { d, stroke: '#8E2E24', 'stroke-width': width * 1.25 }, g);
  el('path', { d, stroke: '#B23B2E', 'stroke-width': width }, g);
  el('path', { d, stroke: '#E9A497', 'stroke-width': width * 0.3, 'stroke-dasharray': `${width * 0.9} ${width * 1.1}`, opacity: 0.8 }, g);
  return g;
}

export function drawStopMarker(parent, p, label, opts = {}) {
  const r = opts.r || 0.95;
  const g = el('g', {}, parent);
  el('circle', { cx: p[0], cy: p[1], r, fill: opts.fill || '#B23B2E', stroke: '#FBF8F2', 'stroke-width': 0.18 }, g);
  el('text', { x: p[0], y: p[1] + 0.05, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': r * 1.15,
    'font-weight': 700, fill: '#fff', 'font-family': 'Atkinson Hyperlegible, sans-serif' }, g, label);
  return g;
}
