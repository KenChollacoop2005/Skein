import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/route.js';
import { rng } from './helpers.js';

// Random points, Euclidean distances
function instance(rand, nStops, { ends = 2, coldLast = false, penalty = 0 } = {}) {
  const N = 1 + nStops + ends;
  const p = Array.from({ length: N }, () => [rand() * 60, rand() * 45]);
  const D = p.map(a => p.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])));
  const stops = Array.from({ length: nStops }, (_, i) => i + 1);
  const endIds = Array.from({ length: ends }, (_, i) => nStops + 1 + i);
  return R.makeProblem({
    D, start: 0, stops, ends: endIds, coldLast, penalty,
    cold: stops.map(() => rand() < 0.3),
    aisle: stops.map(() => (rand() < 0.6 ? Math.floor(rand() * 4) : null))
  });
}

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
}

function bruteForce(P) {
  let best = Infinity;
  for (const order of permutations(Array.from({ length: P.n }, (_, i) => i))) {
    if (!R.isValidOrder(P, order)) continue;
    best = Math.min(best, R.cost(P, order));
  }
  return best;
}

test('Held and Karp equals brute force on 300 random instances', () => {
  const rand = rng(42);
  for (let t = 0; t < 300; t++) {
    const n = 2 + (t % 7);
    const P = instance(rand, n, { ends: 1 + (t % 3), coldLast: t % 2 === 0, penalty: t % 3 === 0 ? 5 : 0 });
    const exact = R.heldKarp(P);
    assert.ok(Math.abs(exact.cost - bruteForce(P)) < 1e-6, `instance ${t}`);
  }
});

test('heuristic is never shorter than exact and is close on 12 stops', () => {
  const rand = rng(7);
  let ratio = 0;
  const runs = 40;
  for (let t = 0; t < runs; t++) {
    const P = instance(rand, 12, { coldLast: t % 2 === 1 });
    const exact = R.heldKarp(P);
    const heur = R.heuristic(P, { seed: t + 1 });
    assert.ok(heur.cost >= exact.cost - 1e-6);
    ratio += heur.cost / exact.cost;
  }
  assert.ok(ratio / runs - 1 < 0.03, `average gap ${(ratio / runs - 1) * 100}%`);
});

test('lower bound is never above the optimum', () => {
  const rand = rng(99);
  for (let t = 0; t < 60; t++) {
    const P = instance(rand, 3 + (t % 10), { penalty: t % 2 ? 4 : 0, coldLast: t % 3 === 0 });
    const exact = R.heldKarp(P);
    const lb = R.lowerBound(P);
    assert.ok(lb <= exact.cost + 1e-6, `instance ${t}`);
    assert.ok(lb > 0);
  }
});

test('cold items last is respected by every solver', () => {
  const rand = rng(5);
  for (let t = 0; t < 40; t++) {
    const P = instance(rand, 4 + (t % 18), { coldLast: true });
    const results = [R.nearestNeighbor(P), R.heuristic(P, { seed: t }), R.keyOrder(P, P.stops.map(() => rand()))];
    if (P.n <= R.EXACT_MAX) results.push(R.heldKarp(P));
    for (const r of results) assert.ok(R.isValidOrder(P, r.order), `${r.method} broke the rule`);
  }
});

test('route length equals the sum of its legs', () => {
  const rand = rng(12);
  for (let t = 0; t < 30; t++) {
    const P = instance(rand, 1 + (t % 20), { penalty: 3 });
    const r = R.solve(P, { seed: 3 });
    assert.equal(r.legs.length, P.n + 1);
    assert.ok(Math.abs(r.length - r.legs.reduce((a, b) => a + b, 0)) < 1e-9);
    assert.ok(r.cost >= r.length - 1e-9);
    assert.equal(r.nodes[0], P.start);
    assert.ok(P.ends.includes(r.end));
  }
});

test('the aisle penalty favors staying in an aisle', () => {
  const D = [[0, 10, 11, 1, 20], [10, 0, 1, 9, 10], [11, 1, 0, 10, 9], [1, 9, 10, 0, 19], [20, 10, 9, 19, 0]];
  const base = { D, start: 0, stops: [1, 2, 3], ends: [4], aisle: ['A', 'A', null] };
  const plain = R.heldKarp(R.makeProblem(base));
  const pen = R.heldKarp(R.makeProblem({ ...base, penalty: 50 }));
  assert.ok(pen.length >= plain.length - 1e-9);
  const pos = pen.order.map(i => base.aisle[i]);
  assert.ok(pos.join() === 'A,A,' || pos.join() === ',A,A');
});

test('empty list walks straight to the nearest register', () => {
  const D = [[0, 5, 3], [5, 0, 2], [3, 2, 0]];
  const r = R.solve(R.makeProblem({ D, start: 0, stops: [], ends: [1, 2] }));
  assert.equal(r.end, 2);
  assert.equal(r.length, 3);
});

test('large lists use the heuristic and report a bound', () => {
  const P = instance(rng(4), 25);
  const r = R.solve(P, { seed: 1 });
  assert.equal(r.exact, false);
  assert.ok(r.bound > 0 && r.bound <= r.cost + 1e-9);
  assert.ok(r.gap >= 0 && r.gap < 0.25);
});

test('exact solve at 16 stops takes under a second', () => {
  const P = instance(rng(16), 16, { coldLast: true, penalty: 2 });
  const t0 = performance.now();
  const r = R.heldKarp(P);
  const ms = performance.now() - t0;
  assert.equal(r.order.length, 16);
  assert.ok(ms < 1000, `${ms} ms`);
});
