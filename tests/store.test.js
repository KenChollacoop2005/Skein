import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import { gridGraph, allPairs, astar } from '../js/graph.js';
import { readJSON, rng, tinyLayout } from './helpers.js';

const store = S.normalizeLayout(readJSON('data/store.json'));
const grid = S.buildGrid(store);
const g = gridGraph(grid);

test('shipped layout is valid', () => {
  assert.deepEqual(S.validateLayout(store), []);
});

test('validation catches an aisle outside the outline', () => {
  const L = tinyLayout();
  L.aisles[1].start = [19.5, 11];
  L.aisles[1].end = [19.5, 3];
  assert.ok(S.validateLayout(L).some(p => /sticks out/.test(p.msg)));
});

test('validation catches overlapping aisles and duplicate numbers', () => {
  const L = tinyLayout();
  L.aisles[1].start = [7, 11];
  L.aisles[1].end = [7, 3];
  L.aisles[1].number = '1';
  const msgs = S.validateLayout(L).map(p => p.msg).join('\n');
  assert.match(msgs, /overlaps/);
  assert.match(msgs, /used twice/);
});

test('aisles sharing a shelf back are not an overlap', () => {
  assert.deepEqual(S.validateLayout(tinyLayout()), []);
});

test('every pick point and aisle end is reachable from the entrance', () => {
  assert.deepEqual(S.checkReachable(store, grid), []);
  const L = tinyLayout();
  assert.deepEqual(S.checkReachable(L, S.buildGrid(L)), []);
});

test('a walled off pick point is reported', () => {
  const L = tinyLayout();
  L.obstacles.push({ name: 'Wall', polygon: [[16, 0], [16.6, 0], [16.6, 4], [16, 4]] });
  L.obstacles.push({ name: 'Wall', polygon: [[16, 3.5], [20, 3.5], [20, 4.1], [16, 4.1]] });
  const problems = S.checkReachable(L, S.buildGrid(L));
  assert.ok(problems.some(p => /Dairy pick 3/.test(p.msg)));
});

function samplePoints(n, seed) {
  const r = rng(seed);
  const open = [];
  for (let i = 0; i < grid.walk.length; i++) if (grid.walk[i]) open.push(i);
  return Array.from({ length: n }, () => open[Math.floor(r() * open.length)]);
}

test('distances are symmetric', () => {
  const nodes = samplePoints(12, 3);
  const { D } = allPairs(g, nodes);
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
    assert.ok(Math.abs(D[i][j] - D[j][i]) < 1e-9);
  }
  const a = astar(g, nodes[0], nodes[1]).dist;
  const b = astar(g, nodes[1], nodes[0]).dist;
  assert.ok(Math.abs(a - b) < 1e-6 && Math.abs(a - D[0][1]) < 1e-6);
});

test('distances obey the triangle inequality', () => {
  const nodes = samplePoints(20, 7);
  const { D } = allPairs(g, nodes);
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) for (let k = 0; k < nodes.length; k++) {
    assert.ok(D[i][k] <= D[i][j] + D[j][k] + 1e-9);
  }
});

test('walking distance is at least the straight line', () => {
  const nodes = samplePoints(15, 11);
  const { D } = allPairs(g, nodes);
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
    const [x1, y1] = S.cellCenter(grid, nodes[i]), [x2, y2] = S.cellCenter(grid, nodes[j]);
    assert.ok(D[i][j] >= Math.hypot(x2 - x1, y2 - y1) - 1e-9);
  }
});

test('aisle points follow bay 1 end and side', () => {
  const a = { number: '1', start: [5, 20], end: [5, 0], width: 2, bays: 10, bay1: 'start', flip: false };
  const [x1, y1] = S.aislePoint(a, 1, 'L');
  const [x10] = S.aislePoint(a, 10, 'R');
  assert.ok(y1 > 18 && y1 < 20);
  assert.ok(x1 < 5, 'L is on the left walking start to end');
  assert.ok(x10 > 5);
  const [, yEnd] = S.aislePoint({ ...a, bay1: 'end' }, 1, 'L');
  assert.ok(yEnd < 2);
  const [xf] = S.aislePoint({ ...a, flip: true }, 1, 'L');
  assert.ok(xf > 5);
});

test('catalog locations map to zones and aisles', () => {
  const dairy = S.locate(store, { number: '100', description: 'DAIRY', bay: '25' });
  assert.equal(store.zones[dairy.zone].name, 'Dairy');
  assert.equal(dairy.cold, true);
  const pb = S.locate(store, { number: '14', description: 'AISLE 14', bay: '14', side: 'L' });
  assert.equal(store.aisles[pb.aisle].number, '14');
  assert.match(pb.where, /Aisle 14, bay 14/);
  assert.equal(S.locate(store, { number: '0', description: 'GROCERY' }), null);
  const lo = S.locate(store, { number: '100', description: 'DAIRY', bay: '1' });
  const hi = S.locate(store, { number: '100', description: 'DAIRY', bay: '40' });
  assert.notEqual(lo.pick, hi.pick);
});

test('every real catalog aisle number exists in the layout', () => {
  const nums = new Set(store.aisles.map(a => a.number));
  for (const it of readJSON('data/catalog.json').items) {
    if (it.loc && /^AISLE/.test(it.loc.description)) assert.ok(nums.has(it.loc.number), it.loc.number);
  }
});

test('lengths can be typed in steps', () => {
  assert.equal(S.parseLength('12', 0.7), 12);
  assert.equal(S.parseLength('10 steps', 0.7), 7);
  assert.equal(S.parseLength('4s', 0.75), 3);
  assert.ok(Number.isNaN(S.parseLength('abc', 0.7)));
});

test('layout survives a save and load round trip', () => {
  const text = JSON.stringify(store);
  const back = S.normalizeLayout(text);
  assert.deepEqual(back, store);
  const messy = S.normalizeLayout({ outline: [[0, 0], [1, 'x'], [5, 0], [5, 5]], aisles: [{ number: 3, bays: '7' }] });
  assert.equal(messy.outline.length, 3);
  assert.equal(messy.aisles[0].number, '3');
  assert.equal(messy.aisles[0].bays, 7);
});
