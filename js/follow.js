// Following your place along a planned route
export const FOLLOW = {
  slack: 2.5, // meters the dot may run past a stop you haven't checked
  near: 3 // meters from a stop that count as being there
};

// Distances along the route line, with stop positions
export function routeTrack(line, breaks) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1] || 0;
  const at = i => cum[Math.min(Math.max(0, i), cum.length - 1)];
  return { line, cum, total, stopAt: breaks.slice(1, -1).map(at) };
}

// Point and heading at a distance along the route
export function pointAt(track, d) {
  const { line, cum } = track;
  if (line.length < 2) return { p: line[0] || [0, 0], heading: 0 };
  const t = Math.min(Math.max(0, d), track.total);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const a = line[i - 1], b = line[i];
  const span = cum[i] - cum[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (t - cum[i - 1]) / span));
  const heading = ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360;
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading };
}

// Route line from the start up to a distance
export function trailTo(track, d) {
  const out = [];
  const t = Math.min(Math.max(0, d), track.total);
  for (let i = 0; i < track.line.length && track.cum[i] < t; i++) out.push(track.line[i]);
  out.push(pointAt(track, t).p);
  return out;
}

export class Trip {
  constructor(track, itemCounts, opts = {}) {
    this.track = track;
    this.o = { ...FOLLOW, ...opts };
    this.d = 0;
    this.checked = itemCounts.map(n => new Array(n).fill(false));
  }

  stopDone(i) { return this.checked[i].every(Boolean); }
  allDone() { return this.checked.every((_, i) => this.stopDone(i)); }

  // Next unchecked stop that is not behind you
  next() {
    const { stopAt } = this.track;
    for (let i = 0; i < stopAt.length; i++) if (!this.stopDone(i) && stopAt[i] >= this.d - this.o.near) return i;
    return -1;
  }

  target() {
    const n = this.next();
    return n < 0 ? this.track.total : this.track.stopAt[n];
  }

  distanceToNext() { return Math.max(0, this.target() - this.d); }
  isNear() { return this.distanceToNext() <= this.o.near; }

  // One step forward, waiting near the next stop
  step(len) {
    const cap = Math.min(this.track.total, this.target() + (this.next() < 0 ? 0 : this.o.slack));
    if (this.d < cap) this.d = Math.min(cap, this.d + len);
    return this.d;
  }

  // Ticking a stop puts you there if you were behind
  snapTo(i) { this.d = Math.max(this.d, this.track.stopAt[i]); }

  toggleItem(i, j) {
    this.checked[i][j] = !this.checked[i][j];
    if (this.stopDone(i)) this.snapTo(i);
  }

  toggleStop(i) {
    const value = !this.stopDone(i);
    this.checked[i] = this.checked[i].map(() => value);
    if (value) this.snapTo(i);
  }

  here() {
    const n = this.next();
    if (n >= 0) this.d = this.track.stopAt[n];
    return n;
  }

  toJSON() { return { d: this.d, checked: this.checked }; }

  restore(saved) {
    if (!saved || !Array.isArray(saved.checked) || saved.checked.length !== this.checked.length) return false;
    if (saved.checked.some((c, i) => !Array.isArray(c) || c.length !== this.checked[i].length)) return false;
    this.checked = saved.checked.map(c => c.map(Boolean));
    this.d = Math.min(Math.max(0, Number(saved.d) || 0), this.track.total);
    return true;
  }
}
