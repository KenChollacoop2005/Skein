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

test('marked corners survive simplifying', () => {
  const line = [];
  for (let i = 0; i <= 20; i++) line.push([i, i === 10 ? 0.6 : 0]);
  assert.equal(T.simplify(line, 1).length, 2);
  assert.equal(T.simplify(line, 1, [10]).length, 3);
});

test('an L shaped store with 45 degree snapping still closes', () => {
  const r = rng(11);
  const walk = T.newWalk(STEP, 45);
  const snapper = new TurnSnapper({ step: 45, hold: 30 });
  const leg = (m, h) => { for (let i = 0; i < Math.round(m / STEP); i++) { const raw = h + (r() - 0.5) * 24; walk.steps.push({ t: 0, h: snapper.update(raw), r: raw }); } };
  leg(30, 0); T.markAt(walk, 'corner'); leg(20, 90); leg(14, 135); leg(15, 180); leg(20, 270); leg(15, 270);
  T.markAt(walk, 'perimeter-end');
  const { layout, report } = T.buildLayout(walk);
  assert.ok(layout.outline.length >= 5, `corners ${layout.outline.length}`);
  assert.ok(report.closure != null);
  assert.ok(layout.outline.some(([x, y], i) => {
    const [px, py] = layout.outline[(i + layout.outline.length - 1) % layout.outline.length];
    const a = Math.abs(Math.atan2(y - py, x - px) * 180 / Math.PI) % 90;
    return a > 20 && a < 70;
  }), 'keeps the angled wall');
});

function walkedAisle(num, x, front, back, wobble = 0) {
  return { number: String(num), start: [x + wobble, front], end: [x - wobble, back], width: 2.1, shelf: 0.6, bays: 10, bay1: 'start', flip: false, cold: false };
}

test('one row: aisles line up, space evenly and fill gaps', () => {
  const walked = [walkedAisle(1, 10, 40.8, 9.5, 0.4), walkedAisle(2, 13.6, 39.2, 10.6, -0.3), walkedAisle(5, 23.1, 40.1, 9.9, 0.2), walkedAisle(6, 26.4, 39.8, 10.2)];
  const { aisles, filled } = T.arrangeAisles(walked, 1);
  assert.deepEqual(filled, ['3', '4']);
  assert.deepEqual(aisles.map(a => a.number), ['1', '2', '3', '4', '5', '6']);
  const fronts = aisles.map(a => a.start[1]), backs = aisles.map(a => a.end[1]);
  assert.ok(Math.max(...fronts) - Math.min(...fronts) < 0.3);
  assert.ok(Math.max(...backs) - Math.min(...backs) < 0.3);
  const xs = aisles.map(a => (a.start[0] + a.end[0]) / 2);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.05, 'even spacing');
  assert.ok(aisles.every(a => a.width + 2 * a.shelf <= gaps[0] + 1e-9), 'no overlap');
  const raw = T.arrangeAisles(walked, 1, { lineUp: false, even: false, fill: false });
  assert.equal(raw.aisles.length, 4);
});

test('two rows are lined up separately', () => {
  const walked = [walkedAisle(1, 10, 20, 6), walkedAisle(3, 16.6, 20.5, 6.4), walkedAisle(14, 10, 38, 24), walkedAisle(16, 16.6, 37.6, 23.5)];
  const { aisles, filled } = T.arrangeAisles(walked, 2);
  assert.deepEqual(filled.sort(), ['15', '2']);
  const back = aisles.filter(a => +a.number < 14), front = aisles.filter(a => +a.number >= 14);
  assert.ok(back.every(a => a.start[1] < 22) && front.every(a => a.end[1] > 22));
});

test('departments map to Kroger words with fallbacks', () => {
  const marks = [
    { type: 'zone', label: 'Fruit', step: 0 }, { type: 'zone', label: 'Meat', step: 1 },
    { type: 'zone', label: 'Produce table', number: '2', step: 2 }, { type: 'zone', label: 'Deli', step: 3 },
    { type: 'zone', label: 'Hot case', match: ['HOT CASE'], step: 4 }
  ];
  const zones = T.zonesFrom(marks, m => [m.step * 5, 0]);
  const z = name => zones.find(x => x.name === name);
  assert.ok(z('Fruit').match.includes('PRODUCE'), 'unmarked Produce goes to Fruit');
  assert.ok(z('Fruit').match.includes('VEGETABLES'));
  assert.ok(z('Meat').match.includes('SEAFOOD'), 'unmarked Seafood goes to Meat');
  assert.deepEqual(z('Produce table 2').match, ['PRODUCE TABLE 2']);
  assert.ok(z('Deli').match.includes('SUSHI'));
  assert.deepEqual(z('Hot case').match, ['HOT CASE']);
});
