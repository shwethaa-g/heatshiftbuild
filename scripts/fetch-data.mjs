// Fetches T. Nagar (Chennai) roads, buildings, greenery and POIs from OpenStreetMap
// (Overpass API) plus the hottest May day from Open-Meteo, builds a contracted
// routing graph with per-street shade / urban-heat attributes, and writes
// src/data/osm.json and src/data/heatwave.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../src/lib/rng.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'src/data');

const BASE_BBOX = { south: 13.030, west: 80.222, north: 13.052, east: 80.246 };
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const HEADERS = { 'User-Agent': 'HeatShift/1.0 (hackathon research project)', Accept: '*/*' };
const LAT = 13.0418;
const LON = 80.2341;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const r3 = (x) => Math.round(x * 1e3) / 1e3;

// ---------- HTTP ----------
async function fetchWithTimeout(url, ms, headers = HEADERS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function overpass(label, query, { allowEmpty = false } = {}) {
  let emptyResult = null;
  for (let round = 0; round < 3; round++) {
    if (round > 0) {
      console.log(`  [${label}] retry round ${round + 1} in 5s…`);
      await sleep(5000);
    }
    for (const ep of ENDPOINTS) {
      const t0 = Date.now();
      try {
        const json = await fetchWithTimeout(`${ep}?data=${encodeURIComponent(query)}`, 90000);
        const n = json.elements?.length ?? 0;
        if (n === 0) {
          console.log(`  [${label}] ${ep} → empty result`);
          emptyResult = json;
          continue;
        }
        console.log(`  [${label}] OK from ${ep} → ${n} elements (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        return json.elements;
      } catch (err) {
        console.log(`  [${label}] ${ep} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
      }
    }
  }
  if (allowEmpty && emptyResult) {
    console.log(`  [${label}] all endpoints returned empty — accepting 0 elements`);
    return [];
  }
  throw new Error(`Overpass query "${label}" failed on all endpoints`);
}

function bboxStr(b) {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

function shrinkBbox(b, factor) {
  const cLat = (b.south + b.north) / 2;
  const cLon = (b.west + b.east) / 2;
  const hLat = ((b.north - b.south) / 2) * factor;
  const hLon = ((b.east - b.west) / 2) * factor;
  return { south: r6(cLat - hLat), west: r6(cLon - hLon), north: r6(cLat + hLat), east: r6(cLon + hLon) };
}

async function fetchOsm(b) {
  const B = bboxStr(b);
  const roads = await overpass(
    'roads',
    `[out:json][timeout:80];way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|primary_link|secondary_link|tertiary_link)$"](${B});out geom tags;`,
  );
  const buildings = await overpass('buildings', `[out:json][timeout:80];way["building"](${B});out center;`);
  const greenery = await overpass(
    'greenery',
    `[out:json][timeout:80];(node["natural"="tree"](${B});way["natural"="tree_row"](${B});way["leisure"="park"](${B});way["landuse"~"^(grass|recreation_ground)$"](${B});way["natural"="wood"](${B}););out center tags;`,
    { allowEmpty: true },
  );
  const pois = await overpass(
    'pois',
    `[out:json][timeout:80];(node["amenity"~"^(restaurant|fast_food|fuel|drinking_water|shelter)$"](${B});way["amenity"~"^(restaurant|fast_food|fuel)$"](${B});way["leisure"="park"]["name"](${B}););out center tags;`,
    { allowEmpty: true },
  );
  return { roads, buildings, greenery, pois };
}

// ---------- geometry ----------
function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const CELL = 0.001;
function makeGrid(points) {
  const grid = new Map();
  points.forEach((p, i) => {
    const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return {
    within(lat, lon, radius) {
      const out = [];
      const cy = Math.floor(lat / CELL);
      const cx = Math.floor(lon / CELL);
      const span = Math.ceil(radius / 105) ;
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const cell = grid.get(`${cy + dy},${cx + dx}`);
          if (!cell) continue;
          for (const i of cell) {
            if (haversine(lat, lon, points[i][0], points[i][1]) <= radius) out.push(i);
          }
        }
      }
      return out;
    },
  };
}

function centerOf(el) {
  if (el.type === 'node') return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  if (el.geometry?.length) {
    const g = el.geometry;
    return [g.reduce((s, p) => s + p.lat, 0) / g.length, g.reduce((s, p) => s + p.lon, 0) / g.length];
  }
  return null;
}

// Points every ~40 m along a polyline plus its midpoint.
function samplePoints(geom, lengthM) {
  const pts = [];
  const step = 40;
  const targets = [];
  for (let d = 0; d <= lengthM; d += step) targets.push(d);
  targets.push(lengthM / 2);
  targets.push(lengthM);
  targets.sort((a, b) => a - b);
  let acc = 0;
  let ti = 0;
  for (let i = 1; i < geom.length && ti < targets.length; i++) {
    const [aLat, aLon] = geom[i - 1];
    const [bLat, bLon] = geom[i];
    const seg = haversine(aLat, aLon, bLat, bLon);
    while (ti < targets.length && targets[ti] <= acc + seg + 1e-9) {
      const f = seg > 0 ? (targets[ti] - acc) / seg : 0;
      pts.push([aLat + (bLat - aLat) * f, aLon + (bLon - aLon) * f]);
      ti++;
    }
    acc += seg;
  }
  return pts.length ? pts : [geom[0]];
}

function midpointOf(geom, lengthM) {
  let acc = 0;
  const half = lengthM / 2;
  for (let i = 1; i < geom.length; i++) {
    const seg = haversine(geom[i - 1][0], geom[i - 1][1], geom[i][0], geom[i][1]);
    if (acc + seg >= half) {
      const f = seg > 0 ? (half - acc) / seg : 0;
      return [geom[i - 1][0] + (geom[i][0] - geom[i - 1][0]) * f, geom[i - 1][1] + (geom[i][1] - geom[i - 1][1]) * f];
    }
    acc += seg;
  }
  return geom[Math.floor(geom.length / 2)];
}

// ---------- graph ----------
const CLASS_LABEL = {
  primary: 'Main road',
  secondary: 'Secondary road',
  tertiary: 'Tertiary road',
  residential: 'Residential street',
  unclassified: 'Local road',
  living_street: 'Living street',
};
const CLS_SHADE = { primary: -0.05, secondary: -0.03, tertiary: 0, residential: 0.08, living_street: 0.1, unclassified: 0.05 };
const CLS_UHI = { primary: 1.0, secondary: 0.7, tertiary: 0.4 };
const SPEED = { primary: 22, secondary: 20, tertiary: 18, residential: 15 };

function buildGraph(roads) {
  const key = (lat, lon) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const nodeIdx = new Map();
  const nodePos = [];
  const segs = []; // {a,b,len,name,cls}
  const segSeen = new Set();
  const adj = [];
  const getNode = (lat, lon) => {
    const k = key(lat, lon);
    let i = nodeIdx.get(k);
    if (i === undefined) {
      i = nodePos.length;
      nodeIdx.set(k, i);
      nodePos.push([+lat.toFixed(6), +lon.toFixed(6)]);
      adj.push([]);
    }
    return i;
  };

  for (const way of roads) {
    if (!way.geometry || way.geometry.length < 2) continue;
    const cls = String(way.tags?.highway || 'unclassified').replace('_link', '');
    const name = way.tags?.name || way.tags?.ref || CLASS_LABEL[cls] || 'Local road';
    for (let i = 1; i < way.geometry.length; i++) {
      const p = way.geometry[i - 1];
      const q = way.geometry[i];
      const a = getNode(p.lat, p.lon);
      const b = getNode(q.lat, q.lon);
      if (a === b) continue;
      const sk = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (segSeen.has(sk)) continue;
      segSeen.add(sk);
      const len = haversine(nodePos[a][0], nodePos[a][1], nodePos[b][0], nodePos[b][1]);
      const s = segs.length;
      segs.push({ a, b, len, name, cls });
      adj[a].push(s);
      adj[b].push(s);
    }
  }

  // largest connected component
  const comp = new Int32Array(nodePos.length).fill(-1);
  let best = -1;
  let bestSize = 0;
  let c = 0;
  for (let s = 0; s < nodePos.length; s++) {
    if (comp[s] !== -1 || adj[s].length === 0) continue;
    const stack = [s];
    comp[s] = c;
    let size = 0;
    while (stack.length) {
      const n = stack.pop();
      size++;
      for (const si of adj[n]) {
        const o = segs[si].a === n ? segs[si].b : segs[si].a;
        if (comp[o] === -1) {
          comp[o] = c;
          stack.push(o);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
    c++;
  }
  const inMain = (n) => comp[n] === best;

  // contract degree-2 chains
  const isJunction = (n) => adj[n].length !== 2;
  const segUsed = new Uint8Array(segs.length);
  const junctionId = new Map();
  const nodes = [];
  const jid = (n) => {
    let j = junctionId.get(n);
    if (j === undefined) {
      j = nodes.length;
      junctionId.set(n, j);
      nodes.push(nodePos[n]);
    }
    return j;
  };
  const edges = [];
  for (let n = 0; n < nodePos.length; n++) {
    if (!inMain(n) || !isJunction(n)) continue;
    for (const s0 of adj[n]) {
      if (segUsed[s0]) continue;
      let cur = n;
      let s = s0;
      const geom = [nodePos[n]];
      let length = 0;
      const nameLen = new Map();
      const clsLen = new Map();
      while (true) {
        segUsed[s] = 1;
        const seg = segs[s];
        const next = seg.a === cur ? seg.b : seg.a;
        geom.push(nodePos[next]);
        length += seg.len;
        nameLen.set(seg.name, (nameLen.get(seg.name) || 0) + seg.len);
        clsLen.set(seg.cls, (clsLen.get(seg.cls) || 0) + seg.len);
        cur = next;
        if (isJunction(cur) || cur === n) break;
        const ns = adj[cur][0] === s ? adj[cur][1] : adj[cur][0];
        if (segUsed[ns]) break;
        s = ns;
      }
      if (cur === n && length < 5) continue;
      const pick = (m) => [...m.entries()].sort((x, y) => y[1] - x[1])[0][0];
      edges.push({ u: jid(n), v: jid(cur), length_m: length, name: pick(nameLen), cls: pick(clsLen), geom });
    }
  }
  return { nodes, edges, rawNodes: nodePos.length, mainSize: bestSize };
}

function nearestNode(nodes, lat, lon) {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversine(lat, lon, nodes[i][0], nodes[i][1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { node: best, dist: bd };
}

function farthestPointSample(items, k, rand) {
  if (items.length <= k) return items.slice();
  const chosen = [items[Math.floor(rand() * items.length)]];
  const minD = items.map((it) => haversine(it.lat, it.lon, chosen[0].lat, chosen[0].lon));
  while (chosen.length < k) {
    let bi = -1;
    let bd = -1;
    for (let i = 0; i < items.length; i++) {
      if (minD[i] > bd) {
        bd = minD[i];
        bi = i;
      }
    }
    if (bd <= 0) break;
    const c = items[bi];
    chosen.push(c);
    for (let i = 0; i < items.length; i++) {
      minD[i] = Math.min(minD[i], haversine(items[i].lat, items[i].lon, c.lat, c.lon));
    }
  }
  return chosen;
}

function percentile(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

function buildOsmJson(raw, bbox) {
  const { roads, buildings, greenery, pois } = raw;
  const g = buildGraph(roads);
  console.log(`  graph: ${g.rawNodes} raw points, largest component ${g.mainSize}, ${g.nodes.length} junctions, ${g.edges.length} edges`);

  const bldPts = buildings.map(centerOf).filter(Boolean);
  const treeEls = greenery.filter((e) => e.tags?.natural === 'tree' || e.tags?.natural === 'tree_row');
  const parkEls = greenery.filter(
    (e) => e.tags?.leisure === 'park' || e.tags?.natural === 'wood' || /^(grass|recreation_ground)$/.test(e.tags?.landuse || ''),
  );
  const treePts = treeEls.map(centerOf).filter(Boolean);
  const parkPts = parkEls.map(centerOf).filter(Boolean);
  const bldGrid = makeGrid(bldPts);
  const treeGrid = makeGrid(treePts);
  const parkGrid = makeGrid(parkPts);

  const rawDensity = [];
  const treeScores = [];
  for (const e of g.edges) {
    const pts = samplePoints(e.geom, e.length_m);
    const trees = new Set();
    let nearPark = false;
    for (const [lat, lon] of pts) {
      for (const i of treeGrid.within(lat, lon, 35)) trees.add(i);
      if (!nearPark && parkGrid.within(lat, lon, 60).length) nearPark = true;
    }
    treeScores.push(Math.min(1, (trees.size + (nearPark ? 3 : 0)) / 6));
    const mid = midpointOf(e.geom, e.length_m);
    rawDensity.push(bldGrid.within(mid[0], mid[1], 80).length);
  }
  const p95 = Math.max(1, percentile(rawDensity, 0.95));

  const edges = g.edges.map((e, i) => {
    const bldDensity = clamp(rawDensity[i] / p95, 0, 1);
    const treeScore = treeScores[i];
    const shade = clamp(0.05 + 0.25 * bldDensity + 0.6 * treeScore + (CLS_SHADE[e.cls] ?? 0), 0.03, 0.92);
    const uhi = clamp(0.5 + 2.0 * bldDensity + (CLS_UHI[e.cls] ?? 0) - 2.0 * treeScore, -1.5, 3);
    const speed = SPEED[e.cls] ?? 14;
    const minutes = e.length_m / ((speed * 1000) / 60);
    return {
      u: e.u,
      v: e.v,
      length_m: r3(e.length_m),
      minutes: r3(minutes),
      shade: r3(shade),
      uhi: r3(uhi),
      cls: e.cls,
      name: e.name,
      geom: e.geom.map(([a, b]) => [r6(a), r6(b)]),
    };
  });

  // POIs
  const rand = mulberry32(7);
  const restaurantsAll = pois
    .filter((p) => /^(restaurant|fast_food)$/.test(p.tags?.amenity || '') && p.tags?.name)
    .map((p) => {
      const c = centerOf(p);
      if (!c) return null;
      const { node } = nearestNode(g.nodes, c[0], c[1]);
      return { name: p.tags.name, node, lat: r6(c[0]), lon: r6(c[1]) };
    })
    .filter(Boolean);
  const hubs = farthestPointSample(restaurantsAll, 12, rand);

  const restFallback = { fuel: 'Fuel station', drinking_water: 'Drinking water point', shelter: 'Shade shelter' };
  const restAll = pois
    .filter((p) => /^(fuel|drinking_water|shelter)$/.test(p.tags?.amenity || '') || (p.tags?.leisure === 'park' && p.tags?.name))
    .map((p) => {
      const c = centerOf(p);
      if (!c) return null;
      const kind = p.tags.leisure === 'park' ? 'park' : p.tags.amenity;
      const { node } = nearestNode(g.nodes, c[0], c[1]);
      return { name: p.tags.name || restFallback[kind] || 'Rest point', kind, node, lat: r6(c[0]), lon: r6(c[1]) };
    })
    .filter(Boolean);
  const restPoints = farthestPointSample(restAll, 25, rand);

  const counts = {
    ways: roads.length,
    buildings: buildings.length,
    trees: treeEls.length,
    parks: parkEls.length,
    restaurants: restaurantsAll.length,
    nodes: g.nodes.length,
    edges: edges.length,
    restPoints: restPoints.length,
  };

  return {
    bbox,
    fetchedAt: new Date().toISOString(),
    counts,
    nodes: g.nodes.map(([a, b]) => [r6(a), r6(b)]),
    edges,
    hubs,
    restPoints,
  };
}

// ---------- weather ----------
async function fetchHeatwave() {
  for (const year of [2026, 2025]) {
    try {
      const dailyUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${year}-05-01&end_date=${year}-05-31&daily=temperature_2m_max&timezone=Asia%2FKolkata`;
      const daily = await fetchWithTimeout(dailyUrl, 30000, { Accept: 'application/json' });
      const dates = daily.daily?.time || [];
      const tmax = daily.daily?.temperature_2m_max || [];
      let bi = -1;
      for (let i = 0; i < dates.length; i++) {
        if (tmax[i] != null && (bi === -1 || tmax[i] > tmax[bi])) bi = i;
      }
      if (bi === -1) throw new Error('no daily max values');
      const D = dates[bi];
      console.log(`  hottest day of May ${year}: ${D} (${tmax[bi]} °C max)`);
      const hourlyUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${D}&end_date=${D}&hourly=temperature_2m,relative_humidity_2m,shortwave_radiation,wind_speed_10m&timezone=Asia%2FKolkata`;
      const h = await fetchWithTimeout(hourlyUrl, 30000, { Accept: 'application/json' });
      const out = { date: D, source: 'Open-Meteo Historical (ERA5)', hours: [], temp: [], rh: [], rad: [], wind: [] };
      h.hourly.time.forEach((t, i) => {
        const hr = Number(t.slice(11, 13));
        if (hr < 6 || hr > 20) return;
        out.hours.push(hr);
        out.temp.push(h.hourly.temperature_2m[i]);
        out.rh.push(h.hourly.relative_humidity_2m[i]);
        out.rad.push(h.hourly.shortwave_radiation[i]);
        out.wind.push(h.hourly.wind_speed_10m[i]);
      });
      if (out.hours.length !== 15 || out.temp.some((v) => v == null)) throw new Error('incomplete hourly data');
      return out;
    } catch (err) {
      console.log(`  May ${year} weather failed: ${err.message}`);
    }
  }
  throw new Error('Open-Meteo archive unavailable for May 2026 and May 2025');
}

// ---------- main ----------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Fetching OpenStreetMap data (Overpass)…');
  let bbox = BASE_BBOX;
  let raw;
  try {
    raw = await fetchOsm(bbox);
  } catch (err) {
    console.log(`${err.message} — shrinking bbox by 30% and retrying once`);
    bbox = shrinkBbox(BASE_BBOX, 0.7);
    raw = await fetchOsm(bbox);
  }
  console.log(`Using bbox ${bboxStr(bbox)}`);

  console.log('Building routing graph…');
  let osm = buildOsmJson(raw, bbox);
  let text = JSON.stringify(osm);
  if (text.length > 4 * 1024 * 1024) {
    console.log('osm.json > 4 MB — simplifying edge geometry');
    osm.edges.forEach((e) => {
      e.geom = e.geom.filter((_, i) => i === 0 || i === e.geom.length - 1 || i % 2 === 0);
    });
    text = JSON.stringify(osm);
  }
  writeFileSync(resolve(OUT_DIR, 'osm.json'), text);
  console.log('counts:', osm.counts);
  console.log(`hubs: ${osm.hubs.length}, rest points: ${osm.restPoints.length}`);
  console.log(`osm.json size: ${(text.length / 1024 / 1024).toFixed(2)} MB`);

  console.log('Fetching Open-Meteo heatwave day…');
  const hw = await fetchHeatwave();
  writeFileSync(resolve(OUT_DIR, 'heatwave.json'), JSON.stringify(hw));
  console.log(`heatwave.json: ${hw.date}, peak ${Math.max(...hw.temp)} °C, ${hw.hours.length} hours`);

  if (osm.nodes.length <= 300 || osm.edges.length <= 400) {
    console.error(`Graph too small: ${osm.nodes.length} nodes, ${osm.edges.length} edges`);
    process.exit(1);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
