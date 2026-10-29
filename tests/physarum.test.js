import test from 'node:test';
import assert from 'node:assert/strict';
import * as Ph from '../js/physarum.js';
import { makeProblem } from '../js/route.js';
import { normalizeLayout } from '../js/store.js';
import { prepare, buildStops, distances, problemFor } from '../js/plan.js';
import { readJSON, tinyLayout } from './helpers.js';

function layouts() {
  const tiny = tinyLayout();
  const blocked = tinyLayout();
  blocked.obstacles.push({ name: 'Display', polygon: [[11, 9], [13, 9], [13, 14], [11, 14]] });
  const store = normalizeLayout(readJSON('data/store.json'));
  return [
    { L: tiny, pts: [[3, 2], [6, 5], [9.2, 9], [17, 2], [17, 12]] },
    { L: blocked, pts: [[10, 2], [6, 10], [15, 10], [18, 4]] },
    { L: store, pts: [[56.2, 20], [16, 3.8], [12.3, 15], [35, 28], [7, 20]] }
  ];
}

function connected(G, food, edges) {
  const adj = new Map();
  for (const e of edges) {
    for (const [a, b] of [[G.ea[e], G.eb[e]], [G.eb[e], G.ea[e]]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    }
  }
  const seen = new Set([food[0]]);
  const stack = [food[0]];
  while (stack.length) for (const v of adj.get(stack.pop()) || []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  return food.every(f => seen.has(f));
}

function problem(L, pts) {
  const ctx = prepare(L);
  const stops = buildStops(ctx, pts.map((p, i) => ({ point: p, label: `s${i}`, where: '', aisle: null })));
  const dist = distances(ctx, stops);
  return { ctx, stops, P: problemFor(dist, stops) };
}

test('the surviving network connects all stops on several layouts', () => {
  for (const { L, pts } of layouts()) {
    const G = Ph.moldGraph(L);
    const food = Ph.foodNodes(G, [L.entrance, ...pts]);
    const model = new Ph.TeroModel(G, food, { seed: 3 }).run(150);
    const net = model.network();
    assert.ok(connected(G, food, net.edges));
    assert.ok(net.edges.length < G.ea.length / 2, 'tubes thinned out');
  }
});

test('the mold route visits every stop once', () => {
  for (const { L, pts } of layouts().slice(0, 2)) {
    const { stops, P } = problem(L, pts);
    const r = Ph.moldRoute(prepare(L).L, P, stops.map(s => s.point), { seed: 2, steps: 150 });
    assert.equal(r.order.length, P.n);
    assert.deepEqual([...r.order].sort((a, b) => a - b), Array.from({ length: P.n }, (_, i) => i));
    assert.ok(Math.abs(r.length - r.legs.reduce((a, b) => a + b, 0)) < 1e-9);
  }
});

test('a fixed seed makes runs repeatable', () => {
  const { L, pts } = layouts()[1];
  const { stops, P } = problem(L, pts);
  const a = Ph.moldRoute(prepare(L).L, P, stops.map(s => s.point), { seed: 9, steps: 120 });
  const b = Ph.moldRoute(prepare(L).L, P, stops.map(s => s.point), { seed: 9, steps: 120 });
  assert.deepEqual(a.order, b.order);
  assert.deepEqual([...a.model.D], [...b.model.D]);
  const j1 = new Ph.JonesModel(L, [L.entrance, ...pts], { agents: 300, seed: 4 });
  const j2 = new Ph.JonesModel(L, [L.entrance, ...pts], { agents: 300, seed: 4 });
  for (let i = 0; i < 30; i++) { j1.step(); j2.step(); }
  assert.deepEqual([...j1.trail], [...j2.trail]);
});

test('agents stay off the shelves', () => {
  const L = tinyLayout();
  const j = new Ph.JonesModel(L, [L.entrance, [6, 5], [17, 2]], { agents: 500, seed: 1 });
  for (let i = 0; i < 60; i++) j.step();
  for (let i = 0; i < j.n; i++) assert.equal(j.walk[Math.floor(j.y[i]) * j.cols + Math.floor(j.x[i])], 1);
  assert.ok(j.n > 0);
});

test('cold items last also holds for the mold route', () => {
  const L = tinyLayout();
  const pts = [[3, 2], [6, 5], [9.2, 9], [17, 2]];
  const ctx = prepare(L);
  const stops = buildStops(ctx, pts.map((p, i) => ({ point: p, label: `s${i}`, where: '', aisle: null, cold: i === 0 })));
  const dist = distances(ctx, stops);
  const P = makeProblem({ D: dist.ap.D, start: 0, stops: dist.stopIds, ends: dist.endIds, cold: stops.map(s => s.cold), coldLast: true });
  const r = Ph.moldRoute(ctx.L, P, stops.map(s => s.point), { seed: 1, steps: 100 });
  assert.equal(P.cold[r.order[r.order.length - 1]], true);
});
