import { readFile, writeFile } from 'node:fs/promises';
import { findLocations, pickStore, searchProducts, pickProduct, toEntry, callCount } from './kroger.mjs';

const ITEMS = new URL('./starter-items.txt', import.meta.url);
const OUT = new URL('../data/catalog.json', import.meta.url);
const PER_TERM = 10; // products fetched per term

const terms = (await readFile(ITEMS, 'utf8')).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

const locations = await findLocations();
const wanted = process.env.KROGER_LOCATION_ID;
const store = wanted ? locations.find(l => l.locationId === wanted) || { locationId: wanted } : pickStore(locations);
if (!store) throw new Error('Target store not found. Run tools/kroger.mjs locations and set KROGER_LOCATION_ID.');
console.log(`Store ${store.locationId}`);

const items = [];
let missing = 0;
for (const term of terms) {
  try {
    const p = pickProduct(await searchProducts(term, store.locationId, PER_TERM), term);
    if (!p) { missing++; continue; }
    const entry = toEntry(p, term);
    if (!entry.loc) missing++;
    items.push(entry);
  } catch (e) {
    console.error(`${term}: ${e.message}`);
    if (/limit/i.test(e.message)) break;
  }
}

const catalog = {
  sample: false,
  built: new Date().toISOString().slice(0, 10),
  store: {
    locationId: store.locationId,
    name: store.name || 'Kroger',
    address: store.address ? `${store.address.addressLine1}, ${store.address.city}, ${store.address.state}` : ''
  },
  items
};
await writeFile(OUT, JSON.stringify(catalog, null, 1) + '\n');
console.log(`Saved ${items.length} items (${missing} without a location) using ${callCount()} calls.`);
