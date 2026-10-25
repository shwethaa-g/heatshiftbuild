import { mulberry32, poisson } from './rng.js';
import { weatherAt } from './weather.js';
import { strainFor, idleStrainPerMin, STRAIN_LIMIT, REST_MINUTES, REST_RECOVERY } from './heat.js';
import { nodes, edges, hubs, restPoints, dijkstra, pathTo, cachedTree, fastestCost, coolestCost, DEFAULT_LAMBDA } from './graph.js';

export const N_RIDERS = 30;
export const SHIFT_START = 660;
export const SHIFT_END = 1020;
export const ORDER_RATE = 0.9;
export const DISPATCH_WEIGHT = 0.08;
const HUB_IDLE_FACTOR = 0.3;

const fastestArr = Float64Array.from(edges, fastestCost);

export const fmtTime = (min) => {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Shared scenario: rider start nodes + order stream, identical for both policies.
function buildScenario(seed) {
  const rand = mulberry32(seed);
  const riderStarts = Array.from({ length: N_RIDERS }, () => Math.floor(rand() * nodes.length));
  const dropCandidates = hubs.map((h) => {
    const tree = dijkstra(h.node, fastestArr);
    const out = [];
    for (let i = 0; i < nodes.length; i++) if (tree.dist[i] >= 6 && tree.dist[i] <= 20) out.push(i);
    return out;
  });
  const orders = [];
  for (let t = SHIFT_START; t < SHIFT_END; t++) {
    const k = poisson(rand, ORDER_RATE);
    for (let j = 0; j < k; j++) {
      const hi = Math.floor(rand() * hubs.length);
      const cands = dropCandidates[hi];
      const drop = cands.length ? cands[Math.floor(rand() * cands.length)] : hubs[(hi + 1) % hubs.length].node;
      orders.push({ id: orders.length, t: t + rand(), hub: hi, pickup: hubs[hi].node, drop });
    }
  }
  return { riderStarts, orders };
}

export function runSim({ policy, weather, seed = 7, lambda = DEFAULT_LAMBDA }) {
  const { riderStarts, orders } = buildScenario(seed);
  const heatshift = policy === 'heatshift';
  const scope = `${weather.id}|${weather.date}|${lambda}`;
  const exposure = new Float64Array(edges.length);
  const riders = riderStarts.map((node, id) => ({
    id: id + 1,
    node,
    freeAt: SHIFT_START,
    strain: 0,
    peak: 0,
    overMin: 0,
    samples: [[SHIFT_START, 0]],
  }));
  const deliveries = [];
  const rests = [];

  const treeFor = (hour, src) => {
    if (!heatshift) return cachedTree(scope, 'fastest', 0, src, () => fastestArr);
    const w = weatherAt(weather, hour);
    return cachedTree(scope, 'coolest', hour, src, () => Float64Array.from(edges, coolestCost(w, lambda)));
  };

  const addStrain = (r, s, minutes) => {
    r.strain += s;
    if (r.strain > STRAIN_LIMIT) r.overMin += minutes;
    if (r.strain > r.peak) r.peak = r.strain;
  };

  // walk a list of edges starting at `time`; returns arrival time
  const walk = (r, edgeIdxs, w, time) => {
    for (const ei of edgeIdxs) {
      const e = edges[ei];
      const s = strainFor(e, w, e.minutes);
      exposure[ei] += s;
      time += e.minutes;
      addStrain(r, s, e.minutes);
      r.samples.push([time, r.strain]);
    }
    return time;
  };

  const idle = (r, from, to) => {
    const gap = to - from;
    if (gap <= 0) return;
    const w = weatherAt(weather, Math.floor(from / 60));
    const rate = idleStrainPerMin(w) * (heatshift ? HUB_IDLE_FACTOR : 1);
    const base = r.strain;
    // intermediate samples so charts show idle strain building up gradually
    for (let t = Math.ceil(from / 15) * 15; t < to; t += 15) r.samples.push([t, base + rate * (t - from)]);
    addStrain(r, rate * gap, gap);
    r.samples.push([to, r.strain]);
  };

  for (const o of orders) {
    const hour = Math.floor(o.t / 60);
    const w = weatherAt(weather, hour);
    const tree = treeFor(hour, o.pickup);

    let best = null;
    let bestScore = Infinity;
    for (const r of riders) {
      const travel = tree.minutes[r.node];
      if (!Number.isFinite(travel)) continue;
      const score = Math.max(0, r.freeAt - o.t) + travel + (heatshift ? DISPATCH_WEIGHT * r.strain : 0);
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    const r = best;
    const start = Math.max(o.t, r.freeAt);
    idle(r, r.freeAt, start);

    const toPickup = pathTo(tree, r.node).edges.slice().reverse();
    let time = walk(r, toPickup, w, start);
    const toDrop = pathTo(tree, o.drop).edges;
    time = walk(r, toDrop, w, time);
    deliveries.push({ id: o.id, t: o.t, done: time, minutes: time - o.t });
    r.node = o.drop;
    r.freeAt = time;

    if (heatshift && r.strain > STRAIN_LIMIT) {
      let rp = null;
      let rpTree = null;
      let rpMin = Infinity;
      for (const p of restPoints) {
        const t2 = treeFor(hour, p.node);
        if (t2.minutes[r.node] < rpMin) {
          rpMin = t2.minutes[r.node];
          rp = p;
          rpTree = t2;
        }
      }
      if (rp) {
        const toRest = pathTo(rpTree, r.node).edges.slice().reverse();
        time = walk(r, toRest, w, time);
        rests.push({ time, riderId: r.id, restPointName: rp.label, minutesAway: rpMin });
        time += REST_MINUTES;
        r.strain *= 1 - REST_RECOVERY;
        r.samples.push([time, r.strain]);
        r.node = rp.node;
        r.freeAt = time;
      }
    }
  }
  for (const r of riders) idle(r, r.freeAt, SHIFT_END);

  return { policy, riders, deliveries, rests, exposure, weatherLabel: weather.label };
}

// Strain on a 15-minute grid, last value carried forward.
function resample(r, grid) {
  const out = [];
  let j = 0;
  let cur = 0;
  for (const g of grid) {
    while (j < r.samples.length && r.samples[j][0] <= g) {
      cur = r.samples[j][1];
      j++;
    }
    out.push(cur);
  }
  return out;
}

export function gini(values) {
  const x = values.slice().sort((a, b) => a - b);
  const n = x.length;
  const sum = x.reduce((s, v) => s + v, 0);
  if (!n || sum === 0) return 0;
  let acc = 0;
  x.forEach((v, i) => (acc += (i + 1) * v));
  return (2 * acc) / (n * sum) - (n + 1) / n;
}

function quantile(arr, q) {
  const s = arr.slice().sort((a, b) => a - b);
  if (!s.length) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function metrics(res) {
  const grid = [];
  for (let t = SHIFT_START; t <= SHIFT_END; t += 15) grid.push(t);
  const series = res.riders.map((r) => resample(r, grid));
  const finals = series.map((s) => s.at(-1));
  const peaks = res.riders.map((r) => r.peak);
  const mins = res.deliveries.map((d) => d.minutes);
  return {
    ordersDelivered: res.deliveries.filter((d) => d.done <= SHIFT_END).length,
    ordersTotal: res.deliveries.length,
    avgDeliveryMin: mins.reduce((s, v) => s + v, 0) / Math.max(1, mins.length),
    p90DeliveryMin: quantile(mins, 0.9),
    peakStrainMax: Math.max(...peaks),
    peakStrainMean: peaks.reduce((s, v) => s + v, 0) / peaks.length,
    ridersOverLimit: finals.filter((v) => v > STRAIN_LIMIT).length,
    ridersEverOverLimit: peaks.filter((v) => v > STRAIN_LIMIT).length,
    minutesOverLimitTotal: res.riders.reduce((s, r) => s + r.overMin, 0),
    giniStrain: gini(finals),
    totalRests: res.rests.length,
    grid: grid.map(fmtTime),
    maxSeries: grid.map((_, k) => Math.max(...series.map((s) => s[k]))),
    meanSeries: grid.map((_, k) => series.reduce((a, s) => a + s[k], 0) / series.length),
    perRider: finals,
    edgeExposure: res.exposure,
    rests: res.rests,
  };
}

export function runBoth(weather, seed = 7) {
  const standard = metrics(runSim({ policy: 'standard', weather, seed }));
  const heat = metrics(runSim({ policy: 'heatshift', weather, seed }));
  const timeSeries = standard.grid.map((time, k) => ({
    time,
    standardMax: Math.round(standard.maxSeries[k]),
    heatshiftMax: Math.round(heat.maxSeries[k]),
    standardMean: Math.round(standard.meanSeries[k]),
    heatshiftMean: Math.round(heat.meanSeries[k]),
  }));
  return { standard, heatshift: heat, timeSeries, weatherLabel: weather.label };
}
