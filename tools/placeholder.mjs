import { writeFile } from 'node:fs/promises';
import { generateLayout } from '../js/layoutgen.js';

// One row of 25 aisles, as in the real store
const layout = generateLayout({ rows: Number(process.argv[2]) || 1 });
await writeFile(new URL('../data/store.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
console.log(`Saved placeholder with ${layout.aisles.length} aisles.`);
