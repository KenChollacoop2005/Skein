// Departments with Kroger location words and fallback parent
export const DEPARTMENTS = [
  { name: 'Produce', group: 'Fresh', match: ['PRODUCE'], cold: false, bays: 25 },
  { name: 'Fruit', group: 'Fresh', match: ['FRUIT'], cold: false, bays: 0, parent: 'Produce' },
  { name: 'Vegetables', group: 'Fresh', match: ['VEGETABLES'], cold: false, bays: 0, parent: 'Produce' },
  { name: 'Produce table', group: 'Fresh', match: ['PRODUCE TABLE'], cold: false, bays: 0, parent: 'Produce', numbered: true },
  { name: 'Floral', group: 'Fresh', match: ['FLORAL'], cold: false, bays: 0, parent: 'Produce' },
  { name: 'Natural and organic', group: 'Fresh', match: ['NATURAL'], cold: false, bays: 0 },
  { name: 'Deli', group: 'Counters', match: ['DELI'], cold: true, bays: 12, numbered: true },
  { name: 'Bakery', group: 'Counters', match: ['BAKERY'], cold: false, bays: 6, numbered: true },
  { name: 'Hot foods', group: 'Counters', match: ['DELI/BAKE', 'BISTRO', 'CHEF'], cold: false, bays: 0, parent: 'Deli' },
  { name: 'Sushi', group: 'Counters', match: ['SUSHI'], cold: true, bays: 0, parent: 'Deli' },
  { name: 'Cheese counter', group: 'Counters', match: ['CHEESE SHOP', 'MURRAY'], cold: true, bays: 0, parent: 'Deli' },
  { name: 'Olive and salad bar', group: 'Counters', match: ['OLIVE', 'SALAD BAR'], cold: true, bays: 0, parent: 'Deli' },
  { name: 'Meat', group: 'Counters', match: ['MEAT'], cold: true, bays: 40 },
  { name: 'Seafood', group: 'Counters', match: ['SEAFOOD'], cold: true, bays: 10, parent: 'Meat' },
  { name: 'Dairy', group: 'Cold walls', match: ['DAIRY'], cold: true, bays: 40 },
  { name: 'Frozen', group: 'Cold walls', match: ['FROZEN'], cold: true, bays: 0 },
  { name: 'Beer', group: 'Cold walls', match: ['BEER'], cold: true, bays: 0, parent: 'Wine' },
  { name: 'Wine', group: 'Other', match: ['WINE'], cold: false, bays: 0, parent: 'Beer' },
  { name: 'Pharmacy', group: 'Other', match: ['PHARMACY'], cold: false, bays: 4 },
  { name: 'General merchandise', group: 'Other', match: ['DRUG/GM'], cold: false, bays: 0 },
  { name: 'Checklanes', group: 'Front', match: ['CHECKLANE'], cold: false, bays: 12, numbered: true },
  { name: 'Customer service', group: 'Front', match: ['SERVICE DESK'], cold: false, bays: 0 },
  { name: 'Pickup', group: 'Front', match: [], cold: false, bays: 0 },
  { name: 'Restrooms', group: 'Front', match: [], cold: false, bays: 0 }
];

export const GROUPS = ['Fresh', 'Counters', 'Cold walls', 'Front', 'Other'];

export const byName = name => DEPARTMENTS.find(d => d.name.toLowerCase() === String(name).toLowerCase()) || null;

// Department plus an optional section number
export function sectionInfo(name, number) {
  const d = byName(name);
  const n = String(number ?? '').trim();
  const label = n ? `${d ? d.name : name} ${n}` : d ? d.name : name;
  const words = d ? d.match : [String(name).toUpperCase()];
  const match = n ? words.map(w => `${w} ${n}`) : words;
  return { label, match, cold: d ? d.cold : false, bays: n ? 0 : d ? d.bays : 0, base: d ? d.name : null };
}
