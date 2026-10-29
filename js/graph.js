const SQRT2 = Math.SQRT2;

export class MinHeap {
  constructor() { this.keys = []; this.vals = []; }
  get size() { return this.keys.length; }
  push(key, val) {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
}

// 8-connected grid graph, no corner cutting
export function gridGraph(grid) {
  const { cols, rows, walk, cell } = grid;
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];
  return {
    n: cols * rows,
    neighbors(i, visit) {
      const x = i % cols, y = (i - x) / cols;
      for (const [dx, dy, w] of steps) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (!walk[j]) continue;
        if (dx && dy && (!walk[y * cols + nx] || !walk[ny * cols + x])) continue;
        visit(j, w * cell);
      }
    },
    heuristic(a, b) {
      const dx = Math.abs(a % cols - b % cols), dy = Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
      return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * cell;
    }
  };
}

export function dijkstra(g, src) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const heap = new MinHeap();
  dist[src] = 0;
  heap.push(0, src);
  while (heap.size) {
    const d0 = heap.keys[0];
    const i = heap.pop();
    if (d0 > dist[i]) continue;
    g.neighbors(i, (j, w) => {
      const d = d0 + w;
      if (d < dist[j]) { dist[j] = d; prev[j] = i; heap.push(d, j); }
    });
  }
  return { dist, prev };
}

export function astar(g, src, dst) {
  const dist = new Map([[src, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(g.heuristic(src, dst), src);
  const done = new Set();
  while (heap.size) {
    const i = heap.pop();
    if (done.has(i)) continue;
    if (i === dst) break;
    done.add(i);
    const di = dist.get(i);
    g.neighbors(i, (j, w) => {
      const d = di + w;
      if (d < (dist.get(j) ?? Infinity)) {
        dist.set(j, d); prev.set(j, i);
        heap.push(d + g.heuristic(j, dst), j);
      }
    });
  }
  if (!dist.has(dst)) return { dist: Infinity, path: [] };
  const path = [dst];
  while (path[0] !== src) path.unshift(prev.get(path[0]));
  return { dist: dist.get(dst), path };
}

export function tracePath(prev, src, dst) {
  const path = [dst];
  let i = dst;
  while (i !== src) {
    i = prev[i];
    if (i < 0) return [];
    path.push(i);
  }
  return path.reverse();
}

// Distances and paths between chosen nodes
export function allPairs(g, nodes) {
  const runs = nodes.map(s => dijkstra(g, s));
  const n = nodes.length;
  const D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.min(runs[i].dist[nodes[j]], runs[j].dist[nodes[i]]);
      D[i][j] = D[j][i] = d;
    }
  }
  return {
    D,
    path(i, j) { return tracePath(runs[i].prev, nodes[i], nodes[j]); }
  };
}
