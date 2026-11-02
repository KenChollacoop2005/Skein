import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStores } from '../js/stores.js';
import { newWalk, markAt } from '../js/trace.js';
import { readJSON, tinyLayout } from './helpers.js';

function memory(seed = {}) {
  const box = { ...seed };
  return {
    box,
    load: (k, f = null) => (k in box ? JSON.parse(box[k]) : f),
    save: (k, v) => { box[k] = JSON.stringify(v); return true; },
    remove: k => { delete box[k]; },
    fetchJSON: async path => readJSON(path)
  };
}

test('the traced store is the default and shipped stores are listed', async () => {
  const s = makeStores(memory());
  const cur = await s.current();
  assert.equal(cur.id, 'shipped:kroger-university-city');
  assert.equal(cur.layout.aisles.length, 24);
  const ids = (await s.list()).map(x => x.id);
  assert.deepEqual(ids, ['shipped:kroger-university-city', 'shipped:generic']);
});

test('editing a shipped store saves a copy and switches to it', async () => {
  const m = memory();
  const s = makeStores(m);
  const cur = await s.current();
  cur.layout.name = 'edited';
  const r = await s.saveCurrent(cur.layout);
  assert.equal(r.copied, true);
  const now = await s.current();
  assert.equal(now.id, r.id);
  assert.equal(now.source, 'copy');
  const again = await s.saveCurrent(now.layout);
  assert.equal(again.copied, false);
  assert.equal((await s.list()).length, 3);
});

test('stores can be added, renamed, copied and deleted', async () => {
  const s = makeStores(memory());
  const a = s.add('Home store', tinyLayout());
  const b = s.add('Home store', tinyLayout());
  const names = (await s.list()).filter(x => x.source === 'mine').map(x => x.name);
  assert.deepEqual(names, ['Home store', 'Home store 2']);
  assert.ok(s.rename(b, 'Other store'));
  const c = await s.copy('shipped:generic');
  assert.equal((await s.layoutOf(c)).aisles.length, 25);
  s.setCurrent(a);
  s.remove(a);
  assert.equal((await s.current()).id, 'shipped:kroger-university-city');
});

test('import takes a layout file or a raw walk file', async () => {
  const s = makeStores(memory());
  const id = s.importText(JSON.stringify(tinyLayout()), 'tiny.json');
  assert.equal((await s.layoutOf(id)).aisles.length, 2);
  const walk = newWalk(0.7, 90);
  for (const [n, h] of [[20, 0], [15, 90], [20, 180], [15, 270]]) for (let i = 0; i < n; i++) walk.steps.push({ t: 0, h, r: h });
  markAt(walk, 'perimeter-end');
  const wid = s.importText(JSON.stringify(walk));
  const traced = (await s.list()).find(x => x.id === wid);
  assert.equal(traced.source, 'traced');
  assert.ok((await s.layoutOf(wid)).outline.length >= 4);
  assert.throws(() => s.importText('not json'));
  assert.throws(() => s.importText('{"name":"empty"}'));
});

test('an old single saved layout moves into the store list', async () => {
  const m = memory({ layout: JSON.stringify(tinyLayout()) });
  const s = makeStores(m);
  const cur = await s.current();
  assert.equal(cur.name, 'My layout');
  assert.equal(cur.layout.name, 'Tiny');
  assert.ok(!('layout' in m.box));
});

test('the traced store fits the walk description', async () => {
  const L = readJSON('data/stores/kroger-university-city.json');
  const produce = L.zones.find(z => z.name === 'Produce');
  assert.ok(produce.clear);
  const short = L.aisles.filter(a => a.start[1] < 38).map(a => a.number);
  assert.deepEqual(short, ['2', '3', '4', '5'], 'beer and wine aisles stop above produce');
  assert.equal(L.aisles[0].number, '2', 'no aisle 1 in the Kroger data');
  const meat = L.zones.find(z => z.name === 'Meat');
  assert.ok(meat.picks.length >= 6 && meat.picks[0][0] > meat.picks[meat.picks.length - 1][0], 'meat spans the back wall, bay 1 on the right');
  const xs = L.aisles.map(a => a.start[0]);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), 'aisle 1 on the left, 25 on the right');
});
