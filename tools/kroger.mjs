import { fileURLToPath } from 'node:url';

const API = 'https://api.kroger.com/v1';
const PACE_MS = 350; // min gap between API calls
const MAX_CALLS = 1500; // hard stop per run
const TARGET_ZIP = '24060';
const TARGET_STREETS = [/prices fork/i, /university city/i]; // preferred store address

let token = null;
let tokenExpires = 0;
let lastCall = 0;
let calls = 0;

const sleep = ms => new Promise(ok => setTimeout(ok, ms));

export async function getToken() {
  if (token && Date.now() < tokenExpires) return token;
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET first.');
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
    },
    body: 'grant_type=client_credentials&scope=product.compact'
  });
  if (!res.ok) throw new Error(`Token request failed with status ${res.status}`);
  const body = await res.json();
  token = body.access_token;
  tokenExpires = Date.now() + (body.expires_in - 60) * 1000;
  return token;
}

async function call(path, params) {
  if (++calls > MAX_CALLS) throw new Error('Call limit for this run reached.');
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  let res = await fetch(url, { headers: { authorization: `Bearer ${await getToken()}`, accept: 'application/json' } });
  if (res.status === 401) {
    token = null;
    res = await fetch(url, { headers: { authorization: `Bearer ${await getToken()}`, accept: 'application/json' } });
  }
  if (res.status === 429) throw new Error('Rate limited. Try again tomorrow.');
  if (!res.ok) throw new Error(`${path} failed with status ${res.status}`);
  return res.json();
}

export async function findLocations(zip = TARGET_ZIP) {
  const body = await call('/locations', { 'filter.zipCode.near': zip, 'filter.chain': 'Kroger', 'filter.limit': '10' });
  return body.data || [];
}

export function pickStore(locations) {
  for (const re of TARGET_STREETS) {
    const hit = locations.find(l => re.test(l.address?.addressLine1 || ''));
    if (hit) return hit;
  }
  return null;
}

export async function searchProducts(term, locationId, limit = 10) {
  const body = await call('/products', { 'filter.term': term, 'filter.locationId': locationId, 'filter.limit': String(limit) });
  return body.data || [];
}

const SKIP_LOC = /virtual planogram|front-other/i; // not a real shelf spot
const NO_BAY = '999'; // display or endcap bay

export function usableLocation(list) {
  return (list || []).find(a => !SKIP_LOC.test(a.description || '') && a.bayNumber !== NO_BAY) || null;
}

export function compactLocation(a) {
  if (!a) return null;
  const out = { number: a.number || '', description: a.description || '' };
  if (a.bayNumber) out.bay = a.bayNumber;
  if (a.side) out.side = a.side;
  if (a.shelfNumber) out.shelf = a.shelfNumber;
  return out;
}

export function cleanName(s) {
  return String(s || '').replace(/[\u2013\u2014]/g, '-').replace(/[\u00AE\u2122\u00A9]/g, '').replace(/\s+/g, ' ').trim();
}

export function toEntry(product, term) {
  const temp = product.temperature?.indicator || '';
  return {
    term,
    id: product.productId,
    name: cleanName(product.description),
    desc: cleanName((product.categories || [])[0] || ''),
    cold: /refrigerated|frozen/i.test(temp),
    loc: compactLocation(usableLocation(product.aisleLocations))
  };
}

const stem = w => w.replace(/(ies)$/, 'y').replace(/(oes|es|s)$/, m => (m === 'oes' ? 'o' : ''));

// First product that names the term and has a shelf spot
export function pickProduct(products, term = '') {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean).map(stem);
  const named = p => {
    const name = (p.description || '').toLowerCase();
    return words.every(w => name.includes(w));
  };
  const placed = p => usableLocation(p.aisleLocations);
  return products.find(p => named(p) && placed(p)) || products.find(placed) || products[0] || null;
}

export function callCount() { return calls; }

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'locations') {
    const locs = await findLocations(rest[0]);
    for (const l of locs) {
      console.log(`${l.locationId}  ${l.name}  ${l.address?.addressLine1}, ${l.address?.city}`);
      console.log(`  departments: ${(l.departments || []).map(d => d.name).join(', ')}`);
    }
    const pick = pickStore(locs);
    console.log(pick ? `Target store: ${pick.locationId}` : 'No store matched the target street.');
  } else if (cmd === 'probe') {
    const [locationId, ...terms] = rest;
    const list = terms.length ? terms : ['peanut butter', 'bananas', 'ground beef', 'milk', 'frozen pizza', 'bagels', 'sliced turkey', 'gift card'];
    for (const term of list) {
      const products = await searchProducts(term, locationId, 5);
      console.log(`\n${term}:`);
      for (const p of products) console.log(`  ${p.description} | ${JSON.stringify(p.aisleLocations || [])} | ${p.temperature?.indicator || ''}`);
    }
  } else {
    console.log('Usage: node tools/kroger.mjs locations [zip] | probe <locationId> [terms...]');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
