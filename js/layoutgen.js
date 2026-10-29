import { normalizeLayout } from './store.js';

export const GEN = { width: 92, depth: 48, aisles: 25, first: 1, rows: 1, rtl: false }; // default store
const WALL = 3; // depth of wall departments
const BACK_AISLE = 3.5; // walkway behind the aisles
const MID_AISLE = 3; // cross aisle between two rows
const FRONT = 11; // front walkway, registers and doors
const LEFT = 10; // produce wall plus walkway
const RIGHT = 7; // dairy wall plus walkway
const BAY = 1.22; // one 4 ft bay
const MIN_WALK = 1.2; // narrowest walkway
const MAX_PITCH = 3.4; // widest aisle spacing, center to center

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const r2 = v => Math.round(v * 100) / 100;
const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, k) => [r2(x0 + ((x1 - x0) * k) / Math.max(1, n - 1)), r2(y0 + ((y1 - y0) * k) / Math.max(1, n - 1))]);

// A believable Kroger style starting layout
export function generateLayout(opts = {}) {
  const o = { ...GEN, ...opts };
  const W = Number(o.width), H = Number(o.depth), n = Math.round(Number(o.aisles)), first = Math.round(Number(o.first));
  const rows = Number(o.rows) === 2 ? 2 : 1;
  if (!(W >= 30 && H >= 25 && n >= 1)) throw new Error('The store needs to be at least 30 by 25 m with 1 aisle.');
  const x0 = LEFT, x1 = W - RIGHT;
  const y0 = WALL + BACK_AISLE, y1 = H - FRONT;
  const cols = rows === 2 ? Math.ceil(n / 2) : n;
  const pitch = Math.min(MAX_PITCH, (x1 - x0) / cols);
  const left = x0 + ((x1 - x0) - pitch * cols) / 2;
  const shelf = pitch >= 3.2 ? 0.6 : pitch >= 2.4 ? 0.5 : 0.4;
  const width = Math.floor((pitch - 2 * shelf) * 100) / 100 - 0.02;
  if (width < MIN_WALK) throw new Error(`${n} aisles don't fit in ${W} m. Make the store wider or use two rows.`);
  const rowLen = rows === 2 ? (y1 - y0 - MID_AISLE) / 2 : y1 - y0;
  const aisles = [];
  for (let k = 0; k < n; k++) {
    const row = rows === 2 && k >= cols ? 1 : 0;
    let col = row ? k - cols : k;
    if (o.rtl) col = cols - 1 - col;
    const cx = r2(left + pitch * (col + 0.5));
    const back = rows === 2 && row === 1 ? y1 - rowLen : y0;
    const front = rows === 2 && row === 0 ? y0 + rowLen : y1;
    aisles.push({ number: String(first + k), start: [cx, r2(front)], end: [cx, r2(back)], width: r2(width), shelf, bays: Math.max(1, Math.round((front - back) / BAY)), bay1: 'start', flip: false, cold: false });
  }
  const meatEnd = r2(W * 0.55), seaEnd = W - 8;
  const pickY = WALL + 0.8;
  const zones = [
    { name: 'Produce', match: ['PRODUCE', 'FRUIT', 'VEGETABLES'], cold: false, bays: 25, polygon: rect(0, y0, 7, y1), picks: line(7.7, y1 - 1, 7.7, y0 + 1, 6) },
    { name: 'Bakery', match: ['BAKERY', 'DELI/BAKE'], cold: false, bays: 6, polygon: rect(0, y1, 7, y1 + 5), picks: [[7.7, r2(y1 + 2.5)]] },
    { name: 'Deli', match: ['DELI', 'SUSHI'], cold: true, bays: 12, polygon: rect(0, 0, 12, WALL), picks: line(3, pickY, 10, pickY, 2) },
    { name: 'Meat', match: ['MEAT'], cold: true, bays: 40, polygon: rect(12, 0, meatEnd, WALL), picks: line(14, pickY, meatEnd - 2, pickY, 6) },
    { name: 'Seafood', match: ['SEAFOOD'], cold: true, bays: 10, polygon: rect(meatEnd, 0, seaEnd, WALL), picks: line(meatEnd + 2, pickY, seaEnd - 2, pickY, 2) },
    { name: 'Dairy', match: ['DAIRY'], cold: true, bays: 40, polygon: rect(W - 3, WALL, W, y1), picks: line(W - 3.8, y0 - 1, W - 3.8, y1 - 1, 6) },
    { name: 'Pharmacy', match: ['PHARMACY'], cold: false, bays: 4, polygon: rect(W - 4, y1 + 1, W, H), picks: [[r2(W - 4.8), r2(y1 + 3)]] },
    { name: 'Checklanes', match: ['CHECKLANE'], cold: false, bays: 12, polygon: rect(r2(W * 0.2), y1 + 3, r2(W * 0.62), H - 3), picks: [[r2(W * 0.41), r2(y1 + 1.5)]] }
  ];
  const obstacles = [10, 18, 26].filter(y => y + 4 < y1).map(y => ({ name: 'Produce table', polygon: rect(2, y, 5, y + 4) }));
  obstacles.push({ name: 'Service desk', polygon: rect(r2(W * 0.68), y1 + 4, r2(W * 0.68 + 6), y1 + 8) });
  const registers = [];
  for (let x = W * 0.22; x + 2 < W * 0.6; x += 4.5) {
    obstacles.push({ name: 'Register counter', polygon: rect(r2(x), y1 + 4, r2(x + 1), y1 + 7.5) });
    registers.push([r2(x + 1.75), r2(y1 + 5.5)]);
  }
  return normalizeLayout({
    name: 'Kroger - University City', placeholder: true,
    outline: rect(0, 0, W, H), entrance: [11, H - 1], registers, aisles, zones, obstacles
  });
}
