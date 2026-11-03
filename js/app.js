import { load, save, registerWorker } from './storage.js';
import { normalize, parseList, buildIndex, matchLine, searchTerms } from './match.js';
import { prepare, resolveSpot, buildStops, planRoute, WALK_SPEED } from './plan.js';
import { renderMatches, renderChips, renderRecent } from './ui-list.js';
import { drawPlanMap, drawLive, renderTotals, renderStops } from './ui-route.js';
import { routeTrack, Trip } from './follow.js';
import { StepDetector } from './sensors.js';
import { printRoute, preparePrint } from './ui-print.js';
import { browserStores } from './stores.js';
import { mountStores } from './ui-stores.js';

const RECENT_MAX = 6; // recent lists kept
const TYPE_DELAY = 250; // ms before matching typed text
const LIVE_TIMEOUT = 6000; // ms to wait for a live lookup
const SENSOR_WAIT = 3000; // ms before offering the Step button
const SAVE_STEPS = 5; // steps between progress saves
const DEFAULT_STEP = 0.7; // step length without a Setup walk
const ARRIVE_BUZZ = 80; // ms vibration when you reach a stop

const $ = id => document.getElementById(id);
const state = {
  ctx: null, catalog: null, index: null, byId: new Map(),
  rows: [], open: null, plan: null, placing: null,
  track: null, trip: null, layers: null, following: false, steps: 0, motion: false, wake: null,
  choices: load('choices', {}), places: load('places', {}), skips: load('skips', {}),
  live: new Map(),
  settings: { speed: load('speed', WALK_SPEED), liveUrl: load('liveUrl', '') }
};

async function init() {
  registerWorker();
  const stores = browserStores();
  const [store, catalog] = await Promise.all([
    stores.current(),
    fetch('data/catalog.json').then(r => r.json())
  ]);
  state.ctx = prepare(store.layout);
  mountStores(stores, store.id);
  state.catalog = catalog;
  state.index = buildIndex(catalog.items);
  for (const it of catalog.items) state.byId.set(it.id, it);
  $('layout-banner').hidden = !state.ctx.L.placeholder;
  $('sample-banner').hidden = !catalog.sample;
  $('list-text').value = load('draft', '');
  $('opt-cold').checked = load('coldLast', false);
  $('opt-turns').checked = load('fewerTurns', false);
  bindUI();
  refreshRows();
  renderChips($('chips'), searchTerms(state.index, ''), addTerm);
  renderRecent($('recent'), load('lists', []), loadList);
  drawPlanMap($('map').appendChild(svgNode()), state.ctx.L, null);
}

function svgNode() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Store map');
  svg.addEventListener('click', onMapClick);
  return svg;
}

// List lines to matched spots
function refreshRows() {
  const lines = parseList($('list-text').value);
  state.rows = lines.map(({ text, key }) => {
    const { best, alts } = matchLine(key, state.index);
    const chosen = state.choices[key] ? state.byId.get(state.choices[key]) : null;
    let item = chosen || best?.item || null;
    const live = state.live.get(key);
    if (!item && live && live !== 'pending' && live !== 'none') item = live;
    const skipped = !!state.skips[key];
    const spot = skipped ? null : resolveSpot(state.ctx.L, { item, manual: state.places[key], line: text, alts });
    if (!item && !spot && !skipped && state.settings.liveUrl && !live) lookupLive(key, text);
    return { text, key, item, alts, spot, skipped, pending: live === 'pending' && !spot };
  });
  $('match-panel').hidden = !state.rows.length;
  renderMatches($('matches'), state.rows, { onPick, onPlace, onSkip, open: state.open });
}

async function lookupLive(key, text) {
  state.live.set(key, 'pending');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LIVE_TIMEOUT);
    const url = `${state.settings.liveUrl}${state.settings.liveUrl.includes('?') ? '&' : '?'}term=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await res.json();
    const hit = (body.items || []).find(i => i.loc) || null;
    state.live.set(key, hit || 'none');
  } catch {
    state.live.set(key, 'none');
  }
  refreshRows();
}

function onPick(key, id) {
  if (id == null) {
    state.open = state.open === key ? null : key;
  } else {
    state.choices[key] = id;
    delete state.places[key];
    save('choices', state.choices);
    save('places', state.places);
    state.open = null;
  }
  refreshRows();
  if (id != null && state.plan) plan();
}

function onSkip(key) {
  if (state.skips[key]) delete state.skips[key];
  else state.skips[key] = true;
  save('skips', state.skips);
  state.open = null;
  refreshRows();
  if (state.plan) plan();
}

function onPlace(key) {
  state.placing = key;
  const row = state.rows.find(r => r.key === key);
  $('place-hint').hidden = false;
  $('place-hint').textContent = `Tap the map where you find ${row ? row.text : 'this item'}.`;
  $('map').classList.add('placing');
  $('map').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
}

function onMapClick(e) {
  if (!state.placing) {
    const mark = e.target.closest && e.target.closest('[data-stop]');
    if (mark && state.trip) {
      state.trip.toggleStop(Number(mark.dataset.stop));
      tripChanged();
    }
    return;
  }
  const svg = e.currentTarget;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  state.places[state.placing] = [Math.round(p.x * 4) / 4, Math.round(p.y * 4) / 4];
  delete state.skips[state.placing];
  save('places', state.places);
  save('skips', state.skips);
  state.placing = null;
  state.open = null;
  $('place-hint').hidden = true;
  $('map').classList.remove('placing');
  refreshRows();
  plan();
}

function addTerm(term) {
  const box = $('list-text');
  const cur = box.value.replace(/\s+$/, '');
  box.value = cur ? `${cur}\n${term}` : term;
  save('draft', box.value);
  refreshRows();
}

function loadList(text) {
  $('list-text').value = text;
  save('draft', text);
  refreshRows();
}

function saveList() {
  const text = $('list-text').value.trim();
  if (!text) return;
  const lines = parseList(text);
  const label = lines.slice(0, 3).map(l => l.text).join(', ') + (lines.length > 3 ? ` +${lines.length - 3}` : '');
  const lists = load('lists', []).filter(l => normalize(l.text) !== normalize(text));
  lists.unshift({ text, label, saved: Date.now() });
  save('lists', lists.slice(0, RECENT_MAX));
  renderRecent($('recent'), load('lists', []), loadList);
}

// Route planning
function plan() {
  const spots = state.rows.filter(r => r.spot).map(r => ({ ...r.spot, label: r.text }));
  const opts = { coldLast: $('opt-cold').checked, fewerTurns: $('opt-turns').checked };
  const stops = buildStops(state.ctx, spots);
  state.plan = planRoute(state.ctx, stops, opts);
  state.track = routeTrack(state.plan.line, state.plan.breaks);
  state.trip = new Trip(state.track, state.plan.stops.map(s => s.items.length));
  const saved = load('trip', null);
  if (saved && saved.key === tripKey(state.plan)) state.trip.restore(saved);
  $('follow').hidden = false;
  renderTotals($('totals'), state.plan, state.settings.speed);
  renderTrip();
  $('route-hint').hidden = true;
  $('print-btn').disabled = false;
  const missing = state.rows.filter(r => !r.spot && !r.skipped).length;
  $('turns-cost').textContent = opts.fewerTurns
    ? (state.plan.turnCost > 0.5 ? `Costs ${Math.round(state.plan.turnCost)} m more walking for this list.` : 'Costs no extra walking for this list.')
    : '';
  if (missing) {
    $('route-hint').hidden = false;
    $('route-hint').textContent = `${missing} item${missing > 1 ? 's are' : ' is'} not on the route yet. Tap ${missing > 1 ? 'them' : 'it'} in the list to place ${missing > 1 ? 'them' : 'it'}.`;
  }
  preparePrint(storeName(), state.plan.stops.length);
}

// Walking along the route

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const tripKey = p => `${p.stops.map(s => s.items.join('+')).join('|')}|${Math.round(p.length)}`;
const saveTrip = () => save('trip', { key: tripKey(state.plan), ...state.trip.toJSON() });

function renderTrip() {
  const svg = svgNode();
  $('map').replaceChildren(svg);
  state.layers = drawPlanMap(svg, state.ctx.L, state.plan, state.trip);
  if (state.following || state.trip.d > 0) drawLive(state.layers, state.track, state.trip);
  renderStops($('stops'), state.plan, state.trip, (i, j) => { state.trip.toggleItem(i, j); tripChanged(); });
  followText();
}

function tripChanged() {
  saveTrip();
  renderTrip();
}

function followText() {
  const t = state.trip;
  const n = t.next();
  const out = `Register ${state.plan.register + 1}`;
  let msg;
  if (n < 0) msg = t.allDone() ? `All done. Head to ${out}.` : `Head to ${out}. Some items are still unchecked in the list.`;
  else {
    const s = state.plan.stops[n];
    msg = t.isNear()
      ? `You should be at stop ${n + 1}: ${s.items.map(cap).join(', ')}. ${s.where}.`
      : `Next, stop ${n + 1}: ${s.items.map(cap).join(', ')}. ${s.where}. About ${Math.round(t.distanceToNext())} m.`;
  }
  $('follow-next').textContent = msg;
  $('check-next').disabled = n < 0;
}

function onStep() {
  const wasNear = state.trip.isNear();
  const len = load('stepLength', DEFAULT_STEP) || DEFAULT_STEP;
  state.trip.step(len);
  if (++state.steps % SAVE_STEPS === 0) saveTrip();
  if (!wasNear && state.trip.isNear() && state.trip.next() >= 0) navigator.vibrate?.(ARRIVE_BUZZ);
  drawLive(state.layers, state.track, state.trip);
  followText();
}

const detector = new StepDetector();
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  state.motion = true;
  if (detector.push(e.timeStamp, a.x, a.y, a.z) && state.following) onStep();
}

async function startMotion() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      if (await DeviceMotionEvent.requestPermission() === 'denied') throw new Error('denied');
    }
    addEventListener('devicemotion', onMotion);
  } catch { /* falls back to the Step button */ }
  setTimeout(() => { if (!state.motion) $('step-live').hidden = false; }, SENSOR_WAIT);
}

async function setWake(on) {
  try {
    if (on && !state.wake && navigator.wakeLock) state.wake = await navigator.wakeLock.request('screen');
    else if (!on && state.wake) { await state.wake.release(); state.wake = null; }
  } catch { state.wake = null; }
}

function toggleWalking() {
  state.following = !state.following;
  $('walk-btn').textContent = state.following ? 'Stop walking' : 'Start walking';
  $('follow-live').hidden = !state.following;
  $('follow-hint').hidden = state.following;
  if (state.following) {
    startMotion();
    drawLive(state.layers, state.track, state.trip);
  } else {
    saveTrip();
  }
  setWake(state.following);
  followText();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.following) { state.wake = null; setWake(true); } });

const storeName = () => state.catalog?.store?.name || state.ctx.L.name;

function bindUI() {
  let timer = null;
  $('list-text').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { save('draft', $('list-text').value); refreshRows(); }, TYPE_DELAY);
  });
  $('chip-search').addEventListener('input', e => renderChips($('chips'), searchTerms(state.index, e.target.value), addTerm));
  $('plan-btn').addEventListener('click', () => {
    refreshRows();
    plan();
    saveList();
    if (innerWidth < 900) $('route-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  $('save-list-btn').addEventListener('click', saveList);
  $('walk-btn').addEventListener('click', toggleWalking);
  $('step-live').addEventListener('click', () => { if (state.following) onStep(); });
  $('here-btn').addEventListener('click', () => { state.trip.here(); saveTrip(); drawLive(state.layers, state.track, state.trip); followText(); });
  $('check-next').addEventListener('click', () => {
    const n = state.trip.next();
    if (n >= 0) { state.trip.toggleStop(n); tripChanged(); }
  });
  $('clear-trip').addEventListener('click', () => {
    if (!confirm('Uncheck everything and start the route over?')) return;
    state.trip = new Trip(state.track, state.plan.stops.map(s => s.items.length));
    tripChanged();
  });
  for (const id of ['opt-cold', 'opt-turns']) {
    $(id).addEventListener('change', () => {
      save(id === 'opt-cold' ? 'coldLast' : 'fewerTurns', $(id).checked);
      if (state.plan) plan();
    });
  }
  $('print-btn').addEventListener('click', () => printRoute(storeName(), state.plan ? state.plan.stops.length : 0));
  for (const [btn, id] of [['about-btn', 'about'], ['settings-btn', 'settings']]) {
    $(btn).addEventListener('click', () => $(id).showModal());
  }
  document.querySelectorAll('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('set-speed').value = state.settings.speed;
  $('set-live').value = state.settings.liveUrl;
  $('set-speed').addEventListener('change', e => {
    const v = Number(e.target.value);
    if (v >= 0.2 && v <= 2.5) { state.settings.speed = v; save('speed', v); }
    e.target.value = state.settings.speed;
    if (state.plan) renderTotals($('totals'), state.plan, state.settings.speed);
  });
  $('set-live').addEventListener('change', e => {
    state.settings.liveUrl = e.target.value.trim();
    save('liveUrl', state.settings.liveUrl);
    state.live.clear();
    refreshRows();
  });
  $('clear-places').addEventListener('click', () => {
    state.places = {};
    save('places', {});
    refreshRows();
    if (state.plan) plan();
  });
}

init();
