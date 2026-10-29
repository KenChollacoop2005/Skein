import { load, registerWorker } from './storage.js';
import { parseList, buildIndex, matchLine } from './match.js';
import { prepare, resolveSpot, buildStops, compareMethods, lineFor } from './plan.js';
import { moldGraph, foodNodes, TeroModel, networkOrder, JonesModel, TERO } from './physarum.js';
import { evaluate } from './route.js';
import { drawStore, drawThread, drawStopMarker, el } from './map-svg.js';

const DEMO = 'milk, eggs, peanut butter, bananas, ground beef, frozen pizza, cereal, coffee, bagels, paper towels, shampoo, salsa';
const CHUNK = 6; // Tero steps between screen updates
const PHONE_AGENTS = 2500; // agent cap on small screens
const DESK_AGENTS = 5000; // agent cap on large screens
const TRAIL_FULL = 60; // trail level drawn as full color
const SEED = 1; // fixed seed for repeatable runs

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let ctx, index, jones = null, playing = !reduced, speed = 1, runId = 0;

async function init() {
  registerWorker();
  const [layout, catalog] = await Promise.all([
    load('layout') || fetch('data/store.json').then(r => r.json()),
    fetch('data/catalog.json').then(r => r.json())
  ]);
  ctx = prepare(layout);
  index = buildIndex(catalog.items);
  $('layout-banner').hidden = !ctx.L.placeholder;
  const draft = load('draft', '');
  const sel = $('race-list');
  const opt = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; sel.appendChild(o); };
  if (parseList(draft).length >= 2) opt('mine', 'My list from the Plan page');
  opt('demo', 'Demo list (12 items)');
  $('race-btn').addEventListener('click', run);
  $('play-btn').addEventListener('click', () => { playing = !playing; syncButtons(); });
  for (const b of document.querySelectorAll('[data-speed]')) b.addEventListener('click', () => { speed = Number(b.dataset.speed); syncButtons(); });
  syncButtons();
  requestAnimationFrame(frame);
  run();
}

function syncButtons() {
  $('play-btn').textContent = playing ? 'Pause' : 'Play';
  for (const b of document.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
}

function stopsFor(text) {
  const spots = parseList(text).map(({ text: line, key }) => {
    const { best, alts } = matchLine(key, index);
    const s = resolveSpot(ctx.L, { item: best?.item, line, alts });
    return s && { ...s, label: line };
  }).filter(Boolean);
  return buildStops(ctx, spots);
}

function card(title) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `<h3></h3><div class="num-line"><span class="len">...</span><span class="pct"></span></div>`;
  div.querySelector('h3').textContent = title;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title} route`);
  div.appendChild(svg);
  $('results').appendChild(div);
  return div;
}

function drawRoute(div, stops, res, dist, tubes) {
  const svg = div.querySelector('svg');
  const layers = drawStore(svg, ctx.L, { labels: false });
  if (tubes) {
    const d = tubes.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join('');
    el('path', { d, stroke: '#3B4A6B', 'stroke-width': 0.9, 'stroke-linecap': 'round', opacity: 0.35, fill: 'none' }, layers.route);
  }
  drawThread(layers.route, lineFor(ctx, dist, res), 0.6);
  res.order.forEach((i, k) => drawStopMarker(layers.top, stops[i].point, String(k + 1), { r: 1.1 }));
}

function score(div, length, best) {
  div.querySelector('.len').textContent = `${Math.round(length)} m`;
  const pct = (length / best - 1) * 100;
  div.querySelector('.pct').textContent = pct < 0.05 ? 'Best' : `${pct.toFixed(1)}% above best`;
  div.classList.toggle('best', pct < 0.05);
}

const pause = () => new Promise(ok => setTimeout(ok, 0));

async function run() {
  const id = ++runId;
  const text = $('race-list').value === 'mine' ? load('draft', DEMO) : DEMO;
  const stops = stopsFor(text);
  $('results').replaceChildren();
  $('verdict').textContent = 'Racing...';
  if (stops.length < 2) { $('verdict').textContent = 'The list needs at least 2 items with a spot on the map.'; return; }
  const cmp = compareMethods(ctx, stops);
  const methods = [
    [cmp.exact.label, cmp.exact],
    ['Nearest neighbor', cmp.nearest],
    ['Aisle order', cmp.aisle]
  ];
  const cards = methods.map(([title, res]) => { const c = card(title); drawRoute(c, stops, res, cmp.dist); return [c, res]; });
  const best = cmp.exact.length;
  for (const [c, res] of cards) score(c, res.length, best);
  const moldCard = card('Slime mold network');
  moldCard.querySelector('.pct').textContent = 'growing tubes';

  jones = new JonesModel(ctx.L, [ctx.L.entrance, ...stops.map(s => s.point)], { agents: innerWidth < 700 ? PHONE_AGENTS : DESK_AGENTS, seed: SEED });
  const canvas = $('mold');
  canvas.width = jones.cols;
  canvas.height = jones.rows;
  if (reduced) drawJones();

  const G = moldGraph(ctx.L);
  const food = foodNodes(G, [ctx.L.entrance, ...stops.map(s => s.point)]);
  const model = new TeroModel(G, food, { seed: SEED });
  while (model.t < TERO.steps) {
    for (let k = 0; k < CHUNK && model.t < TERO.steps; k++) model.step();
    moldCard.querySelector('.len').textContent = `${Math.round((model.t / TERO.steps) * 100)}%`;
    await pause();
    if (id !== runId) return;
  }
  const net = model.network();
  const order = networkOrder(G, food, net.edges);
  const res = evaluate(cmp.P, order.concat(Array.from({ length: cmp.P.n }, (_, i) => i).filter(i => !order.includes(i))), 'mold');
  const tubes = net.edges.map(e => [G.grid, G.cells[G.ea[e]], G.cells[G.eb[e]]]).map(([g, a, b]) => [center(g, a), center(g, b)]);
  drawRoute(moldCard, stops, res, cmp.dist, tubes);
  score(moldCard, res.length, best);
  verdict(stops.length, best, cmp.nearest.length, cmp.aisle.length, res.length, cmp.exact.exact);
}

function center(g, i) {
  const c = i % g.cols, r = (i - c) / g.cols;
  return [g.x0 + (c + 0.5) * g.cell, g.y0 + (r + 0.5) * g.cell];
}

function verdict(n, best, nn, aisle, mold, exact) {
  const pct = v => `${((v / best - 1) * 100).toFixed(1)}%`;
  const parts = [`With ${n} stops, the ${exact ? 'exact' : 'near optimal'} route is ${Math.round(best)} m.`];
  parts.push(`The slime mold route is ${Math.round(mold)} m, ${pct(mold)} longer.`);
  const beat = [];
  if (mold < nn - 0.5) beat.push(`nearest neighbor (${pct(nn)} longer)`);
  if (mold < aisle - 0.5) beat.push(`aisle order (${pct(aisle)} longer)`);
  const lost = [];
  if (mold > nn + 0.5) lost.push(`nearest neighbor (${pct(nn)})`);
  if (mold > aisle + 0.5) lost.push(`aisle order (${pct(aisle)})`);
  if (beat.length) parts.push(`It beat ${beat.join(' and ')}.`);
  if (lost.length) parts.push(`It lost to ${lost.join(' and ')}.`);
  parts.push('The mold builds a good network, but the network does not tell you the order to walk it, so some of the walking is doubling back.');
  $('verdict').textContent = parts.join(' ');
}

// Agent animation
let image = null;
function drawJones() {
  if (!jones) return;
  const canvas = $('mold');
  const g = canvas.getContext('2d');
  if (!image || image.width !== jones.cols) image = g.createImageData(jones.cols, jones.rows);
  const d = image.data;
  for (let i = 0; i < jones.trail.length; i++) {
    const o = i * 4;
    if (!jones.walk[i]) { d[o] = 0xE2; d[o + 1] = 0xDA; d[o + 2] = 0xCB; d[o + 3] = 255; continue; }
    const t = Math.min(1, Math.sqrt(jones.trail[i] / TRAIL_FULL));
    d[o] = 0xFB + (0xB2 - 0xFB) * t;
    d[o + 1] = 0xF8 + (0x3B - 0xF8) * t;
    d[o + 2] = 0xF2 + (0x2E - 0xF2) * t;
    d[o + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  g.fillStyle = '#B23B2E';
  for (const f of jones.food.slice(1)) {
    const c = f % jones.cols, r = (f - c) / jones.cols;
    g.beginPath();
    g.arc(c + 0.5, r + 0.5, 3, 0, Math.PI * 2);
    g.fill();
  }
  const s = jones.food[0], sc = s % jones.cols, sr = (s - sc) / jones.cols;
  g.fillStyle = '#24221F';
  g.fillRect(sc - 3, sr - 3, 6, 6);
  $('mold-step').textContent = `step ${jones.t}`;
}

function frame() {
  if (jones && playing) {
    for (let k = 0; k < speed; k++) jones.step();
    drawJones();
  }
  requestAnimationFrame(frame);
}

init();
