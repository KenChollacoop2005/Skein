import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/match.js';
import { readJSON } from './helpers.js';

const catalog = readJSON('data/catalog.json');
const index = M.buildIndex(catalog.items);
const best = text => M.matchLine(M.normalize(text), index).best?.item.term;

test('normalize handles case, plurals, quantities and synonyms', () => {
  assert.equal(M.normalize('  Bananas!! '), 'banana');
  assert.equal(M.normalize('2 Tomatoes'), 'tomato');
  assert.equal(M.normalize('Strawberries'), 'strawberry');
  assert.equal(M.normalize('Peaches'), 'peach');
  assert.equal(M.normalize('Hummus'), 'hummus');
  assert.equal(M.normalize('pop'), 'soda');
  assert.equal(M.normalize('Mac & Cheese'), 'macaroni and cheese');
});

test('parseList splits lines and commas and drops repeats', () => {
  const lines = M.parseList('milk, eggs\nMilk\n\n- bread; apples');
  assert.deepEqual(lines.map(l => l.text), ['milk', 'eggs', 'bread', 'apples']);
});

test('common items match the right catalog entry', () => {
  assert.equal(best('milk'), 'milk');
  assert.equal(best('Eggs'), 'eggs');
  assert.equal(best('peanut butter'), 'peanut butter');
  assert.equal(best('banana'), 'bananas');
  assert.equal(best('tomato'), 'tomatoes');
  assert.equal(best('frozen pizzas'), 'frozen pizza');
  assert.equal(best('tylenol'), 'acetaminophen');
  assert.equal(best('tp'), 'toilet paper');
});

test('near misses and typos still match', () => {
  assert.equal(best('peanut buter'), 'peanut butter');
  assert.equal(best('brocoli'), 'broccoli');
  assert.equal(best('greek yoghurt'), 'greek yogurt');
});

test('nonsense does not match but still offers choices', () => {
  const r = M.matchLine(M.normalize('xylophone'), index);
  assert.equal(r.best, null);
});

test('alternatives are ranked and unique', () => {
  const r = M.matchLine(M.normalize('cheese'), index);
  assert.ok(r.alts.length > 1);
  const ids = r.alts.map(a => a.item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 1; i < r.alts.length; i++) assert.ok(r.alts[i - 1].score >= r.alts[i].score);
});

test('department guesses from keywords', () => {
  assert.equal(M.guessDepartment('fresh basil herb'), 'Produce');
  assert.equal(M.guessDepartment('pork shoulder'), 'Meat');
  assert.equal(M.guessDepartment('chocolate milk'), 'Dairy');
  assert.equal(M.guessDepartment('birthday cake'), 'Bakery');
  assert.equal(M.guessDepartment('stapler'), null);
});

test('chip search finds items by prefix', () => {
  const found = M.searchTerms(index, 'pea').map(i => i.term);
  assert.ok(found.includes('peanut butter'));
  assert.equal(M.searchTerms(index, '', 5).length, 5);
});
