import { load, save, remove, registerWorker } from './storage.js';
import { StepDetector, HeadingFilter, TurnSnapper, readHeading, angleDiff, norm360, stepFromHeight } from './sensors.js';
import { newWalk, positions, markAt, buildLayout, DEPARTMENTS } from './trace.js';
import { validateLayout, checkReachable, buildGrid, bounds } from './store.js';
import { drawStore, el, pathD } from './map-svg.js';

const SAVE_EVERY = 5; // steps between autosaves
const UNDO_STEPS = 5; // steps removed by the undo button
const MIN_VIEW = 20; // smallest map view in meters
const SENSOR_WAIT = 3000; // ms to wait for sensor events
const DEFAULT_STEP = 0.7; // step length without a height

const $ = id => document.getElementById(id);
const DIRS = ['ahead', 'right', 'back', 'left'];

let walk = load('walk');
let phase = 'prep';
let sensorsAsked = false;
let paused = false;
let manualHeading = 0;
let heading = null;
let motionSeen = false;
let wakeLock = null;
const detector = new StepDetector();
const filter = new HeadingFilter();
const snapper = new TurnSnapper();
let drawQueued = false;

function init() {
  registerWorker();
  const stepLen = load('stepLength', null);
  $('step-len').value = stepLen ?? DEFAULT_STEP;
  $('resume-btn').hidden = !walk;
  $('manual').checked = $('manual-walk').checked = load('manualMode', false);
  bindPrep();
  bindWalking();
  bindFinish();
  for (const name of Object.keys(DEPARTMENTS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = name;
    b.addEventListener('click', () => addMark('zone', { label: name }, `${name} marked.`));
    $('dept-marks').appendChild(b);
  }
  show();
}

// Phases

function show() {
  $('prep').hidden = phase !== 'prep';
  $('walking').hidden = !['perimeter', 'checkout', 'aisles'].includes(phase);
  $('finish').hidden = phase !== 'finish';
  for (const p of ['perimeter', 'checkout', 'aisles']) $(`phase-${p}`).hidden = phase !== p;
  $('manual-controls').hidden = !$('manual').checked;
  if (walk) {
    if (phase !== 'prep') walk.phase = phase;
    persist();
    if (phase === 'finish') renderFinish();
    else if (phase !== 'prep') { snapper.current = lastHeading(); syncAisle(); queueDraw(); }
  }
  updateWakeLock();
}

function setPhase(p) {
  phase = p;
  show();
  window.scrollTo(0, 0);
}

function persist() {
  if (walk) save('walk', walk);
}

const lastHeading = () => (walk && walk.steps.length ? walk.steps[walk.steps.length - 1].h : 0);

// Sensors

async function askSensors() {
  if (sensorsAsked) return;
  sensorsAsked = true;
  const status = $('sensor-status');
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      if (await DeviceMotionEvent.requestPermission() === 'denied') throw new Error('motion');
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      if (await DeviceOrientationEvent.requestPermission() === 'denied') throw new Error('compass');
    }
  } catch {
    sensorsAsked = false;
    status.textContent = 'Permission was not given. You can use manual mode instead.';
    return;
  }
  addEventListener('devicemotion', onMotion);
  addEventListener('deviceorientationabsolute', onOrientation);
  addEventListener('deviceorientation', onOrientation);
  status.textContent = 'Checking sensors...';
  setTimeout(() => {
    const parts = [motionSeen ? 'Step counting works.' : 'No step sensor found.', heading != null ? 'Compass works.' : 'No compass found.'];
    if (!motionSeen || heading == null) {
      parts.push('Manual mode is on.');
      $('manual').checked = $('manual-walk').checked = true;
      $('manual-controls').hidden = false;
      save('manualMode', true);
    }
    status.textContent = parts.join(' ');
  }, SENSOR_WAIT);
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  motionSeen = true;
  if (detector.push(e.timeStamp, a.x, a.y, a.z) && walking() && !$('manual').checked) addStep();
}

function onOrientation(e) {
  const h = readHeading(e);
  if (h == null) return;
  heading = filter.push(h);
  if (walk && walk.startHeading == null && phase === 'perimeter' && !walk.steps.length && !$('manual').checked) walk.startHeading = heading;
}

const walking = () => walk && !paused && ['perimeter', 'checkout', 'aisles'].includes(phase);

// Recording

function currentDirection() {
  if ($('manual').checked || heading == null || walk.startHeading == null) return { h: manualHeading, raw: manualHeading };
  const rel = norm360(angleDiff(heading, walk.startHeading));
  return { h: walk.snap ? snapper.update(rel) : rel, raw: rel };
}

function addStep() {
  const { h, raw } = currentDirection();
  walk.steps.push({ t: Date.now(), h: Math.round(h * 10) / 10, r: Math.round(raw * 10) / 10 });
  if (walk.steps.length % SAVE_EVERY === 0) persist();
  queueDraw();
}

function addMark(type, extra, message) {
  if (!walk || phase === 'prep' || phase === 'finish') return;
  markAt(walk, type, extra);
  persist();
  $('mark-status').textContent = message;
  queueDraw();
}

// Live map

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawWalk(); });
}

function drawWalk() {
  if (!walk) return;
  const path = positions(walk);
  const svg = $('walk-map');
  svg.replaceChildren();
  const b = bounds(path);
  const w = Math.max(MIN_VIEW, b.x1 - b.x0 + 10), h = Math.max(MIN_VIEW * 0.75, b.y1 - b.y0 + 10);
  const fs = Math.max(1.2, w / 28);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
  el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, fill: '#FBF8F2' }, svg);
  const g = el('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  el('path', { d: pathD(path), stroke: '#B23B2E', 'stroke-width': 0.5 }, g);
  for (const m of walk.marks) {
    const p = path[Math.min(m.step, path.length - 1)];
    const color = m.type === 'register' ? '#3B4A6B' : m.type.startsWith('aisle') ? '#24221F' : '#5E5850';
    el('circle', { cx: p[0], cy: p[1], r: fs * 0.4, fill: color }, svg);
    const label = m.type === 'zone' || m.type === 'note' ? m.label : m.type === 'aisle-start' ? `A${m.number}` : m.type === 'register' ? 'Out' : '';
    if (label) el('text', { x: p[0] + fs * 0.6, y: p[1] + fs * 0.35, 'font-size': fs, fill: color }, svg, label);
  }
  el('path', { d: 'M0 -0.9L0.8 0.6L-0.8 0.6Z', fill: '#24221F' }, svg);
  const here = path[path.length - 1];
  const dir = currentDirection().h;
  el('path', { d: 'M0 -1.3L1 1L0 0.4L-1 1Z', fill: '#B23B2E', stroke: '#FBF8F2', 'stroke-width': 0.2,
    transform: `translate(${here[0]} ${here[1]}) rotate(${dir})` }, svg);
  const meters = walk.steps.length * walk.stepLength;
  $('st-steps').textContent = String(walk.steps.length);
  $('st-meters').textContent = `${Math.round(meters)} m`;
  const quarter = Math.round(norm360(dir) / 90) % 4;
  $('st-heading').textContent = DIRS[quarter];
  $('register-count').textContent = `${walk.marks.filter(m => m.type === 'register').length} checkout spots marked.`;
}

// Aisles

function openAisle() {
  let open = null;
  for (const m of walk.marks) {
    if (m.type === 'aisle-start') open = m;
    else if (m.type === 'aisle-end') open = null;
  }
  return open;
}

function syncAisle() {
  if (!walk) return;
  const open = openAisle();
  const done = walk.marks.filter(m => m.type === 'aisle-end').length;
  $('aisle-btn').textContent = open ? `End aisle ${open.number}` : `Start aisle ${$('aisle-num').value || '?'}`;
  $('aisle-status').textContent = open
    ? `Walking aisle ${open.number}. Tap End at the back.`
    : `${done} aisle${done === 1 ? '' : 's'} done.`;
}

function aisleButton() {
  const open = openAisle();
  if (open) {
    addMark('aisle-end', {}, `Aisle ${open.number} done.`);
    const n = parseInt(open.number, 10);
    if (Number.isFinite(n)) $('aisle-num').value = String(n + 1);
  } else {
    const num = $('aisle-num').value.trim();
    if (!num) return;
    addMark('aisle-start', { number: num }, `Started aisle ${num}.`);
  }
  syncAisle();
}

function undoAisle() {
  for (let i = walk.marks.length - 1; i >= 0; i--) {
    const t = walk.marks[i].type;
    if (t === 'aisle-end' || t === 'aisle-start') {
      const cut = t === 'aisle-end' ? i - 1 : i;
      if (walk.marks[cut]?.type === 'aisle-start') {
        $('aisle-num').value = walk.marks[cut].number;
        walk.marks.splice(cut, t === 'aisle-end' ? 2 : 1);
      }
      break;
    }
  }
  persist();
  syncAisle();
  queueDraw();
}

// Finish

let built = null;

function renderFinish() {
  built = buildLayout(walk);
  const { layout, report, notes, path } = built;
  const svg = $('finish-map');
  if (layout.outline.length > 2) {
    const layers = drawStore(svg, layout);
    el('path', { d: pathD(path), fill: 'none', stroke: '#B23B2E', 'stroke-width': 0.25, opacity: 0.5 }, layers.route);
    for (const n of notes) {
      el('circle', { cx: n.point[0], cy: n.point[1], r: 0.5, fill: '#5E5850' }, layers.top);
      el('text', { x: n.point[0] + 0.8, y: n.point[1] + 0.4, 'font-size': 1.1, fill: '#5E5850' }, layers.top, n.label);
    }
  } else {
    svg.replaceChildren();
  }
  const parts = [`${report.steps} steps, about ${Math.round(report.steps * walk.stepLength)} m.`];
  if (report.closure != null) parts.push(`The loop is ${Math.round(report.perimeter)} m around and ended ${report.closure.toFixed(1)} m from the exit, so that gap was spread over the walk.`);
  parts.push(`${report.aisles} aisle${report.aisles === 1 ? '' : 's'}, ${report.registers} checkout spot${report.registers === 1 ? '' : 's'}, ${layout.zones.length} department${layout.zones.length === 1 ? '' : 's'}.`);
  $('finish-report').textContent = parts.join(' ');
  const list = $('finish-problems');
  list.replaceChildren();
  let problems = [...report.warnings.map(msg => ({ msg }))];
  if (layout.outline.length > 2) {
    problems = problems.concat(validateLayout(layout));
    try { problems = problems.concat(checkReachable(layout, buildGrid(layout))); } catch { /* shown by validation */ }
  }
  for (const p of problems) {
    const li = document.createElement('li');
    li.textContent = p.msg;
    list.appendChild(li);
  }
  if (!problems.length) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = 'No problems found.';
    list.appendChild(li);
  } else {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = 'You can fix these in the editor after saving.';
    list.appendChild(li);
  }
  $('save-layout').disabled = layout.outline.length < 3;
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 1) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const walkName = () => `skein-walk-${(walk.started || new Date().toISOString()).slice(0, 10)}.json`;

// Screen stays on while walking

async function updateWakeLock() {
  const want = ['perimeter', 'checkout', 'aisles'].includes(phase) && !paused;
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateWakeLock(); });

// Buttons

function bindPrep() {
  const fromHeight = () => {
    const ft = Number($('height-ft').value), inch = Number($('height-in').value) || 0;
    if (ft >= 3 && ft <= 8) {
      $('step-len').value = stepFromHeight((ft * 12 + inch) * 2.54);
      save('stepLength', Number($('step-len').value));
    }
  };
  $('height-ft').addEventListener('change', fromHeight);
  $('height-in').addEventListener('change', fromHeight);
  $('step-len').addEventListener('change', () => {
    const v = Number($('step-len').value);
    if (v >= 0.3 && v <= 1.2) save('stepLength', v);
  });
  $('sensor-btn').addEventListener('click', askSensors);
  $('manual').addEventListener('change', () => save('manualMode', $('manual').checked));
  const syncManual = from => {
    $('manual').checked = $('manual-walk').checked = from.checked;
    save('manualMode', from.checked);
    manualHeading = lastHeading();
    $('manual-controls').hidden = !from.checked;
  };
  $('manual').addEventListener('change', e => syncManual(e.target));
  $('manual-walk').addEventListener('change', e => syncManual(e.target));
  $('start-btn').addEventListener('click', () => {
    if (walk && walk.steps.length && !confirm('Start over? Your saved walk will be replaced.')) return;
    if (!$('manual').checked) askSensors();
    const len = Number($('step-len').value);
    walk = newWalk(len >= 0.3 && len <= 1.2 ? len : DEFAULT_STEP, $('snap').checked);
    walk.startHeading = $('manual').checked ? null : heading;
    manualHeading = 0;
    snapper.current = 0;
    paused = false;
    setPhase('perimeter');
  });
  $('resume-btn').addEventListener('click', () => {
    if (!$('manual').checked) askSensors();
    if (walk.startHeading == null && heading != null) walk.startHeading = heading;
    manualHeading = lastHeading();
    setPhase(walk.phase && walk.phase !== 'prep' ? walk.phase : 'perimeter');
  });
}

function bindWalking() {
  $('pause-btn').addEventListener('click', () => {
    paused = !paused;
    $('pause-btn').textContent = paused ? 'Resume' : 'Pause';
    $('pause-btn').setAttribute('aria-pressed', String(paused));
    updateWakeLock();
  });
  $('undo-steps').addEventListener('click', () => {
    const keep = Math.max(walk.marks.reduce((m, x) => Math.max(m, x.step), 0), walk.steps.length - UNDO_STEPS);
    walk.steps.length = keep;
    persist();
    queueDraw();
  });
  $('step-btn').addEventListener('click', () => { if (walking()) addStep(); });
  $('turn-left').addEventListener('click', () => { manualHeading = norm360(manualHeading - 90); queueDraw(); });
  $('turn-right').addEventListener('click', () => { manualHeading = norm360(manualHeading + 90); queueDraw(); });
  $('perimeter-done').addEventListener('click', () => {
    walk.exit = { steps: Math.max(0, Number($('exit-steps').value) || 0), side: $('exit-side').value };
    walk.marks = walk.marks.filter(m => m.type !== 'perimeter-end');
    markAt(walk, 'perimeter-end');
    setPhase('checkout');
  });
  $('mark-register').addEventListener('click', () => addMark('register', {}, 'Checkout spot marked.'));
  $('checkout-done').addEventListener('click', () => setPhase('aisles'));
  $('aisle-btn').addEventListener('click', aisleButton);
  $('aisle-num').addEventListener('input', syncAisle);
  $('aisle-undo').addEventListener('click', undoAisle);
  $('aisles-done').addEventListener('click', () => {
    if (openAisle()) addMark('aisle-end', {}, 'Last aisle closed.');
    setPhase('finish');
  });
  $('note-btn').addEventListener('click', () => {
    const text = $('note-text').value.trim();
    if (!text) return;
    addMark('note', { label: text }, `Note added: ${text}.`);
    $('note-text').value = '';
  });
}

function bindFinish() {
  $('save-layout').addEventListener('click', () => {
    if (!built) return;
    if (load('layout') && !confirm('Replace the map Skein uses now with this traced one?')) return;
    save('layout', built.layout);
    $('open-editor').hidden = false;
    $('save-layout').textContent = 'Saved. Skein now uses this map';
  });
  $('dl-layout').addEventListener('click', () => built && download('store.json', built.layout));
  $('dl-walk').addEventListener('click', () => download(walkName(), walk));
  if (navigator.canShare) {
    $('share-walk').hidden = false;
    $('share-walk').addEventListener('click', async () => {
      const file = new File([JSON.stringify(walk)], walkName(), { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Skein walk data' }); } catch { /* cancelled */ }
      } else {
        download(walkName(), walk);
      }
    });
  }
  $('back-walk').addEventListener('click', () => setPhase('aisles'));
  $('new-walk').addEventListener('click', () => {
    if (!confirm('Delete this walk and start again?')) return;
    remove('walk');
    walk = null;
    $('resume-btn').hidden = true;
    setPhase('prep');
  });
}

init();
