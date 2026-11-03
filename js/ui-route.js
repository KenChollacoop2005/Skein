import { drawStore, drawThread, drawStopMarker, el, viewBoxFor, pathD } from './map-svg.js';
import { pointAt, trailTo } from './follow.js';

const MARK_SCALE = 55; // store widths per marker radius
const THREAD_SCALE = 140; // store widths per thread width

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const meters = m => `${Math.round(m)} m`;

export function minutes(length, speed) {
  const min = length / speed / 60;
  return min < 1 ? 'under 1 min' : `${Math.round(min)} min`;
}

// Store map with the route thread and stop markers
export function drawPlanMap(svg, L, plan, trip = null) {
  const layers = drawStore(svg, L);
  if (!plan) return layers;
  const w = viewBoxFor(L)[2];
  const mr = Math.max(0.95, w / MARK_SCALE);
  const tw = Math.max(0.55, w / THREAD_SCALE);
  drawThread(layers.route, plan.line, tw);
  layers.trail = el('g', { class: 'trail', 'pointer-events': 'none' });
  svg.insertBefore(layers.trail, layers.top);
  const next = trip ? trip.next() : -1;
  plan.stops.forEach((s, i) => {
    const done = trip && trip.stopDone(i);
    const g = drawStopMarker(layers.top, s.point, String(i + 1), { r: mr, fill: done ? '#3B4A6B' : '#B23B2E' });
    g.setAttribute('data-stop', i);
    g.setAttribute('class', `stop-mark${done ? ' done' : ''}`);
    if (s.approx && !done) el('circle', { cx: s.point[0], cy: s.point[1], r: mr * 1.35, fill: 'none', stroke: '#B23B2E', 'stroke-width': mr * 0.12, 'stroke-dasharray': `${mr * 0.3} ${mr * 0.25}` }, g);
    if (i === next) el('circle', { cx: s.point[0], cy: s.point[1], r: mr * 1.6, fill: 'none', stroke: '#24221F', 'stroke-width': mr * 0.16 }, g);
  });
  layers.you = el('g', { class: 'you', 'pointer-events': 'none' }, svg);
  layers.scale = { mr, tw };
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

// Stop list with a checkbox for every item
export function renderStops(list, plan, trip = null, onItem = null) {
  list.replaceChildren();
  if (!plan) return;
  const next = trip ? trip.next() : -1;
  const item = (num, cls, title, where, leg, stop = -1) => {
    const li = document.createElement('li');
    if (stop >= 0 && trip) li.className = trip.stopDone(stop) ? 'done' : stop === next ? 'next' : '';
    const n = document.createElement('span');
    n.className = `num ${cls}`;
    n.textContent = num;
    const body = document.createElement('div');
    body.className = 'stop-body';
    const t = document.createElement('div');
    if (stop >= 0) {
      plan.stops[stop].items.forEach((name, j) => {
        const lab = document.createElement('label');
        lab.className = 'item-check';
        const box = document.createElement('span');
        box.className = 'box';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'no-print';
        input.checked = !!(trip && trip.checked[stop][j]);
        input.addEventListener('change', () => onItem && onItem(stop, j));
        lab.append(input, box, cap(name));
        t.appendChild(lab);
      });
    } else {
      t.append(title);
    }
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
  plan.stops.forEach((s, i) => item(String(i + 1), trip && trip.stopDone(i) ? 'done' : '', '', s.where + (s.approx ? ' (approximate)' : ''), meters(plan.legs[i]), i));
  item('', 'end', `Register ${plan.register + 1}`, 'Check out', meters(plan.legs[plan.legs.length - 1]));
}

// Walked part of the route and the you marker
export function drawLive(layers, track, trip) {
  if (!layers || !layers.trail) return;
  const { mr, tw } = layers.scale;
  layers.trail.replaceChildren();
  layers.you.replaceChildren();
  if (trip.d > 0.05) {
    el('path', { d: pathD(trailTo(track, trip.d)), fill: 'none', stroke: '#3B4A6B', 'stroke-width': tw * 1.05, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layers.trail);
  }
  const { p, heading } = pointAt(track, trip.d);
  const k = mr * 1.1;
  el('circle', { cx: p[0], cy: p[1], r: k * 1.15, fill: '#FBF8F2', stroke: '#24221F', 'stroke-width': k * 0.18 }, layers.you);
  el('path', { d: `M0 ${-k * 0.85}L${k * 0.6} ${k * 0.6}L0 ${k * 0.25}L${-k * 0.6} ${k * 0.6}Z`, fill: '#24221F', transform: `translate(${p[0]} ${p[1]}) rotate(${heading})` }, layers.you);
}
