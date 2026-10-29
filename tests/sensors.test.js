import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sn from '../js/sensors.js';
import { rng } from './helpers.js';

const RATE = 50; // samples per second
const G = 9.81;

function walkSignal(seconds, cadence, amp, seed) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < seconds * RATE; i++) {
    const t = i / RATE;
    const z = G + amp * Math.sin(2 * Math.PI * cadence * t) + (r() - 0.5) * 0.6;
    out.push([t * 1000, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4, z]);
  }
  return out;
}

const count = samples => {
  const d = new Sn.StepDetector();
  for (const s of samples) d.push(...s);
  return d.count;
};

test('step detector counts steps on a synthetic walk', () => {
  for (const [cadence, seed] of [[1.6, 1], [2.0, 2], [2.3, 3]]) {
    const n = count(walkSignal(30, cadence, 2.5, seed));
    const expected = 30 * cadence;
    assert.ok(Math.abs(n - expected) <= 2, `cadence ${cadence}: ${n} vs ${expected}`);
  }
});

test('standing still counts no steps', () => {
  assert.equal(count(walkSignal(20, 2, 0, 4)), 0);
});

test('a single bump counts at most one step', () => {
  const s = walkSignal(10, 2, 0, 5);
  for (let i = 200; i < 205; i++) s[i][3] += 6;
  assert.ok(count(s) <= 1);
});

test('angle differences wrap at 360', () => {
  assert.equal(Sn.angleDiff(10, 350), 20);
  assert.equal(Sn.angleDiff(350, 10), -20);
  assert.equal(Sn.angleDiff(180, 0), 180);
});

test('heading filter smooths across north', () => {
  const f = new Sn.HeadingFilter(0.5);
  for (const h of [355, 5, 358, 2, 0]) f.push(h);
  assert.ok(Math.abs(Sn.angleDiff(f.value, 0)) < 5);
});

test('turn snapper ignores wobble and catches real turns', () => {
  const s = new Sn.TurnSnapper();
  for (const h of [10, -25, 30, 40, -35]) assert.equal(s.update(h), 0);
  assert.equal(s.update(85), 90);
  assert.equal(s.update(60), 90);
  assert.equal(s.update(185), 180);
  assert.equal(s.update(-92), 270);
});

test('advance moves forward, right, back and left', () => {
  const close = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  assert.ok(close(Sn.advance([0, 0], 0, 1), [0, -1]));
  assert.ok(close(Sn.advance([0, 0], 90, 1), [1, 0]));
  assert.ok(close(Sn.advance([0, 0], 180, 1), [0, 1]));
  assert.ok(close(Sn.advance([0, 0], 270, 1), [-1, 0]));
});

test('readHeading handles iPhone and Android events', () => {
  assert.equal(Sn.readHeading({ webkitCompassHeading: 45 }), 45);
  assert.equal(Sn.readHeading({ absolute: true, alpha: 90 }), 270);
  assert.equal(Sn.readHeading({ absolute: false, alpha: 90 }), null);
  assert.equal(Sn.stepFromHeight(170), 0.71);
});
