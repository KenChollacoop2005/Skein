import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildLayout } from '../js/trace.js';
import { fillAisles } from '../js/layoutgen.js';
import { normalizeLayout, bounds, pointInPolygon, validateLayout, checkReachable, buildGrid } from '../js/store.js';

// Usage: node tools/university-city.mjs path/to/skein-walk.json
const OUT = new URL('../data/stores/kroger-university-city.json', import.meta.url);
const SIDE = 2.0; // wall to first aisle, past your walking line
const BACK_LINE = 10.7; // back end of the aisles, meters
const FRONT_LINE = 40.5; // front end, leaves room for registers
const FIRST = 2; // Kroger data has no aisle 1 here
const LAST = 25; // far right aisle
const ALCOHOL = 4; // aisles 2 to 5 are beer and wine only
const MEAT_PICKS = 8; // spots along the back wall
const PRODUCE_TOP = 0.5; // produce block top, from natural to beer marks
const PICK_COLS = 3; // produce pick points across
const PICK_ROWS = 2; // produce pick points deep

const walk = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { layout, report } = buildLayout(walk, { lineUp: false, even: false, fill: false });
const L = layout;
const b = bounds(L.outline);
const zone = name => L.zones.find(z => z.name === name);

// Open produce floor from the left wall to the entrance
const natural = zone('Natural and organic').picks[0], beer = zone('Beer').picks[0];
const top = Math.round((beer[1] + (natural[1] - beer[1]) * PRODUCE_TOP) * 100) / 100;
const left = b.x0 + SIDE, right = b.x1 - SIDE;
const pitch = (right - left) / (LAST - FIRST + 1);
const x0 = b.x0, x1 = Math.round((left + pitch * ALCOHOL - 0.3) * 100) / 100;
const y1 = Math.max(...L.outline.filter(p => p[0] <= x1 + 0.01).map(p => p[1]));
const produce = zone('Produce');
produce.polygon = [[x0, top], [x1, top], [x1, y1], [x0, y1]];
produce.clear = true;
produce.picks = [];
for (let r = 0; r < PICK_ROWS; r++) {
  for (let c = 0; c < PICK_COLS; c++) {
    produce.picks.push([Math.round((x0 + 2 + ((x1 - x0 - 4) * (c + 0.5)) / PICK_COLS) * 100) / 100, Math.round((top + 2 + ((y1 - top - 4) * (r + 0.5)) / PICK_ROWS) * 100) / 100]);
  }
}
produce.match = [...new Set([...produce.match, ...zone('Vegetables').match])];
L.zones = L.zones.filter(z => z.name !== 'Vegetables');

// Dairy runs along the back right and right walls
const dairy = zone('Dairy');
const [d0, d1] = dairy.picks;
dairy.polygon = [[d0[0] - 1.5, b.y0], [b.x1, b.y0], [b.x1, d1[1] + 1.5], [d1[0] - 1.5, d1[1] + 1.5], [d1[0] - 1.5, d0[1] + 1.5], [d0[0] - 1.5, d0[1] + 1.5]];

// Meat runs along the whole back wall, bay 1 at the right end
const path = buildLayout(walk, { lineUp: false, even: false, fill: false }).path;
const corner = walk.marks.filter(m => m.type === 'corner').map(m => m.step);
const [backStart, backStep, backEnd] = [corner[1], corner[2], corner[3]];
const pA = path[backStart], pB = path[backStep], pC = path[backEnd];
const meat = zone('Meat');
meat.polygon = [[pA[0] - 0.8, pA[1] - 0.8], [pB[0] + 0.8, pA[1] - 0.8], [pB[0] + 0.8, pC[1] - 0.8], [pC[0] + 0.8, pC[1] - 0.8], [pC[0] + 0.8, pC[1] + 1.2], [pA[0] - 0.8, pC[1] + 1.2]];
meat.picks = [];
for (let k = 0; k < MEAT_PICKS; k++) {
  const i = Math.round(backEnd - ((backEnd - backStart) * k) / (MEAT_PICKS - 1));
  meat.picks.push(path[i].map(v => Math.round(v * 100) / 100));
}
meat.bays = 40;

// Checkout marks outside the store are step count drift
const dropped = L.registers.filter(r => !pointInPolygon(r, L.outline));
L.registers = L.registers.filter(r => pointInPolygon(r, L.outline));

const fill = fillAisles(L, { first: FIRST, last: LAST, left, right, backLine: BACK_LINE, frontLine: FRONT_LINE });
L.aisles = fill.aisles;
L.name = 'Kroger University City (traced)';
const out = normalizeLayout(L);

const short = out.aisles.filter(a => a.start[1] < FRONT_LINE - 0.5).map(a => a.number);
console.log(`Loop ${report.perimeter.toFixed(0)} m, closure gap ${report.closure.toFixed(1)} m.`);
console.log(`Store ${(b.x1 - b.x0).toFixed(1)} by ${(b.y1 - b.y0).toFixed(1)} m. Produce block top at y ${top}.`);
console.log(`Aisle spacing ${fill.pitch} m, walkway ${fill.width} m. Short aisles above produce: ${short.join(', ')}.`);
if (dropped.length) console.log(`Dropped ${dropped.length} checkout mark outside the store: ${JSON.stringify(dropped)}.`);
console.log('Problems:', [...validateLayout(out), ...checkReachable(out, buildGrid(out))].map(p => p.msg));
await mkdir(new URL('../data/stores/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
