export const MATCH_MIN = 0.42; // lowest score counted as a match
const ALT_COUNT = 5; // alternatives shown per line

const SYNONYMS = {
  pop: 'soda', soft: 'soda', coke: 'coke', catsup: 'ketchup', scallion: 'green onion', 'spring onion': 'green onion',
  garbanzo: 'chickpea', coriander: 'cilantro', tp: 'toilet paper', 'loo roll': 'toilet paper', mince: 'ground beef',
  hamburger: 'ground beef', 'hamburger meat': 'ground beef', aubergine: 'eggplant', courgette: 'zucchini',
  'paper towel': 'paper towels', 'dish detergent': 'dish soap', 'pb': 'peanut butter', 'oj': 'orange juice',
  'mac and cheese': 'macaroni and cheese', 'mac n cheese': 'macaroni and cheese', 'tylenol': 'acetaminophen',
  'advil': 'ibuprofen', 'motrin': 'ibuprofen', 'band aid': 'bandages', 'bandaid': 'bandages', 'kleenex': 'tissues',
  'saran wrap': 'plastic wrap', 'tin foil': 'aluminum foil', 'ziploc': 'zipper bags', 'ziplock': 'zipper bags',
  'yoghurt': 'yogurt', 'chips': 'potato chips', 'crisps': 'potato chips', 'cheese': 'cheddar cheese'
};

const IRREGULAR = { loaves: 'loaf', knives: 'knife', leaves: 'leaf', geese: 'goose', mice: 'mouse', children: 'child', dice: 'dice' };
const KEEP = new Set(['hummus', 'swiss', 'grits', 'oats', 'molasses', 'asparagus', 'couscous', 'citrus', 'bass', 'glass', 'chips', 'plus', 'series', 'species', 'bus']);

// Keyword to department table
export const DEPARTMENT_WORDS = {
  Produce: ['fruit', 'vegetable', 'apple', 'banana', 'berry', 'lettuce', 'salad', 'onion', 'potato', 'tomato', 'pepper', 'herb', 'squash', 'melon', 'citrus', 'orange', 'lemon', 'lime', 'grape', 'peach', 'pear', 'plum', 'kale', 'spinach', 'carrot', 'celery', 'cucumber', 'avocado', 'garlic', 'ginger', 'mushroom', 'flower', 'produce'],
  Meat: ['beef', 'chicken', 'pork', 'steak', 'turkey', 'bacon', 'sausage', 'ham', 'lamb', 'veal', 'brisket', 'ribs', 'meat', 'roast'],
  Seafood: ['fish', 'salmon', 'shrimp', 'tuna steak', 'tilapia', 'cod', 'crab', 'lobster', 'scallop', 'seafood'],
  Dairy: ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'dairy', 'creamer', 'margarine'],
  Deli: ['deli', 'sliced', 'rotisserie', 'sushi', 'hummus', 'salami', 'prepared'],
  Bakery: ['bakery', 'cake', 'donut', 'croissant', 'muffin', 'pie', 'baguette', 'bagel', 'roll', 'pastry'],
  Pharmacy: ['prescription', 'pharmacy', 'rx', 'medicine', 'vaccine']
};

export function singular(word) {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.length <= 3 || KEEP.has(word) || /ss$|us$|is$/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|zes|sses|oes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

export function normalize(text) {
  let t = String(text || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/^\s*\d+\s*(x|pk|pack|lb|lbs|oz|ct)?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (SYNONYMS[t]) t = SYNONYMS[t];
  else for (const [k, v] of Object.entries(SYNONYMS)) if (k.includes(' ') && t.includes(k)) t = t.replace(k, v);
  return t.split(' ').filter(Boolean).map(singular).join(' ');
}

export function parseList(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[\n,;]+/)) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    const key = normalize(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: line, key });
  }
  return out;
}

function grams(s) {
  const t = ` ${s} `;
  const set = new Set();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const g of a) if (b.has(g)) both++;
  return (2 * both) / (a.size + b.size);
}

export function buildIndex(items) {
  return items.map(item => {
    const term = normalize(item.term || item.name);
    const name = normalize(item.name);
    return { item, term, name, termWords: new Set(term.split(' ')), nameWords: new Set(name.split(' ')), termGrams: grams(term), nameGrams: grams(name) };
  });
}

function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Same word, allowing a typo
function near(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  return editDistance(a, b, n >= 7 ? 2 : 1) <= (n >= 7 ? 2 : 1);
}

const hasNear = (words, w) => words.has(w) || [...words].some(v => near(v, w));

export function score(query, entry) {
  if (!query) return 0;
  if (query === entry.term) return 1;
  const qWords = query.split(' ');
  const qGrams = grams(query);
  const qSet = new Set(qWords);
  const inTerm = qWords.filter(w => hasNear(entry.termWords, w)).length / qWords.length;
  const inName = qWords.filter(w => entry.nameWords.has(w)).length / qWords.length;
  const termCover = [...entry.termWords].filter(w => hasNear(qSet, w)).length / entry.termWords.size;
  const s = Math.max(
    0.55 * inTerm + 0.35 * termCover + 0.1 * dice(qGrams, entry.termGrams),
    0.6 * dice(qGrams, entry.termGrams) + 0.2 * inTerm,
    0.5 * inName + 0.25 * dice(qGrams, entry.nameGrams)
  );
  return Math.min(0.99, s);
}

// Best catalog matches for one list line
export function matchLine(key, index, count = ALT_COUNT) {
  const ranked = index.map(e => ({ item: e.item, score: score(key, e) }))
    .filter(r => r.score > 0.2)
    .sort((a, b) => b.score - a.score);
  const seen = new Set();
  const alts = [];
  for (const r of ranked) {
    if (seen.has(r.item.id)) continue;
    seen.add(r.item.id);
    alts.push(r);
    if (alts.length >= count) break;
  }
  const best = alts[0] && alts[0].score >= MATCH_MIN ? alts[0] : null;
  return { best, alts };
}

// Department guess from keywords
export function guessDepartment(text) {
  const t = ` ${normalize(text)} `;
  let best = null, bestLen = 0;
  for (const [dept, words] of Object.entries(DEPARTMENT_WORDS)) {
    for (const w of words) {
      if (t.includes(` ${w} `) && w.length > bestLen) { best = dept; bestLen = w.length; }
    }
  }
  return best;
}

// Chip search over catalog terms
export function searchTerms(index, text, limit = 12) {
  const q = normalize(text);
  if (!q) return index.slice(0, limit).map(e => e.item);
  return index
    .map(e => ({ e, s: e.term.startsWith(q) ? 2 : e.term.includes(q) ? 1 : e.name.includes(q) ? 0.5 : 0 }))
    .filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(r => r.e.item);
}
