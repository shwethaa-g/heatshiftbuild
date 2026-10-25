import { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import Legend from './Legend.jsx';
import { useSimRunner, RunButton } from './FleetSim.jsx';
import { rampColor } from '../lib/heat.js';
import { nodes, edges, adj, streetsNear, haversine, GENERIC_NAMES } from '../lib/graph.js';
import { BOUNDS, TILE_PROPS } from '../lib/map.js';

const EXPOSURE_STOPS = [
  { at: 0, color: '#1e3a5f', label: 'low' },
  { at: 0.25, color: '#38bdf8', label: '' },
  { at: 0.5, color: '#f59e0b', label: '' },
  { at: 0.75, color: '#ef4444', label: '' },
  { at: 1, color: '#fecaca', label: 'highest' },
];
const MIN_SPACING_M = 300;

function kioskSites(exposure) {
  const total = exposure.reduce((s, v) => s + v, 0);
  const score = nodes.map((_, n) => adj[n].reduce((s, a) => s + exposure[a.edgeIdx], 0));
  const order = score.map((s, n) => [s, n]).sort((a, b) => b[0] - a[0]);
  const picks = [];
  for (const [s, n] of order) {
    if (picks.length >= 5 || s <= 0) break;
    if (picks.some((p) => haversine(nodes[p.node][0], nodes[p.node][1], nodes[n][0], nodes[n][1]) < MIN_SPACING_M)) continue;
    const incident = adj[n]
      .map((a) => ({ name: edges[a.edgeIdx].name, x: exposure[a.edgeIdx] }))
      .filter((e) => !GENERIC_NAMES.has(e.name))
      .sort((a, b) => b.x - a.x);
    const near = streetsNear(n, 3);
    const street = incident[0]?.name || near[0] || 'Unnamed street';
    const other = near.find((x) => x !== street) || null;
    picks.push({ node: n, street, other, pct: (100 * s) / total });
  }
  return picks;
}

export default function CityDashboard({ weather, sim, setSim }) {
  const { running, run } = useSimRunner(weather, setSim);

  const view = useMemo(() => {
    if (!sim) return null;
    const exposure = sim.standard.edgeExposure;
    const max = exposure.reduce((m, v) => Math.max(m, v), 0) || 1;
    const lines = edges
      .map((e, i) => ({ i, geom: e.geom, norm: exposure[i] / max, name: e.name }))
      .sort((a, b) => a.norm - b.norm);
    return { lines, kiosks: kioskSites(exposure) };
  }, [sim]);

  if (!view) {
    return (
      <div className="card empty">
        <h3>City Dashboard</h3>
        <p>
          Street-level heat-exposure hotspots and the top 5 cooling-kiosk sites come from the Standard-dispatch shift simulation. Run it to
          see where riders absorb the most heat.
        </p>
        <RunButton weather={weather} running={running} run={run} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="split">
        <div className="stack">
          <div className="map-wrap">
            <MapContainer className="map" bounds={BOUNDS} maxZoom={19} preferCanvas scrollWheelZoom>
              <TileLayer {...TILE_PROPS} />
              {view.lines.map((l) =>
                l.norm > 0 ? (
                  <Polyline
                    key={l.i}
                    positions={l.geom}
                    pathOptions={{ color: rampColor(EXPOSURE_STOPS, l.norm), weight: 2 + 7 * l.norm, opacity: 0.85 }}
                  >
                    <Tooltip sticky>
                      {l.name} · {Math.round(l.norm * 100)}% of the hottest street
                    </Tooltip>
                  </Polyline>
                ) : (
                  <Polyline key={l.i} positions={l.geom} interactive={false} pathOptions={{ color: '#3a4150', weight: 1.5, opacity: 0.6 }} />
                ),
              )}
              {view.kiosks.map((k, idx) => (
                <CircleMarker
                  key={k.node}
                  center={nodes[k.node]}
                  radius={11}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 0.95 }}
                >
                  <Tooltip permanent direction="top" offset={[0, -8]}>
                    #{idx + 1}
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <Legend
            ramp={{ title: 'Rider heat exposure (Standard dispatch)', stops: EXPOSURE_STOPS }}
            items={[{ kind: 'dot', color: '#ef4444', label: 'Cooling-kiosk site' }]}
          />
        </div>

        <div className="card">
          <h3>Top 5 cooling-kiosk sites</h3>
          <ol className="rank">
            {view.kiosks.map((k, idx) => (
              <li key={k.node}>
                <span>
                  <b>
                    #{idx + 1} — {k.street}
                  </b>
                  {k.other && <> near {k.other}</>} — <span className="pct">{k.pct.toFixed(1)}%</span> of total rider heat exposure
                </span>
              </li>
            ))}
          </ol>
          <p className="tiny muted">
            Each junction is scored by the heat strain riders absorbed on the streets meeting there during the simulated shift (Standard
            dispatch, {sim.weatherLabel}). Sites are at least {MIN_SPACING_M} m apart.
          </p>
        </div>
      </div>
      <p className="closing">The same engine extends to sanitation workers, traffic police and street vendors.</p>
    </div>
  );
}
