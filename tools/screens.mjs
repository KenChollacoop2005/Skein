import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 8099; // local QA server port
const BASE = `http://localhost:${PORT}/`;
const OUT = new URL('../media/screens/', import.meta.url);
const SIZES = [[390, 844], [1440, 900]]; // phone and desktop
const PAGES = ['index.html', 'setup.html', 'editor.html', 'race.html'];
const PRINT_COUNTS = [5, 15, 25]; // list sizes for the print check
const DEMO = 'milk\neggs\npeanut butter\nbananas\nground beef\nfrozen pizza\ncereal\ncoffee\nbagels\npaper towels\nshampoo\nsalsa';

const only = process.argv[2] || 'all';
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const server = await serve(PORT);
const browser = await chromium.launch();
const errors = [];
let failed = false;

function watch(page, name) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
}

function listOf(n) {
  const placed = catalog.items.filter(i => i.loc && i.loc.number !== '0');
  const step = Math.floor(placed.length / n);
  return Array.from({ length: n }, (_, i) => placed[i * step].term).join('\n');
}

async function planList(page, text) {
  await page.fill('#list-text', text);
  await page.click('#plan-btn');
  await page.waitForSelector('#stops li');
}

async function shots() {
  await mkdir(OUT, { recursive: true });
  for (const [w, h] of SIZES) {
    for (const name of PAGES) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      watch(page, `${name} ${w}`);
      await page.goto(BASE + name);
      await page.waitForLoadState('networkidle');
      if (name === 'index.html') await planList(page, DEMO);
      if (name === 'race.html') {
        await page.waitForFunction(() => {
          const cards = document.querySelectorAll('#results .card');
          return cards.length === 4 && !/growing/.test(cards[3].querySelector('.pct').textContent);
        }, null, { timeout: 60000 });
      }
      await page.waitForTimeout(600);
      const info = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth > window.innerWidth,
        fonts: document.fonts.check('16px "Atkinson Hyperlegible"') && document.fonts.check('600 16px Fraunces')
      }));
      if (info.scroll) { failed = true; console.log(`FAIL horizontal scroll: ${name} at ${w}`); }
      if (!info.fonts) { failed = true; console.log(`FAIL fonts not loaded: ${name} at ${w}`); }
      const file = `${name.replace('.html', '')}-${w}.png`;
      await page.screenshot({ path: new URL(file, OUT).pathname, fullPage: w < 600 });
      console.log(`saved ${file}`);
      if (name === 'index.html' && w < 600) {
        await page.locator('#route-panel').scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollTo(0, document.getElementById('route-panel').offsetTop - 64));
        await page.screenshot({ path: new URL('../route-phone.png', OUT).pathname });
      }
      await page.close();
    }
  }
}

async function print() {
  for (const n of PRINT_COUNTS) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    watch(page, `print ${n}`);
    await page.goto(BASE + 'index.html');
    await planList(page, listOf(n));
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const stops = await page.locator('#stops li').count();
    console.log(`print ${n} items, ${stops - 1} stops: ${pages} page${pages === 1 ? '' : 's'}`);
    if (pages !== 1) failed = true;
    if (n === 15) await writeFile(new URL('print-15.pdf', OUT), pdf);
    await page.close();
  }
}

async function offline() {
  const context = await browser.newContext();
  const page = await context.newPage();
  watch(page, 'offline');
  await page.goto(BASE + 'index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForTimeout(500);
  await context.setOffline(true);
  let ok = true;
  for (const name of PAGES) {
    try {
      await page.goto(BASE + name);
      await page.waitForTimeout(500);
      ok = ok && (await page.locator('header .wordmark').count()) > 0;
    } catch {
      ok = false;
    }
  }
  await page.goto(BASE + 'index.html');
  await planList(page, 'milk\neggs\ncereal');
  const stops = await page.locator('#stops li').count();
  console.log(`offline: pages ${ok ? 'load' : 'FAIL'}, route ${stops > 1 ? 'plans' : 'FAIL'}`);
  if (!ok || stops < 2) failed = true;
  await context.close();
}

try {
  await mkdir(OUT, { recursive: true });
  if (only === 'all' || only === 'print') await print();
  if (only === 'all' || only === 'offline') await offline();
  if (only === 'all' || only === 'shots') await shots();
} finally {
  await browser.close();
  server.close();
}
const real = errors.filter(e => !/net::ERR_INTERNET_DISCONNECTED/.test(e));
console.log(real.length ? `console errors:\n${real.join('\n')}` : 'no console errors');
if (failed || real.length) process.exit(1);
