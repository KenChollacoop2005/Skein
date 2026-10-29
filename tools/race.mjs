import { readFile } from 'node:fs/promises';
import { prepare, resolveSpot, buildStops, compareMethods } from '../js/plan.js';
import { parseList, buildIndex, matchLine } from '../js/match.js';
import { moldRoute, moldGraph } from '../js/physarum.js';

const LISTS = {
  'Demo (12 items)': 'milk, eggs, peanut butter, bananas, ground beef, frozen pizza, cereal, coffee, bagels, paper towels, shampoo, salsa',
  'Small (6 items)': 'bread, butter, apples, coffee, dish soap, ice cream',
  'Big (25 items)': 'milk, eggs, bacon, salmon, bananas, lettuce, onions, cereal, oatmeal, rice, pasta sauce, black beans, flour, sugar, ketchup, potato chips, water, toilet paper, toothpaste, dog food, frozen peas, ice cream, yogurt, cheddar cheese, croissants'
};
const SEEDS = [1, 2, 3]; // mold runs per list

const json = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const ctx = prepare(await json('../data/store.json'));
const index = buildIndex((await json('../data/catalog.json')).items);
const G = moldGraph(ctx.L);

for (const [name, text] of Object.entries(LISTS)) {
  const spots = parseList(text).map(({ text: line, key }) => {
    const { best, alts } = matchLine(key, index);
    const s = resolveSpot(ctx.L, { item: best?.item, line, alts });
    return s && { ...s, label: line };
  }).filter(Boolean);
  const stops = buildStops(ctx, spots);
  const cmp = compareMethods(ctx, stops);
  const molds = SEEDS.map(seed => moldRoute(ctx.L, cmp.P, stops.map(s => s.point), { graph: G, seed }).length);
  const best = cmp.exact.length;
  const row = (label, len) => `| ${label} | ${Math.round(len)} m | ${len / best - 1 < 0.0005 ? 'best' : `${((len / best - 1) * 100).toFixed(1)}%`} |`;
  console.log(`\n${name}, ${stops.length} stops\n`);
  console.log('| Method | Route length | Above best |\n|---|---|---|');
  console.log(row(cmp.exact.label + (cmp.exact.exact ? '' : ` (bound ${Math.round(cmp.exact.bound)} m)`), best));
  console.log(row('Nearest neighbor', cmp.nearest.length));
  console.log(row('Aisle order', cmp.aisle.length));
  console.log(row(`Slime mold network (mean of ${SEEDS.length} seeds)`, molds.reduce((a, b) => a + b, 0) / molds.length));
  console.log(row('Slime mold network (best seed)', Math.min(...molds)));
}
