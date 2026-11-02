import { normalizeLayout } from './store.js';
import { buildLayout } from './trace.js';
import { load, save, remove } from './storage.js';

export const INDEX = 'data/stores/index.json'; // shipped store list
const SHIPPED = 'shipped:'; // id prefix for stores in the repo
const MINE = 'mine:'; // id prefix for stores saved on this phone

export const SOURCE_LABELS = { shipped: 'Comes with Skein', mine: 'Made by you', copy: 'Your copy', file: 'From a file', traced: 'Traced by walking' };

// Saved stores, with storage and fetch passed in
export function makeStores({ load, save, remove, fetchJSON }) {
  let index = null;
  const shipped = async () => (index ||= await fetchJSON(INDEX));
  const mine = () => load('stores', []) || [];
  const keep = list => { if (!save('stores', list)) throw new Error('This phone ran out of room to save stores.'); };

  // Old single layout becomes a saved store
  function migrate() {
    const old = load('layout', null);
    if (!old) return;
    const list = mine();
    const id = `${MINE}${Date.now().toString(36)}`;
    list.push({ id, name: uniqueName('My layout', list), source: 'mine', updated: Date.now(), layout: normalizeLayout(old) });
    keep(list);
    save('currentStore', id);
    remove('layout');
  }

  function uniqueName(name, list = mine()) {
    const base = String(name || 'Store').trim() || 'Store';
    let out = base, k = 2;
    while (list.some(s => s.name === out)) out = `${base} ${k++}`;
    return out;
  }

  async function list() {
    migrate();
    const sh = await shipped();
    return [
      ...sh.stores.map(s => ({ id: SHIPPED + s.id, name: s.name, source: 'shipped', note: s.note || '' })),
      ...mine().map(s => ({ id: s.id, name: s.name, source: s.source, updated: s.updated }))
    ];
  }

  async function layoutOf(id) {
    if (id.startsWith(SHIPPED)) {
      const sh = await shipped();
      const entry = sh.stores.find(s => SHIPPED + s.id === id);
      if (!entry) throw new Error('That store is not in Skein anymore.');
      return normalizeLayout(await fetchJSON(entry.file));
    }
    const rec = mine().find(s => s.id === id);
    if (!rec) throw new Error('That store was deleted.');
    return normalizeLayout(rec.layout);
  }

  async function current() {
    migrate();
    const sh = await shipped();
    const id = load('currentStore', null);
    const all = await list();
    const pick = all.find(s => s.id === id) || all.find(s => s.id === SHIPPED + sh.default) || all[0];
    return { ...pick, layout: await layoutOf(pick.id) };
  }

  function setCurrent(id) { save('currentStore', id); }

  function add(name, layout, source = 'mine') {
    const list = mine();
    const id = `${MINE}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    list.push({ id, name: uniqueName(name, list), source, updated: Date.now(), layout: normalizeLayout(layout) });
    keep(list);
    return id;
  }

  // Saves edits; a shipped store gets copied first
  async function saveCurrent(layout) {
    const cur = await current();
    if (cur.source === 'shipped') {
      const id = add(`${cur.name} (my copy)`, layout, 'copy');
      setCurrent(id);
      return { id, copied: true, name: mine().find(s => s.id === id).name };
    }
    const list = mine();
    const rec = list.find(s => s.id === cur.id);
    rec.layout = normalizeLayout(layout);
    rec.updated = Date.now();
    keep(list);
    return { id: rec.id, copied: false, name: rec.name };
  }

  function rename(id, name) {
    const list = mine();
    const rec = list.find(s => s.id === id);
    if (!rec || !String(name).trim()) return false;
    rec.name = uniqueName(name, list.filter(s => s.id !== id));
    keep(list);
    return true;
  }

  function removeStore(id) {
    keep(mine().filter(s => s.id !== id));
    if (load('currentStore', null) === id) remove('currentStore');
  }

  async function copy(id) {
    const all = await list();
    const from = all.find(s => s.id === id);
    return add(`${from ? from.name : 'Store'} (copy)`, await layoutOf(id), 'copy');
  }

  // A layout file or a raw walk file from Setup
  function importText(text, fileName = 'store.json') {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not JSON.'); }
    if (data && Array.isArray(data.steps) && Array.isArray(data.marks)) {
      const { layout } = buildLayout(data);
      if (layout.outline.length < 3) throw new Error('That walk has no finished loop, so it has no outline.');
      return add(`Traced store ${String(data.started || '').slice(0, 10)}`.trim(), layout, 'traced');
    }
    const layout = normalizeLayout(data);
    if (layout.outline.length < 3) throw new Error('That file has no store outline.');
    const name = data.name || String(fileName).replace(/\.json$/i, '');
    return add(name, layout, 'file');
  }

  return { list, current, layoutOf, setCurrent, add, saveCurrent, rename, remove: removeStore, copy, importText };
}

export function browserStores() {
  return makeStores({
    load, save, remove,
    fetchJSON: url => fetch(url).then(r => { if (!r.ok) throw new Error(`Could not load ${url}`); return r.json(); })
  });
}
