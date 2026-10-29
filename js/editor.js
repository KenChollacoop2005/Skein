import * as S from './store.js';
import { drawStore, el, pts, viewBoxFor } from './map-svg.js';
import { load, save, registerWorker } from './storage.js';
import { generateLayout } from './layoutgen.js';

const SNAP = 0.25; // snap grid in meters
const TAP_PX = 8; // max finger travel for a tap
const MIN_ZOOM_W = 4; // smallest view width in meters
const HISTORY_MAX = 100; // undo steps kept
const DEFAULT_STEP = 0.7; // step length in meters

const $ = id => document.getElementById(id);
const svg = $('canvas');
const hints = {
  select: 'Tap a shape to edit it. Drag it to move it. Drag empty space to pan, pinch to zoom.',
  outline: 'Tap each corner of the store, then press Done.',
  entrance: 'Tap where you walk in.',
  register: 'Tap each register where the route can end.',
  aisle: 'Drag a box over one aisle, shelves included.',
  zone: 'Tap the corners of a department, then press Done.',
  pick: 'Tap spots along the selected zone where you would grab items, starting at bay 1.',
  obstacle: 'Tap the corners of something you can\'t walk through, then press Done.'
};

let L = null;
let past = [];
let future = [];
let tool = 'select';
let draft = [];
let dragBox = null;
let selected = null;
let view = null;
let stepLength = load('stepLength', DEFAULT_STEP);

const snap = v => Math.round(v / SNAP) * SNAP;
const fmt = v => +Number(v).toFixed(2);
const len = text => S.parseLength(text, stepLength);

async function init() {
  registerWorker();
  const saved = load('layout');
  L = saved ? S.normalizeLayout(saved) : await fetchShipped();
  view = viewBoxFor(L);
  $('step-len').value = stepLength;
  bindUI();
  render();
}

async function fetchShipped() {
  const res = await fetch('data/store.json');
  return S.normalizeLayout(await res.json());
}

function commit(change) {
  past.push(JSON.stringify(L));
  if (past.length > HISTORY_MAX) past.shift();
  future = [];
  change();
  persist();
  render();
}

function persist() {
  save('layout', L);
}

function undo() {
  if (!past.length) return;
  future.push(JSON.stringify(L));
  L = JSON.parse(past.pop());
  selected = null;
  persist();
  render();
}

function redo() {
  if (!future.length) return;
  past.push(JSON.stringify(L));
  L = JSON.parse(future.pop());
  selected = null;
  persist();
  render();
}

// Drawing

function render() {
  const problems = S.validateLayout(L);
  let reach = [];
  if (!problems.length || problems.every(p => p.ref)) {
    try { reach = L.outline.length > 2 ? S.checkReachable(L, S.buildGrid(L)) : []; } catch { reach = []; }
  }
  const bad = new Set(problems.filter(p => p.ref && p.ref.kind === 'aisle').map(p => p.ref.index));
  drawStore(svg, L, { problems: bad, selected, keepViewBox: true });
  svg.setAttribute('viewBox', view.join(' '));
  svg.insertBefore(gridLines(), svg.firstChild);
  const top = svg.querySelector('.overlay');
  if (draft.length) {
    el('polyline', { points: pts(draft), fill: 'none', stroke: '#B23B2E', 'stroke-width': 0.15, 'stroke-dasharray': '0.4 0.25' }, top);
    for (const p of draft) el('circle', { cx: p[0], cy: p[1], r: 0.3, fill: '#B23B2E' }, top);
  }
  if (dragBox) {
    const [x0, y0, x1, y1] = dragBox;
    el('rect', { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
      fill: 'rgba(178,59,46,0.12)', stroke: '#B23B2E', 'stroke-width': 0.12 }, top);
  }
  if (selected && (selected.kind === 'register' || selected.kind === 'entrance' || selected.kind === 'pick')) {
    const p = pointOf(selected);
    if (p) el('circle', { cx: p[0], cy: p[1], r: 0.8, fill: 'none', stroke: '#B23B2E', 'stroke-width': 0.18 }, top);
  }
  const list = $('problems');
  list.replaceChildren();
  for (const p of [...problems, ...reach]) {
    const li = document.createElement('li');
    if (p.ref) {
      const b = document.createElement('button');
      b.textContent = p.msg;
      b.className = 'linkish';
      b.addEventListener('click', () => { selected = { kind: p.ref.kind, index: p.ref.index ?? 0 }; render(); });
      li.appendChild(b);
    } else {
      li.textContent = p.msg;
    }
    list.appendChild(li);
  }
  if (!problems.length && !reach.length) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = 'No problems found.';
    list.appendChild(li);
  }
  $('layout-banner').hidden = !L.placeholder;
  $('placeholder-box').checked = L.placeholder;
  $('undo-btn').disabled = !past.length;
  $('redo-btn').disabled = !future.length;
  $('delete-btn').disabled = !selected;
  $('done-btn').hidden = !['outline', 'zone', 'obstacle'].includes(tool);
  $('hint').textContent = hints[tool];
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  renderProps();
}

function gridLines() {
  const g = el('g', { 'pointer-events': 'none' });
  const [vx, vy, vw, vh] = view;
  const step = vw > 120 ? 10 : vw > 40 ? 5 : 1;
  for (let x = Math.floor(vx / step) * step; x <= vx + vw; x += step) {
    el('line', { x1: x, y1: vy, x2: x, y2: vy + vh, stroke: x % 10 === 0 ? '#C9BFAE' : '#E2DACB', 'stroke-width': 0.04 }, g);
  }
  for (let y = Math.floor(vy / step) * step; y <= vy + vh; y += step) {
    el('line', { x1: vx, y1: y, x2: vx + vw, y2: y, stroke: y % 10 === 0 ? '#C9BFAE' : '#E2DACB', 'stroke-width': 0.04 }, g);
  }
  return g;
}

function pointOf(sel) {
  if (sel.kind === 'entrance') return L.entrance;
  if (sel.kind === 'register') return L.registers[sel.index];
  if (sel.kind === 'pick') return L.zones[sel.index]?.picks[sel.sub];
  return null;
}

// Properties panel

function field(parent, labelText, value, onChange, opts = {}) {
  const id = `f-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = document.createElement('div');
  wrap.className = 'grow';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = id;
  input.value = value;
  if (opts.numeric) input.inputMode = 'decimal';
  input.addEventListener('change', () => onChange(input.value));
  wrap.append(lab, input);
  parent.appendChild(wrap);
  return input;
}

function row(parent) {
  const r = document.createElement('div');
  r.className = 'row';
  parent.appendChild(r);
  return r;
}

function setNum(target, key, text, min = -Infinity) {
  const v = len(text);
  if (!Number.isFinite(v) || v < min) { render(); return; }
  commit(() => { target()[key] = fmt(v); });
}

function setPoint(getter, i, text) {
  const v = len(text);
  if (!Number.isFinite(v)) { render(); return; }
  commit(() => { getter()[i] = fmt(v); });
}

function renderProps() {
  const box = $('props');
  box.replaceChildren();
  box.className = 'stack';
  if (!selected) {
    box.innerHTML = '<p class="muted">Tap something on the map to edit it.</p>';
    return;
  }
  const { kind, index } = selected;
  const h = document.createElement('h3');
  box.appendChild(h);
  if (kind === 'aisle') {
    const a = () => L.aisles[index];
    if (!a()) return;
    h.textContent = `Aisle ${a().number}`;
    let r = row(box);
    field(r, 'Number', a().number, v => commit(() => { a().number = v.trim(); }));
    field(r, 'Bays', a().bays, v => setNum(a, 'bays', v, 1), { numeric: true });
    r = row(box);
    field(r, 'Walkway width', a().width, v => setNum(a, 'width', v, 0.3), { numeric: true });
    field(r, 'Shelf depth', a().shelf, v => setNum(a, 'shelf', v, 0), { numeric: true });
    r = row(box);
    field(r, 'Start x', a().start[0], v => setPoint(() => a().start, 0, v), { numeric: true });
    field(r, 'Start y', a().start[1], v => setPoint(() => a().start, 1, v), { numeric: true });
    r = row(box);
    field(r, 'End x', a().end[0], v => setPoint(() => a().end, 0, v), { numeric: true });
    field(r, 'End y', a().end[1], v => setPoint(() => a().end, 1, v), { numeric: true });
    const b1 = document.createElement('button');
    b1.textContent = `Bay 1 is at the ${a().bay1 === 'end' ? 'end' : 'start'} (red 1). Switch`;
    b1.addEventListener('click', () => commit(() => { a().bay1 = a().bay1 === 'end' ? 'start' : 'end'; }));
    const side = document.createElement('button');
    side.textContent = 'Swap L and R sides (red L)';
    side.addEventListener('click', () => commit(() => { a().flip = !a().flip; }));
    const cold = checkbox('Frozen or cold aisle', a().cold, v => commit(() => { a().cold = v; }));
    box.append(b1, side, cold);
    note(box, 'Start is the dashed end you drew first. Check two items on opposite sides in the store to set L.');
  } else if (kind === 'zone') {
    const z = () => L.zones[index];
    if (!z()) return;
    h.textContent = z().name || 'Zone';
    field(box, 'Name', z().name, v => commit(() => { z().name = v.trim(); }));
    field(box, 'Kroger descriptions it matches (comma separated)', z().match.join(', '),
      v => commit(() => { z().match = v.split(',').map(s => s.trim().toUpperCase()).filter(Boolean); }));
    field(box, 'Bays along the wall (0 if unknown)', z().bays, v => setNum(z, 'bays', v, 0), { numeric: true });
    box.append(checkbox('Cold department', z().cold, v => commit(() => { z().cold = v; })));
    note(box, `${z().picks.length} pick point${z().picks.length === 1 ? '' : 's'}.`);
    const r = row(box);
    const add = document.createElement('button');
    add.textContent = 'Add pick points';
    add.addEventListener('click', () => setTool('pick', true));
    const clear = document.createElement('button');
    clear.textContent = 'Clear pick points';
    clear.addEventListener('click', () => commit(() => { z().picks = []; }));
    r.append(add, clear);
  } else if (kind === 'obstacle') {
    const o = () => L.obstacles[index];
    if (!o()) return;
    h.textContent = o().name || 'Obstacle';
    field(box, 'Name', o().name, v => commit(() => { o().name = v.trim(); }));
  } else {
    const p = pointOf(selected);
    if (!p) return;
    h.textContent = kind === 'entrance' ? 'Entrance' : kind === 'register' ? `Register ${index + 1}` : `${L.zones[index].name} pick ${selected.sub + 1}`;
    const r = row(box);
    field(r, 'x', p[0], v => setPoint(() => pointOf(selected), 0, v), { numeric: true });
    field(r, 'y', p[1], v => setPoint(() => pointOf(selected), 1, v), { numeric: true });
  }
}

function checkbox(text, value, onChange) {
  const lab = document.createElement('label');
  lab.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  lab.append(input, ` ${text}`);
  return lab;
}

function note(parent, text) {
  const p = document.createElement('p');
  p.className = 'muted small';
  p.textContent = text;
  parent.appendChild(p);
}

// Tools

function setTool(t, keepSelection = false) {
  tool = t;
  draft = [];
  if (!keepSelection && t !== 'select') selected = t === 'pick' && selected?.kind === 'zone' ? selected : null;
  render();
}

function finishDraft() {
  if (tool === 'outline' && draft.length >= 3) {
    const d = draft;
    commit(() => { L.outline = d; });
  } else if (tool === 'zone' && draft.length >= 3) {
    const d = draft;
    commit(() => { L.zones.push({ name: `Zone ${L.zones.length + 1}`, match: [], cold: false, bays: 0, polygon: d, picks: [] }); });
    selected = { kind: 'zone', index: L.zones.length - 1 };
    tool = 'pick';
  } else if (tool === 'obstacle' && draft.length >= 3) {
    const d = draft;
    commit(() => { L.obstacles.push({ name: 'Obstacle', polygon: d }); });
    selected = { kind: 'obstacle', index: L.obstacles.length - 1 };
    tool = 'select';
  }
  draft = [];
  render();
}

function nextAisleNumber() {
  const nums = L.aisles.map(a => parseInt(a.number, 10)).filter(Number.isFinite);
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

function aisleFromBox([x0, y0, x1, y1]) {
  const shelf = S.DEFAULT_SHELF;
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (Math.max(w, h) < 1) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const tall = h >= w;
  const width = Math.max(0.8, (tall ? w : h) - 2 * shelf);
  const start = tall ? [fmt(cx), fmt(Math.max(y0, y1))] : [fmt(Math.min(x0, x1)), fmt(cy)];
  const end = tall ? [fmt(cx), fmt(Math.min(y0, y1))] : [fmt(Math.max(x0, x1)), fmt(cy)];
  return { number: nextAisleNumber(), start, end, width: fmt(width), shelf, bays: 20, bay1: 'start', flip: false, cold: false };
}

function tapAt(p, target) {
  const kind = target?.dataset?.kind;
  if (tool === 'select') {
    if (kind) {
      selected = { kind, index: Number(target.dataset.index || 0), sub: Number(target.dataset.sub || 0) };
    } else {
      selected = null;
    }
    render();
  } else if (tool === 'outline' || tool === 'zone' || tool === 'obstacle') {
    draft.push(p);
    render();
  } else if (tool === 'entrance') {
    commit(() => { L.entrance = p; });
  } else if (tool === 'register') {
    commit(() => { L.registers.push(p); });
  } else if (tool === 'pick') {
    if (!selected || selected.kind !== 'zone') {
      $('hint').textContent = 'Select a zone first, then add pick points.';
      return;
    }
    const zi = selected.index;
    commit(() => { L.zones[zi].picks.push(p); });
  }
}

function moveSelected(dx, dy, base) {
  const shift = list => list.map(([x, y]) => [fmt(x + dx), fmt(y + dy)]);
  const { kind, index } = selected;
  if (kind === 'aisle') {
    const a = L.aisles[index], b = base.aisles[index];
    a.start = shift([b.start])[0];
    a.end = shift([b.end])[0];
  } else if (kind === 'zone') {
    L.zones[index].polygon = shift(base.zones[index].polygon);
    L.zones[index].picks = shift(base.zones[index].picks);
  } else if (kind === 'obstacle') {
    L.obstacles[index].polygon = shift(base.obstacles[index].polygon);
  } else if (kind === 'entrance') {
    L.entrance = shift([base.entrance])[0];
  } else if (kind === 'register') {
    L.registers[index] = shift([base.registers[index]])[0];
  } else if (kind === 'pick') {
    L.zones[index].picks[selected.sub] = shift([base.zones[index].picks[selected.sub]])[0];
  }
}

function deleteSelected() {
  if (!selected) return;
  const { kind, index, sub } = selected;
  commit(() => {
    if (kind === 'aisle') L.aisles.splice(index, 1);
    else if (kind === 'zone') L.zones.splice(index, 1);
    else if (kind === 'obstacle') L.obstacles.splice(index, 1);
    else if (kind === 'register') L.registers.splice(index, 1);
    else if (kind === 'entrance') L.entrance = null;
    else if (kind === 'pick') L.zones[index].picks.splice(sub, 1);
  });
  selected = null;
  render();
}

// Pointer input: tap, drag, pan, pinch

const pointers = new Map();
let gesture = null;

function toMap(clientX, clientY) {
  const m = svg.getScreenCTM().inverse();
  const p = new DOMPoint(clientX, clientY).matrixTransform(m);
  return [p.x, p.y];
}

function zoomAt(cx, cy, factor) {
  const [vx, vy, vw, vh] = view;
  const nw = Math.min(Math.max(MIN_ZOOM_W, vw * factor), 400);
  const k = nw / vw;
  view = [cx - (cx - vx) * k, cy - (cy - vy) * k, vw * k, vh * k];
  svg.setAttribute('viewBox', view.join(' '));
}

function onDown(e) {
  svg.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), view: [...view], mid: toMap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
    dragBox = null;
    return;
  }
  const start = toMap(e.clientX, e.clientY);
  const target = e.target;
  const kind = target?.dataset?.kind;
  let type = 'pan';
  if (tool === 'aisle') type = 'box';
  else if (tool === 'select' && kind && selected && selected.kind === kind && Number(target.dataset.index || 0) === selected.index) type = 'move';
  gesture = { type, sx: e.clientX, sy: e.clientY, start, target, moved: false, view: [...view], k: 1 / svg.getScreenCTM().a, base: JSON.parse(JSON.stringify(L)) };
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (!gesture) return;
  if (gesture.type === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    view = [...gesture.view];
    zoomAt(gesture.mid[0], gesture.mid[1], gesture.dist / d);
    return;
  }
  if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > TAP_PX) gesture.moved = true;
  if (!gesture.moved) return;
  if (gesture.type === 'pan') {
    const k = gesture.k;
    view = [gesture.view[0] - (e.clientX - gesture.sx) * k, gesture.view[1] - (e.clientY - gesture.sy) * k, gesture.view[2], gesture.view[3]];
    svg.setAttribute('viewBox', view.join(' '));
  } else if (gesture.type === 'box') {
    const p = toMap(e.clientX, e.clientY);
    dragBox = [snap(gesture.start[0]), snap(gesture.start[1]), snap(p[0]), snap(p[1])];
    render();
  } else if (gesture.type === 'move') {
    const p = toMap(e.clientX, e.clientY);
    const base = gesture.base;
    L = JSON.parse(JSON.stringify(base));
    moveSelected(snap(p[0] - gesture.start[0]), snap(p[1] - gesture.start[1]), base);
    render();
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (!gesture) return;
  const g = gesture;
  if (g.type === 'pinch') {
    if (pointers.size === 0) gesture = null;
    return;
  }
  gesture = null;
  if (!g.moved) {
    const p = toMap(e.clientX, e.clientY);
    tapAt([snap(p[0]), snap(p[1])], g.target);
  } else if (g.type === 'box' && dragBox) {
    const a = aisleFromBox(dragBox);
    dragBox = null;
    if (a) {
      commit(() => { L.aisles.push(a); });
      selected = { kind: 'aisle', index: L.aisles.length - 1 };
    }
    render();
  } else if (g.type === 'move') {
    const moved = L;
    L = g.base;
    commit(() => { L = moved; });
  }
}

// Panels

function bindUI() {
  for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('done-btn').addEventListener('click', finishDraft);
  $('undo-btn').addEventListener('click', undo);
  $('redo-btn').addEventListener('click', redo);
  $('delete-btn').addEventListener('click', deleteSelected);
  $('fit-btn').addEventListener('click', () => { view = viewBoxFor(L); render(); });
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); gesture = null; dragBox = null; });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = toMap(e.clientX, e.clientY);
    zoomAt(x, y, e.deltaY > 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  $('gen').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const next = generateLayout({
        width: len($('g-width').value), depth: len($('g-depth').value),
        aisles: Number($('g-count').value), first: Number($('g-first').value),
        rows: Number($('g-rows').value), rtl: $('g-rtl').checked
      });
      if (!confirm('Replace your layout with a generated one? You can undo this.')) return;
      commit(() => { L = next; });
      view = viewBoxFor(L);
      selected = null;
      render();
    } catch (err) {
      $('hint').textContent = err.message;
    }
  });

  $('quick').addEventListener('submit', e => {
    e.preventDefault();
    const n = Math.round(len($('q-count').value));
    const first = parseInt($('q-first').value, 10);
    const x = len($('q-x').value), spacing = len($('q-spacing').value);
    const y0 = len($('q-y0').value), y1 = len($('q-y1').value);
    const width = len($('q-width').value), bays = Math.round(Number($('q-bays').value));
    if (![n, first, x, spacing, y0, y1, width, bays].every(Number.isFinite) || n < 1 || n > 60) {
      $('hint').textContent = 'Check the row of aisles form. Every box needs a number.';
      return;
    }
    const rtl = $('q-rtl').checked;
    commit(() => {
      for (let i = 0; i < n; i++) {
        const cx = fmt(x + spacing * i);
        const num = rtl ? first + n - 1 - i : first + i;
        L.aisles.push({ number: String(num), start: [cx, fmt(y0)], end: [cx, fmt(y1)], width: fmt(width), shelf: S.DEFAULT_SHELF, bays: Math.max(1, bays), bay1: 'start', flip: false, cold: false });
      }
    });
  });

  const updateSteps = () => {
    const n = Number($('step-count').value) || 0;
    $('step-out').innerHTML = `<b>${fmt(n * stepLength)} m</b>`;
  };
  $('step-len').addEventListener('change', () => {
    const v = Number($('step-len').value);
    if (v > 0.2 && v < 1.5) { stepLength = v; save('stepLength', v); }
    $('step-len').value = stepLength;
    updateSteps();
  });
  $('step-count').addEventListener('input', updateSteps);

  $('download-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(L, null, 1) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'store.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('export-btn').addEventListener('click', () => {
    $('json-box').hidden = false;
    $('json-actions').hidden = false;
    $('json-box').value = JSON.stringify(L, null, 1);
  });
  $('copy-btn').addEventListener('click', () => navigator.clipboard?.writeText($('json-box').value).catch(() => {}));
  $('apply-btn').addEventListener('click', () => importText($('json-box').value));
  $('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) importText(await file.text());
    e.target.value = '';
  });
  $('placeholder-box').addEventListener('change', e => commit(() => { L.placeholder = e.target.checked; }));
  $('reset-btn').addEventListener('click', async () => {
    if (!confirm('Replace your layout with the shipped one? You can undo this.')) return;
    const shipped = await fetchShipped();
    commit(() => { L = shipped; });
    view = viewBoxFor(L);
    render();
  });
}

function importText(text) {
  try {
    const next = S.normalizeLayout(text);
    commit(() => { L = next; });
    view = viewBoxFor(L);
    selected = null;
    render();
  } catch {
    $('hint').textContent = 'That file is not a layout JSON.';
  }
}

init();
