import { readFileSync } from 'node:fs';

export const readJSON = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

// Seeded random numbers
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small two aisle store for fast tests
export function tinyLayout() {
  return {
    name: 'Tiny', outline: [[0, 0], [20, 0], [20, 15], [0, 15]],
    entrance: [2, 14], registers: [[10, 13], [14, 13]],
    aisles: [
      { number: '1', start: [6, 11], end: [6, 3], width: 2, shelf: 0.6, bays: 8, bay1: 'start', flip: false },
      { number: '2', start: [9.2, 11], end: [9.2, 3], width: 2, shelf: 0.6, bays: 8, bay1: 'start', flip: false }
    ],
    zones: [{ name: 'Dairy', match: ['DAIRY'], cold: true, bays: 10, polygon: [[0, 0], [20, 0], [20, 1.5], [0, 1.5]], picks: [[3, 2], [10, 2], [17, 2]] }],
    obstacles: [{ name: 'Box', polygon: [[14, 5], [16, 5], [16, 8], [14, 8]] }]
  };
}
