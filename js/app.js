import { load, save, registerWorker } from './storage.js';
import { normalize, parseList, buildIndex, matchLine, searchTerms } from './match.js';
import { prepare, resolveSpot, buildStops, planRoute, WALK_SPEED } from './plan.js';
import { renderMatches, renderChips, renderRecent } from './ui-list.js';
import { drawPlanMap, renderTotals, renderStops } from './ui-route.js';
import { printRoute, preparePrint } from './ui-print.js';

const RECENT_MAX = 6; // recent lists kept
const TYPE_DELAY = 250; // ms before matching typed text
const LIVE_TIMEOUT = 6000; // ms to wait for a live lookup

const $ = id => document.getElementById(id);
const state = {
  ctx: null, catalog: null, index: null, byId: new Map(),
  rows: [], open: null, plan: null, placing: null,
  choices: load('choices', {}), places: load('places', {}), skips: load('skips', {}),
  live: new Map(),
  settings: { speed: load('speed', WALK_SPEED), liveUrl: load('liveUrl', '') }
};

async function init() {
  registerWorker();
  const [layout, catalog] = await Promise.all([
    load('layout') || fetch('data/store.json').then(r => r.json()),
    fetch('data/catalog.json').then(r => r.json())
  ]);
  state.ctx = prepare(layout);
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
  if (!state.placing) return;
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
  const svg = svgNode();
  $('map').replaceChildren(svg);
  drawPlanMap(svg, state.ctx.L, state.plan);
  renderTotals($('totals'), state.plan, state.settings.speed);
  renderStops($('stops'), state.plan);
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
