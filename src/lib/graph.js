import osm from '../data/osm.json';
import { strainFor } from './heat.js';

export const DEFAULT_LAMBDA = 0.6;
export const { nodes, edges, hubs, restPoints, counts, bbox } = osm;

// adjacency: both directions, entries {to, edgeIdx}
export const adj = nodes.map(() => []);
edges.forEach((e, i) => {
  adj[e.u].push({ to: e.v, edgeIdx: i });
  if (e.v !== e.u) adj[e.v].push({ to: e.u, edgeIdx: i });
});

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const topV = v[0];
    const lastK = k.pop();
    const lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return topV;
  }
}

// costFn: edge => cost (or a Float64Array of per-edge costs).
// Also accumulates travel minutes along the chosen tree in `minutes`.
export function dijkstra(src, costFn) {
  const n = nodes.length;
  const cost = costFn instanceof Float64Array ? costFn : Float64Array.from(edges, costFn);
  const dist = new Float64Array(n).fill(Infinity);
  const minutes = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[src] = 0;
  minutes[src] = 0;
  const heap = new MinHeap();
  heap.push(0, src);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    for (const { to, edgeIdx } of adj[u]) {
      const nd = dist[u] + cost[edgeIdx];
      if (nd < dist[to]) {
        dist[to] = nd;
        minutes[to] = minutes[u] + edges[edgeIdx].minutes;
        prevEdge[to] = edgeIdx;
        prevNode[to] = u;
        heap.push(nd, to);
      }
    }
  }
  return { src, dist, minutes, prevEdge, prevNode };
}

// Edges from the tree's source to dst, in travel order.
export function pathTo(res, dst) {
  if (!Number.isFinite(res.dist[dst])) return null;
  const out = [];
  const nodesOut = [dst];
  let cur = dst;
  while (cur !== res.src) {
    out.push(res.prevEdge[cur]);
    cur = res.prevNode[cur];
    nodesOut.push(cur);
  }
  out.reverse();
  nodesOut.reverse();
  return { edges: out, nodes: nodesOut };
}

export function edgeGeomOriented(edgeIdx, fromNode) {
  const e = edges[edgeIdx];
  return e.u === fromNode ? e.geom : e.geom.slice().reverse();
}

export function pathGeom(path) {
  const pts = [];
  path.edges.forEach((ei, i) => {
    const g = edgeGeomOriented(ei, path.nodes[i]);
    pts.push(...(i === 0 ? g : g.slice(1)));
  });
  return pts;
}

export function nearestNode(lat, lon) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dy = nodes[i][0] - lat;
    const dx = (nodes[i][1] - lon) * k;
    const d = dy * dy + dx * dx;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export const fastestCost = (e) => e.minutes;
export const coolestCost = (w, lambda = DEFAULT_LAMBDA) => (e) => e.minutes + lambda * strainFor(e, w, e.minutes);

export function routeStats(edgeIdxs, w) {
  let minutes = 0;
  let m = 0;
  let strain = 0;
  let shadeM = 0;
  const byName = new Map();
  for (const i of edgeIdxs) {
    const e = edges[i];
    minutes += e.minutes;
    m += e.length_m;
    strain += strainFor(e, w, e.minutes);
    shadeM += e.shade * e.length_m;
    byName.set(e.name, (byName.get(e.name) || 0) + e.length_m);
  }
  const named = [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const streets = named.filter((n) => !GENERIC_NAMES.has(n)).slice(0, 3);
  return {
    minutes,
    km: m / 1000,
    strain,
    shadePct: m > 0 ? (100 * shadeM) / m : 0,
    streets: streets.length ? streets : named.slice(0, 3),
  };
}

export const GENERIC_NAMES = new Set([
  'Main road',
  'Secondary road',
  'Tertiary road',
  'Residential street',
  'Local road',
  'Living street',
]);

// Distinct real street names around a node, longest street first, searching
// outward through neighbours until `want` names are found.
export function streetsNear(node, want = 2, maxHops = 4) {
  const found = [];
  const seen = new Set([node]);
  let frontier = [node];
  for (let hop = 0; hop <= maxHops && found.length < want; hop++) {
    const cands = new Map();
    const next = [];
    for (const n of frontier) {
      for (const { to, edgeIdx } of adj[n]) {
        const e = edges[edgeIdx];
        if (!GENERIC_NAMES.has(e.name) && !found.includes(e.name)) {
          cands.set(e.name, Math.max(cands.get(e.name) || 0, e.length_m));
        }
        if (!seen.has(to)) {
          seen.add(to);
          next.push(to);
        }
      }
    }
    [...cands.entries()].sort((a, b) => b[1] - a[1]).forEach(([n]) => found.length < want && found.push(n));
    frontier = next;
  }
  return found;
}

// Rest points labelled with the street they sit on, e.g. "Fuel station, North Usman Road".
restPoints.forEach((p) => {
  const street = streetsNear(p.node, 1)[0];
  p.label = street && !p.name.includes(street) ? `${p.name}, ${street}` : p.name;
});
hubs.forEach((h) => {
  const street = streetsNear(h.node, 1)[0];
  h.label = street ? `${h.name}, ${street}` : h.name;
});

// Dijkstra cache keyed `${policy}|${hourInt}|${src}` within a weather/lambda scope.
const caches = new Map();
export function cachedTree(scope, policy, hourInt, src, costFactory) {
  let cache = caches.get(scope);
  if (!cache) {
    cache = new Map();
    caches.set(scope, cache);
  }
  const key = `${policy}|${hourInt}|${src}`;
  let res = cache.get(key);
  if (!res) {
    res = dijkstra(src, costFactory());
    cache.set(key, res);
  }
  return res;
}

export function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
