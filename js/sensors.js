// Step counting and heading from phone sensors

export const STEP = {
  minInterval: 280, // ms, fastest step rate allowed
  threshold: 1.1, // m/s2 above baseline that counts as a step
  smooth: 0.25, // low pass factor for the signal
  baseline: 0.02 // slow factor for the gravity baseline
};

export const SNAP = {
  step: 90, // degrees between allowed directions
  hold: 60 // degrees off before a turn counts
};

export const STEP_PER_HEIGHT = 0.415; // step length over body height

// Peak detector on acceleration magnitude
export class StepDetector {
  constructor(opts = {}) {
    this.o = { ...STEP, ...opts };
    this.filtered = null;
    this.base = null;
    this.armed = true;
    this.last = -Infinity;
    this.count = 0;
  }

  push(t, ax, ay, az) {
    const m = Math.hypot(ax, ay, az);
    if (!Number.isFinite(m)) return false;
    this.filtered = this.filtered == null ? m : this.filtered + this.o.smooth * (m - this.filtered);
    this.base = this.base == null ? m : this.base + this.o.baseline * (m - this.base);
    const d = this.filtered - this.base;
    if (this.armed && d > this.o.threshold && t - this.last >= this.o.minInterval) {
      this.armed = false;
      this.last = t;
      this.count++;
      return true;
    }
    if (!this.armed && d < 0) this.armed = true;
    return false;
  }
}

// Signed difference a minus b in degrees
export function angleDiff(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

export const norm360 = a => ((a % 360) + 360) % 360;

// Smooths compass readings across the 0/360 seam
export class HeadingFilter {
  constructor(alpha = 0.2) {
    this.alpha = alpha;
    this.x = null;
    this.y = null;
  }

  push(deg) {
    const r = (deg * Math.PI) / 180;
    if (this.x == null) { this.x = Math.cos(r); this.y = Math.sin(r); }
    else {
      this.x += this.alpha * (Math.cos(r) - this.x);
      this.y += this.alpha * (Math.sin(r) - this.y);
    }
    return this.value;
  }

  get value() {
    return this.x == null ? null : norm360((Math.atan2(this.y, this.x) * 180) / Math.PI);
  }
}

// Holds a right angle direction until a clear turn
export class TurnSnapper {
  constructor(opts = {}) {
    this.o = { ...SNAP, ...opts };
    this.current = 0;
  }

  update(rel) {
    if (Math.abs(angleDiff(rel, this.current)) > this.o.hold) {
      this.current = norm360(Math.round(rel / this.o.step) * this.o.step);
    }
    return this.current;
  }
}

// Compass heading in degrees from north, or null
export function readHeading(e) {
  if (e.webkitCompassHeading != null && Number.isFinite(e.webkitCompassHeading)) return norm360(e.webkitCompassHeading);
  if (e.absolute && e.alpha != null) return norm360(360 - e.alpha);
  return null;
}

// One step along a heading, 0 means straight ahead
export function advance([x, y], headingDeg, len) {
  const r = (headingDeg * Math.PI) / 180;
  return [x + len * Math.sin(r), y - len * Math.cos(r)];
}

export function stepFromHeight(cm) {
  return Math.round(cm * STEP_PER_HEIGHT) / 100;
}
