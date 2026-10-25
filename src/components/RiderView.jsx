import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMapEvents } from 'react-leaflet';
import Legend from './Legend.jsx';
import { weatherAt, HEATWAVE_PROFILE } from '../lib/weather.js';
import { segmentWBGT, rampColor, strainFor, STRAIN_LIMIT, REST_MINUTES } from '../lib/heat.js';
import { BOUNDS, TILE_PROPS } from '../lib/map.js';
import {
  nodes,
  edges,
  hubs,
  restPoints,
  pathTo,
  pathGeom,
  nearestNode,
  routeStats,
  cachedTree,
  fastestCost,
  coolestCost,
  streetsNear,
} from '../lib/graph.js';

const HEAT_COLORS = ['#38bdf8', '#a3e635', '#facc15', '#f59e0b', '#ef4444', '#b91c1c'];
const fastestArr = Float64Array.from(edges, fastestCost);

const RIDER_DEFAULT_LAMBDA = 1.0;
const DEFAULT_TRIP_HOUR = 14;
const TRIP_MIN_MINUTES = 8;
const TRIP_MAX_MINUTES = 20;
const MAX_EXTRA_MINUTES = 5;
const DOSE_MAX = 600;

// Cumulative heat strain from the tree's source to every node.
function treeStrain(tree, strainArr) {
  const order = Array.from(nodes.keys())
    .filter((n) => Number.isFinite(tree.dist[n]))
    .sort((a, b) => tree.dist[a] - tree.dist[b]);
  const out = new Float64Array(nodes.length).fill(Infinity);
  for (const n of order) out[n] = n === tree.src ? 0 : out[tree.prevNode[n]] + strainArr[tree.prevEdge[n]];
  return out;
}

// Default trip: the hub → destination pair (8–20 min fastest) with the largest
// heat-strain reduction at 14:00 on the Heatwave Day, for at most 5 extra minutes.
let defaultTripCache = null;
function getDefaultTrip() {
  if (defaultTripCache) return defaultTripCache;
  const w = weatherAt(HEATWAVE_PROFILE, DEFAULT_TRIP_HOUR);
  const scope = `${HEATWAVE_PROFILE.id}|${HEATWAVE_PROFILE.date}|${RIDER_DEFAULT_LAMBDA}`;
  const strainArr = Float64Array.from(edges, (e) => strainFor(e, w, e.minutes));
  const coolArr = Float64Array.from(edges, coolestCost(w, RIDER_DEFAULT_LAMBDA));
  let best = null;
  let fallback = null;
  for (const h of hubs) {
    const ft = cachedTree(scope, 'fastest', 0, h.node, () => fastestArr);
    const ct = cachedTree(scope, 'coolest', DEFAULT_TRIP_HOUR, h.node, () => coolArr);
    const sf = treeStrain(ft, strainArr);
    const sc = treeStrain(ct, strainArr);
    for (let n = 0; n < nodes.length; n++) {
      if (!(ft.dist[n] >= TRIP_MIN_MINUTES && ft.dist[n] <= TRIP_MAX_MINUTES) || !(sf[n] > 0)) continue;
      if (!fallback) fallback = { origin: h.node, dest: n };
      if (ct.minutes[n] - ft.minutes[n] > MAX_EXTRA_MINUTES) continue;
      const reduction = 1 - sc[n] / sf[n];
      if (!best || reduction > best.reduction) best = { origin: h.node, dest: n, reduction };
    }
  }
  defaultTripCache = best || fallback || { origin: hubs[0].node, dest: hubs[1].node };
  return defaultTripCache;
}

function placeName(node) {
  const hub = hubs.find((h) => h.node === node);
  if (hub) return hub.label;
  const rp = restPoints.find((p) => p.node === node);
  if (rp) return rp.label;
  const s = streetsNear(node, 2);
  return s.length ? s.join(' × ') : 'Selected point';
}

function ClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick(nearestNode(e.latlng.lat, e.latlng.lng)) });
  return null;
}

const fmt1 = (x) => x.toFixed(1);

const COOL_STYLE = { color: '#38bdf8', weight: 6, opacity: 0.95 };
const FAST_STYLE = { color: '#ffffff', weight: 5, opacity: 0.95, dashArray: '8 8' };
const REST_STYLE = { color: '#14532d', weight: 2, fillColor: '#22c55e', fillOpacity: 0.95 };
const HUB_STYLE = { color: '#7c2d12', weight: 2, fillColor: '#f97316', fillOpacity: 0.95 };
const START_STYLE = { color: '#fff', weight: 3, fillColor: '#0f1115', fillOpacity: 1 };
const DROP_STYLE = { color: '#38bdf8', weight: 3, fillColor: '#0f1115', fillOpacity: 1 };

// Static map layers, built once so slider drags don't restyle them.
const POI_LAYER = (
  <>
    {restPoints.map((p) => (
      <CircleMarker key={`r${p.node}${p.name}`} center={[p.lat, p.lon]} radius={6} pathOptions={REST_STYLE}>
        <Tooltip>{p.label} · rest point</Tooltip>
      </CircleMarker>
    ))}
    {hubs.map((h) => (
      <CircleMarker key={`h${h.node}${h.name}`} center={[h.lat, h.lon]} radius={7} pathOptions={HUB_STYLE}>
        <Tooltip>{h.label} · pickup hub</Tooltip>
      </CircleMarker>
    ))}
  </>
);

function RouteCard({ kind, title, stats }) {
  return (
    <div className={`card route-card ${kind}`}>
      <h3>{title}</h3>
      <div className="kv">
        <div>
          <small>Minutes</small>
          <b>{fmt1(stats.minutes)}</b>
        </div>
        <div>
          <small>km</small>
          <b>{stats.km.toFixed(2)}</b>
        </div>
        <div>
          <small>HSI</small>
          <b>{Math.round(stats.strain)}</b>
        </div>
        <div>
          <small>Shade</small>
          <b>{Math.round(stats.shadePct)}%</b>
        </div>
      </div>
      <div className="streets">Via {stats.streets.join(' · ')}</div>
    </div>
  );
}

const NUDGE = {
  'en-IN': (name, min) => `Heat dose high. Rest ${REST_MINUTES} minutes at ${name}, ${min} minute${min === 1 ? '' : 's'} away.`,
  'ta-IN': (name) => `வெப்ப அளவு அதிகம். ${name} இல் 15 நிமிடம் ஓய்வெடுக்கவும்.`,
};

export default function RiderView({ weather, hour }) {
  const [origin, setOrigin] = useState(() => getDefaultTrip().origin);
  const [dest, setDest] = useState(() => getDefaultTrip().dest);
  const [clicks, setClicks] = useState(0);
  const [lambda, setLambda] = useState(RIDER_DEFAULT_LAMBDA);
  const [soFar, setSoFar] = useState(320);
  const [lang, setLang] = useState('en-IN');
  const [voiceNote, setVoiceNote] = useState('');

  const w = useMemo(() => weatherAt(weather, hour), [weather, hour]);
  // colour scale spans this hour's coolest to hottest street
  const heatMap = useMemo(() => {
    const vals = edges.map((e) => segmentWBGT(e, w));
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const stops = HEAT_COLORS.map((color, i) => ({ at: lo + ((hi - lo) * i) / (HEAT_COLORS.length - 1), color }));
    stops[0].label = lo.toFixed(1);
    stops[stops.length - 1].label = hi.toFixed(1);
    return { colors: vals.map((v) => rampColor(stops, v)), stops };
  }, [w]);
  const edgeLayer = useMemo(
    () =>
      edges.map((e, i) => (
        <Polyline key={i} positions={e.geom} interactive={false} pathOptions={{ color: heatMap.colors[i], weight: 2, opacity: 0.8 }} />
      )),
    [heatMap],
  );

  const handleClick = (node) => {
    if (clicks === 0) {
      setOrigin(node);
      setDest(null);
      setClicks(1);
    } else if (clicks === 1) {
      setDest(node);
      setClicks(2);
    } else {
      setOrigin(getDefaultTrip().origin);
      setDest(getDefaultTrip().dest);
      setClicks(0);
    }
  };

  const scope = `${weather.id}|${weather.date}|${lambda}`;
  const hourInt = Math.floor(hour);
  const fastTree = useMemo(() => cachedTree(scope, 'fastest', 0, origin, () => fastestArr), [scope, origin]);
  const coolTree = useMemo(
    () => cachedTree(scope, 'coolest', hourInt, origin, () => Float64Array.from(edges, coolestCost(w, lambda))),
    [scope, hourInt, origin, w, lambda],
  );

  const routes = useMemo(() => {
    if (dest == null || dest === origin) return null;
    const pf = pathTo(fastTree, dest);
    const pc = pathTo(coolTree, dest);
    if (!pf || !pc) return null;
    return {
      fast: { stats: routeStats(pf.edges, w), geom: pathGeom(pf) },
      cool: { stats: routeStats(pc.edges, w), geom: pathGeom(pc) },
      same: pf.edges.join() === pc.edges.join(),
    };
  }, [fastTree, coolTree, dest, origin, w]);

  const routeLayer = useMemo(
    () =>
      routes && (
        <>
          <Polyline positions={routes.cool.geom} interactive={false} pathOptions={COOL_STYLE} />
          <Polyline positions={routes.fast.geom} interactive={false} pathOptions={FAST_STYLE} />
        </>
      ),
    [routes],
  );
  const endpointLayer = useMemo(
    () => (
      <>
        <CircleMarker center={nodes[origin]} radius={9} pathOptions={START_STYLE}>
          <Tooltip permanent direction="top">
            Start
          </Tooltip>
        </CircleMarker>
        {dest != null && (
          <CircleMarker center={nodes[dest]} radius={9} pathOptions={DROP_STYLE}>
            <Tooltip permanent direction="top">
              Drop
            </Tooltip>
          </CircleMarker>
        )}
      </>
    ),
    [origin, dest],
  );

  const rest = useMemo(() => {
    let best = null;
    for (const p of restPoints) {
      const m = coolTree.minutes[p.node];
      if (Number.isFinite(m) && (!best || m < best.minutes)) best = { point: p, minutes: m };
    }
    return best;
  }, [coolTree]);

  const routeStrain = routes ? routes.cool.stats.strain : 0;
  const total = soFar + routeStrain;
  const needsRest = routes && total > STRAIN_LIMIT && rest;
  const restMin = rest ? Math.max(1, Math.round(rest.minutes)) : 0;
  const nudgeText = needsRest ? NUDGE[lang](rest.point.label, restMin) : '';

  const speak = () => {
    setVoiceNote('');
    try {
      if (!('speechSynthesis' in window)) throw new Error('unsupported');
      const u = new SpeechSynthesisUtterance(nudgeText);
      u.lang = lang;
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang === lang) || voices.find((x) => x.lang.startsWith(lang.slice(0, 2)));
      if (v) u.voice = v;
      else if (voices.length && lang === 'ta-IN') setVoiceNote('No Tamil voice installed on this device — the text above is the nudge.');
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      setVoiceNote('Voice playback is not supported in this browser — the text above is the nudge.');
    }
  };

  const pct = Math.min(100, (total / STRAIN_LIMIT) * 100);
  const soFarPct = Math.min(100, (soFar / STRAIN_LIMIT) * 100);
  const deltaMin = routes ? routes.cool.stats.minutes - routes.fast.stats.minutes : 0;
  const deltaStrain = routes && routes.fast.stats.strain > 0 ? (1 - routes.cool.stats.strain / routes.fast.stats.strain) * 100 : 0;
  const hint = clicks === 0 ? 'Click the map to set a new origin' : clicks === 1 ? 'Click to set the destination' : 'Click again to reset';

  return (
    <div className="split">
      <div className="stack">
        <div className="map-wrap">
          <div className="map-hint">
            <span>{hint}</span>
          </div>
          <MapContainer className="map" bounds={BOUNDS} maxZoom={19} preferCanvas scrollWheelZoom>
            <TileLayer {...TILE_PROPS} />
            <ClickHandler onClick={handleClick} />
            {edgeLayer}
            {routeLayer}
            {POI_LAYER}
            {endpointLayer}
          </MapContainer>
        </div>
        <Legend
          ramp={{ title: `Street Heat Index (°C) at ${String(Math.floor(hour)).padStart(2, '0')}:00`, stops: heatMap.stops }}
          items={[
            { kind: 'line', color: '#ffffff', dashed: true, label: 'Fastest' },
            { kind: 'line', color: '#38bdf8', label: 'Coolest' },
            { kind: 'dot', color: '#f97316', label: 'Restaurant pickup hub' },
            { kind: 'dot', color: '#22c55e', label: 'Rest point' },
          ]}
        />
      </div>

      <div className="stack">
        <div className="card small">
          <div>
            <span className="muted">From </span>
            {placeName(origin)}
          </div>
          <div>
            <span className="muted">To </span>
            {dest != null ? placeName(dest) : '—'}
          </div>
        </div>

        {routes ? (
          <>
            <div className="highlight">
              {routes.same
                ? 'Fastest route is already the coolest at this hour'
                : `+${fmt1(Math.max(0, deltaMin))} min, −${Math.max(0, deltaStrain).toFixed(1)}% heat strain`}
              <small>Coolest vs fastest at {String(hourInt).padStart(2, '0')}:00 · {weather.shortLabel}</small>
            </div>
            <RouteCard kind="fast" title="⚡ Fastest route" stats={routes.fast.stats} />
            <RouteCard kind="cool" title="❄ Coolest route" stats={routes.cool.stats} />
            {routes.same && <p className="tiny muted same-note">No cooler alternative on this trip.</p>}
          </>
        ) : (
          <div className="card muted small">Pick a destination on the map to compare routes.</div>
        )}

        <div className="card">
          <div className="field">
            <label htmlFor="lambda">Heat avoidance (λ)</label>
            <div className="field-row">
              <input id="lambda" type="range" min="0" max="2" step="0.1" value={lambda} onChange={(e) => setLambda(Number(e.target.value))} />
              <output htmlFor="lambda" className="slider-value">
                {lambda.toFixed(1)}
              </output>
            </div>
            <span className="tiny muted">Cost per street = minutes + λ × heat strain. λ = 0 gives the fastest route.</span>
          </div>
        </div>

        <div className="card">
          <h3>Shift dose meter</h3>
          <div className="field">
            <label htmlFor="dose">Strain accumulated so far (HSI)</label>
            <div className="field-row">
              <input id="dose" type="range" min="0" max={DOSE_MAX} step="5" value={soFar} onChange={(e) => setSoFar(Number(e.target.value))} />
              <output htmlFor="dose" className="slider-value">
                {soFar}
              </output>
            </div>
            <div className="progress" aria-label="Heat strain against safe limit">
              <span
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, #38bdf8 0%, #38bdf8 ${(soFarPct / Math.max(pct, 1)) * 100}%, ${total > STRAIN_LIMIT ? '#ef4444' : '#f59e0b'} ${(soFarPct / Math.max(pct, 1)) * 100}%)`,
                }}
              />
            </div>
            <span className="tiny muted">
              {soFar} so far + {Math.round(routeStrain)} on the coolest route = <b>{Math.round(total)}</b> / {STRAIN_LIMIT} HSI limit
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            {needsRest ? (
              <div className="alert">
                <b>
                  Rest recommended: {rest.point.label}, {restMin} min away
                </b>
                <p className="small" style={{ margin: '6px 0 10px' }}>
                  {nudgeText}
                </p>
                <div className="field-row">
                  <button className="btn small" onClick={speak} aria-label="Read the rest nudge aloud">
                    🔊 Speak
                  </button>
                  <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Voice language">
                    <option value="en-IN">English</option>
                    <option value="ta-IN">தமிழ்</option>
                  </select>
                </div>
                {voiceNote && <p className="tiny muted" style={{ marginBottom: 0 }}>{voiceNote}</p>}
              </div>
            ) : (
              <div className="ok-box small">Within the safe heat dose for this trip.</div>
            )}
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            HSI = Heat Strain Index, °C·min above 28 °C WBGT.
          </p>
        </div>
      </div>
    </div>
  );
}
