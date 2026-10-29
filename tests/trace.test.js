import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/trace.js';
import { TurnSnapper } from '../js/sensors.js';
import { validateLayout, checkReachable, buildGrid, bounds } from '../js/store.js';
import { rng } from './helpers.js';

const STEP = 0.7;

// Simulated walker with wobbly compass and uneven steps
function walker(seed, snap = true) {
  const r = rng(seed);
  const walk = T.newWalk(STEP, snap);
  const snapper = new TurnSnapper();
  let truth = 0;
  return {
    walk,
    leg(meters, heading) {
      truth = heading;
      const steps = Math.round(meters / STEP);
      for (let i = 0; i < steps; i++) {
        const raw = truth + (r() - 0.5) * 50;
        walk.steps.push({ t: 0, h: snap ? snapper.update(raw) : raw, r: raw });
      }
    },
    mark(type, extra) { T.markAt(walk, type, extra); }
  };
}

// Perimeter of a 42 by 28 m path, exit 2 steps right
function storeWalk(seed) {
  const w = walker(seed);
  w.walk.exit = { steps: 2, side: 'right' };
  w.leg(14, 0); w.mark('zone', { label: 'Produce' }); w.leg(14, 0);
  w.leg(21, 90); w.mark('zone', { label: 'Meat' }); w.leg(21, 90);
  w.leg(14, 180); w.mark('zone', { label: 'Dairy' }); w.leg(14, 180);
  w.leg(42 - 1.4, 270);
  w.mark('perimeter-end');
  w.leg(4, 0); w.leg(10, 90); w.mark('register'); w.leg(3, 90); w.mark('register');
  w.leg(3, 0); w.leg(4, 270);
  for (let k = 0; k < 3; k++) {
    w.mark('aisle-start', { number: k + 1 });
    w.leg(18, 0);
    w.mark('aisle-end');
    w.leg(4, 90);
    w.leg(18, 180);
  }
  return w.walk;
}

test('loop closure moves the end onto the target', () => {
  const pts = [[0, 0], [0, -10], [10, -10], [10, 0], [1, 1]];
  const fixed = T.closeLoop(pts, 4, [0, 0]);
  assert.deepEqual(fixed[0], [0, 0]);
  assert.ok(Math.hypot(...fixed[4]) < 1e-9);
});

test('simplify keeps only the corners', () => {
  const line = [];
  for (let i = 0; i <= 10; i++) line.push([i, 0.05 * (i % 2)]);
  for (let i = 1; i <= 10; i++) line.push([10, i]);
  const s = T.simplify(line, 0.5);
  assert.equal(s.length, 3);
});

test('outline offset grows a square outward', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  for (const poly of [sq, [...sq].reverse()]) {
    const b = bounds(T.offsetOutline(poly, 1));
    assert.deepEqual([b.x0, b.y0, b.x1, b.y1].map(v => Math.round(v * 1000) / 1000), [-1, -1, 11, 11]);
  }
});

test('a simulated store walk becomes a valid layout', () => {
  const { layout, report } = T.buildLayout(storeWalk(7));
  assert.ok(report.closure < 3, `closure ${report.closure}`);
  assert.equal(report.aisles, 3);
  assert.equal(report.registers, 2);
  assert.equal(layout.zones.length, 3);
  assert.equal(layout.placeholder, false);
  const b = bounds(layout.outline);
  assert.ok(Math.abs(b.x1 - b.x0 - (42 + 2 * T.WALL_GAP)) < 2, `width ${b.x1 - b.x0}`);
  assert.ok(Math.abs(b.y1 - b.y0 - (28 + 2 * T.WALL_GAP)) < 2, `depth ${b.y1 - b.y0}`);
  assert.deepEqual(validateLayout(layout), []);
  assert.deepEqual(checkReachable(layout, buildGrid(layout)), []);
  assert.ok(layout.aisles.every(a => a.bays >= 10 && a.bays <= 20));
});

test('an unfinished walk still builds without crashing', () => {
  const w = walker(3);
  w.leg(10, 0);
  const { layout, report } = T.buildLayout(w.walk);
  assert.equal(layout.outline.length, 0);
  assert.ok(report.warnings.length > 0);
});
