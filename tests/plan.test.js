import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/plan.js';
import * as M from '../js/match.js';
import { readJSON } from './helpers.js';

const ctx = P.prepare(readJSON('data/store.json'));
const catalog = readJSON('data/catalog.json');
const index = M.buildIndex(catalog.items);

function spotsFor(list) {
  return M.parseList(list).map(({ text, key }) => {
    const { best, alts } = M.matchLine(key, index);
    const spot = P.resolveSpot(ctx.L, { item: best?.item, line: text, alts });
    return spot && { ...spot, label: text };
  }).filter(Boolean);
}

test('a real list plans a full route', () => {
  const spots = spotsFor('milk, eggs, peanut butter, bananas, ground beef, frozen pizza, cereal, coffee, bagels, crackers');
  assert.equal(spots.length, 10);
  const stops = P.buildStops(ctx, spots);
  const plan = P.planRoute(ctx, stops, {});
  assert.equal(plan.stops.length, stops.length);
  assert.ok(Math.abs(plan.length - plan.legs.reduce((a, b) => a + b, 0)) < 1e-9);
  assert.ok(plan.length <= plan.baseline + 1e-9);
  assert.ok(plan.exact);
  assert.ok(plan.line.length >= 2);
});

test('items at the same spot merge into one stop', () => {
  const spots = [
    { point: [30, 4], label: 'a', where: 'Meat', aisle: null },
    { point: [30.1, 4.1], label: 'b', where: 'Meat', aisle: null },
    { point: [10, 30], label: 'c', where: 'Produce', aisle: null }
  ];
  const stops = P.buildStops(ctx, spots);
  assert.equal(stops.length, 2);
  assert.deepEqual(stops[0].items, ['a', 'b']);
});

test('items with only a department fall back to a similar item', () => {
  const s = spotsFor('crackers')[0];
  assert.ok(s.approx);
  assert.match(s.where, /near/);
});

test('cold items last puts every cold stop at the end', () => {
  const stops = P.buildStops(ctx, spotsFor('milk, ice cream, bread, cereal, ground beef, apples, coffee'));
  const plan = P.planRoute(ctx, stops, { coldLast: true });
  const cold = plan.stops.map(s => s.cold);
  assert.ok(cold.indexOf(true) >= 0);
  assert.ok(cold.slice(cold.indexOf(true)).every(Boolean));
});

test('fewer turns reports its distance cost', () => {
  const stops = P.buildStops(ctx, spotsFor('peanut butter, cereal, coffee, ibuprofen, water, bagels, pasta sauce, rice'));
  const plan = P.planRoute(ctx, stops, { fewerTurns: true });
  assert.ok(plan.turnCost >= -1e-9);
});

test('aisle order walks columns left to right in a snake', () => {
  const keys = P.aisleKeys(ctx.L, [[50, 10], [11, 30], [11, 10], [3, 10], [3, 30]]);
  assert.ok(keys[4] < keys[3], 'left wall goes front to back');
  assert.ok(keys[3] < keys[2], 'then the first aisle column');
  assert.ok(keys[2] < keys[1], 'which comes back to the front');
  assert.ok(keys[1] < keys[0], 'columns go left to right');
});
