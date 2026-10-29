import { drawStore, drawThread, drawStopMarker, el, viewBoxFor } from './map-svg.js';

const MARK_SCALE = 55; // store widths per marker radius
const THREAD_SCALE = 140; // store widths per thread width

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const meters = m => `${Math.round(m)} m`;

export function minutes(length, speed) {
  const min = length / speed / 60;
  return min < 1 ? 'under 1 min' : `${Math.round(min)} min`;
}

// Store map with the route thread
export function drawPlanMap(svg, L, plan) {
  const layers = drawStore(svg, L);
  if (!plan) return layers;
  const w = viewBoxFor(L)[2];
  const mr = Math.max(0.95, w / MARK_SCALE);
  drawThread(layers.route, plan.line, Math.max(0.55, w / THREAD_SCALE));
  plan.stops.forEach((s, i) => {
    const g = drawStopMarker(layers.top, s.point, String(i + 1), { r: mr });
    if (s.approx) el('circle', { cx: s.point[0], cy: s.point[1], r: mr * 1.35, fill: 'none', stroke: '#B23B2E', 'stroke-width': mr * 0.12, 'stroke-dasharray': `${mr * 0.3} ${mr * 0.25}` }, g);
  });
  const r = plan.registerPoint;
  if (r) {
    const k = Math.max(1, w / 60);
    el('rect', { x: r[0] - 0.8 * k, y: r[1] - 0.8 * k, width: 1.6 * k, height: 1.6 * k, rx: 0.3 * k, fill: '#3B4A6B', stroke: '#FBF8F2', 'stroke-width': 0.15 * k }, layers.top);
    el('text', { x: r[0], y: r[1] + 2.0 * k, 'text-anchor': 'middle', 'font-size': 1.0 * k, 'font-weight': 700, fill: '#3B4A6B' }, layers.top, 'Out');
  }
  return layers;
}

export function renderTotals(box, plan, speed) {
  box.replaceChildren();
  if (!plan) return;
  const add = (label, value) => {
    const d = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = value;
    d.append(b, label);
    box.appendChild(d);
  };
  add('walking', meters(plan.length));
  add('at your pace', minutes(plan.length, speed));
  add(plan.stops.length === 1 ? 'stop' : 'stops', String(plan.stops.length));
  const notes = document.createElement('p');
  notes.className = 'small totals-note';
  const saved = plan.baseline - plan.length;
  const parts = [];
  if (saved >= 1) parts.push(`<span class="saved">Saved ${meters(saved)} compared with walking aisle order.</span>`);
  parts.push(plan.exact ? 'This is the shortest route for this map.' : `Near optimal: within ${Math.max(0.1, plan.gap * 100).toFixed(1)} percent of the best possible.`);
  notes.innerHTML = parts.join(' ');
  box.appendChild(notes);
}

export function renderStops(list, plan) {
  list.replaceChildren();
  if (!plan) return;
  const item = (num, cls, title, where, leg) => {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = `num ${cls}`;
    n.textContent = num;
    const body = document.createElement('div');
    const t = document.createElement('div');
    if (cls !== 'end') {
      const box = document.createElement('span');
      box.className = 'box';
      t.appendChild(box);
    }
    t.append(title);
    const w = document.createElement('div');
    w.className = 'where';
    w.textContent = where;
    body.append(t, w);
    const l = document.createElement('span');
    l.className = 'leg';
    l.textContent = leg;
    li.append(n, body, l);
    list.appendChild(li);
  };
  plan.stops.forEach((s, i) => item(String(i + 1), '', s.items.map(cap).join(', '), s.where + (s.approx ? ' (approximate)' : ''), meters(plan.legs[i])));
  item('', 'end', `Register ${plan.register + 1}`, 'Check out', meters(plan.legs[plan.legs.length - 1]));
}
