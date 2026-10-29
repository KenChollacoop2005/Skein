import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../js/layoutgen.js';
import { validateLayout, checkReachable, buildGrid, locate, findZone } from '../js/store.js';
import { readJSON } from './helpers.js';

test('generated layouts are valid with one or two rows', () => {
  for (const o of [{}, { rows: 2 }, { width: 60, depth: 45, rows: 2 }, { width: 70, aisles: 20, rtl: true, first: 3 }]) {
    const L = generateLayout(o);
    assert.deepEqual(validateLayout(L), [], JSON.stringify(o));
    assert.deepEqual(checkReachable(L, buildGrid(L)), [], JSON.stringify(o));
  }
});

test('one row means every aisle spans front to back', () => {
  const L = generateLayout({ rows: 1 });
  const fronts = new Set(L.aisles.map(a => a.start[1])), backs = new Set(L.aisles.map(a => a.end[1]));
  assert.equal(fronts.size, 1);
  assert.equal(backs.size, 1);
  assert.deepEqual(L.aisles.map(a => a.number), Array.from({ length: 25 }, (_, i) => String(i + 1)));
});

test('too many aisles for the width is refused', () => {
  assert.throws(() => generateLayout({ width: 40, aisles: 25 }));
});

test('the shipped placeholder is one row and places real items', () => {
  const L = readJSON('data/store.json');
  assert.equal(new Set(L.aisles.map(a => a.end[1])).size, 1);
  for (const it of readJSON('data/catalog.json').items) {
    if (it.loc && /^AISLE/.test(it.loc.description)) assert.ok(locate(L, it.loc), it.term);
  }
});

test('the longest matching zone wins', () => {
  const L = {
    zones: [
      { name: 'Produce', match: ['PRODUCE'], picks: [[1, 1]] },
      { name: 'Produce table 2', match: ['PRODUCE TABLE 2'], picks: [[5, 5]] },
      { name: 'Empty', match: ['PRODUCE TABLE 2 X'], picks: [] }
    ]
  };
  assert.equal(findZone(L, 'PRODUCE TABLE 2'), 1);
  assert.equal(findZone(L, 'PRODUCE'), 0);
  assert.equal(findZone(L, 'PRODUCE TABLE 2 X'), 1, 'zones without picks are skipped');
});
