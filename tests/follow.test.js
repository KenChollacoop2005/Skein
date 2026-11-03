import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTrack, pointAt, trailTo, Trip } from '../js/follow.js';
import * as P from '../js/plan.js';
import { readJSON } from './helpers.js';

// Route up 10 m, right 10 m, down 10 m; stops at the two corners
const line = [[0, 0], [0, -5], [0, -10], [5, -10], [10, -10], [10, 0]];
const track = routeTrack(line, [0, 2, 4, 5]);

test('stops sit at their distance along the route', () => {
  assert.equal(track.total, 30);
  assert.deepEqual(track.stopAt, [10, 20]);
  const mid = pointAt(track, 15);
  assert.deepEqual(mid.p, [5, -10]);
  assert.equal(Math.round(mid.heading), 90);
  assert.equal(Math.round(pointAt(track, 2).heading), 0);
  assert.deepEqual(trailTo(track, 12).at(-1), [2, -10]);
});

test('the dot moves with steps and waits near an unchecked stop', () => {
  const trip = new Trip(track, [1, 2]);
  for (let i = 0; i < 10; i++) trip.step(0.7);
  assert.ok(Math.abs(trip.d - 7) < 1e-9);
  for (let i = 0; i < 40; i++) trip.step(0.7);
  assert.ok(Math.abs(trip.d - 12.5) < 1e-9, 'waits 2.5 m past stop 1');
  assert.ok(trip.isNear());
  trip.toggleItem(0, 0);
  for (let i = 0; i < 40; i++) trip.step(0.7);
  assert.ok(Math.abs(trip.d - 22.5) < 1e-9, 'then waits at stop 2');
});

test('checking a stop ahead snaps you forward, never back', () => {
  const trip = new Trip(track, [1, 2]);
  trip.toggleStop(1);
  assert.equal(trip.d, 20);
  assert.equal(trip.next(), -1, 'stop 1 is behind you now');
  trip.toggleStop(0);
  assert.equal(trip.d, 20);
  for (let i = 0; i < 40; i++) trip.step(1);
  assert.equal(trip.d, 30, 'walks to the register');
  assert.ok(trip.allDone());
});

test('a stop is done only when all its items are checked', () => {
  const trip = new Trip(track, [1, 2]);
  trip.toggleItem(1, 0);
  assert.equal(trip.stopDone(1), false);
  assert.equal(trip.d, 0, 'one of two items does not move you');
  trip.toggleItem(1, 1);
  assert.equal(trip.stopDone(1), true);
  trip.toggleItem(1, 1);
  assert.equal(trip.stopDone(1), false);
});

test("I'm here jumps to the next stop", () => {
  const trip = new Trip(track, [1, 1]);
  assert.equal(trip.here(), 0);
  assert.equal(trip.d, 10);
});

test('progress survives a save and reload', () => {
  const trip = new Trip(track, [1, 2]);
  trip.toggleItem(1, 1);
  trip.step(3);
  const again = new Trip(track, [1, 2]);
  assert.ok(again.restore(JSON.parse(JSON.stringify(trip))));
  assert.deepEqual(again.checked, trip.checked);
  assert.equal(again.d, trip.d);
  assert.equal(new Trip(track, [1, 3]).restore(trip.toJSON()), false, 'a different list is not restored');
});

test('a real plan gives a stop position for every stop, in order', () => {
  const ctx = P.prepare(readJSON('data/stores/kroger-university-city.json'));
  const spots = [[20, 9.2], [40, 30], [60, 20], [70, 47]].map((p, i) => ({ point: p, label: `s${i}`, where: '', aisle: null }));
  const plan = P.planRoute(ctx, P.buildStops(ctx, spots), {});
  const t = routeTrack(plan.line, plan.breaks);
  assert.equal(t.stopAt.length, plan.stops.length);
  for (let i = 1; i < t.stopAt.length; i++) assert.ok(t.stopAt[i] >= t.stopAt[i - 1]);
  for (let i = 0; i < t.stopAt.length; i++) {
    const p = pointAt(t, t.stopAt[i]).p;
    assert.ok(Math.hypot(p[0] - plan.stops[i].point[0], p[1] - plan.stops[i].point[1]) < 0.8, `stop ${i} on the line`);
  }
});
