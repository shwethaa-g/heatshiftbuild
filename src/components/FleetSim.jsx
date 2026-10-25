import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend as ChartLegend,
  ReferenceLine,
} from 'recharts';
import StatCard from './StatCard.jsx';
import { runBoth, fmtTime, N_RIDERS } from '../lib/sim.js';
import { STRAIN_LIMIT } from '../lib/heat.js';

const STD = '#ef4444';
const HS = '#38bdf8';
const axis = { stroke: '#9aa3b2', fontSize: 12 };
const tooltipStyle = { contentStyle: { background: '#111318', border: '1px solid #2a2f3a', borderRadius: 8 }, labelStyle: { color: '#e8e8e8' } };

export function useSimRunner(weather, setSim) {
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const t0 = performance.now();
      const res = runBoth(weather);
      res.ms = performance.now() - t0;
      setSim(res);
      setRunning(false);
    }, 30);
  };
  return { running, run };
}

export function RunButton({ weather, running, run }) {
  return (
    <div>
      <button className="btn" onClick={run} disabled={running}>
        ▶ Run shift ({N_RIDERS} riders · 11:00–17:00 · {weather.label})
      </button>
      {running && (
        <div className="loading">
          <span className="spinner" /> Simulating {N_RIDERS} riders on 5 km² of T. Nagar…
        </div>
      )}
    </div>
  );
}

const ROWS = [
  { key: 'peakStrainMax', label: 'Peak rider strain', unit: ' HSI', fmt: (v) => Math.round(v).toLocaleString('en-IN'), lower: true },
  { key: 'ridersOverLimit', label: 'Riders over safe limit', sub: `at 17:00 (> ${STRAIN_LIMIT} HSI)`, fmt: (v) => `${v}/${N_RIDERS}`, lower: true },
  { key: 'minutesOverLimitTotal', label: 'Minutes over limit', sub: 'rider-minutes, all riders', fmt: (v) => Math.round(v).toLocaleString('en-IN'), lower: true },
  { key: 'giniStrain', label: 'Strain inequality (Gini)', sub: 'final strain across riders', fmt: (v) => v.toFixed(3), lower: true },
  { key: 'avgDeliveryMin', label: 'Avg delivery time', unit: ' min', fmt: (v) => v.toFixed(1), lower: true },
  { key: 'ordersDelivered', label: 'Orders delivered', sub: 'by 17:00', fmt: (v) => String(v), lower: false },
  { key: 'totalRests', label: 'Rest breaks', sub: '15-min cooling stops', fmt: (v) => String(v), lower: null },
];

function DeltaCard({ row, standard, heatshift }) {
  const a = standard[row.key];
  const b = heatshift[row.key];
  let cls = 'neutral';
  let text;
  if (a === 0) {
    text = b === 0 ? 'no change' : `+${row.fmt(b)}`;
  } else {
    const pct = ((b - a) / Math.abs(a)) * 100;
    text = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
    if (row.lower !== null && Math.abs(pct) >= 0.05) cls = (row.lower ? b < a : b > a) ? 'good' : 'bad';
  }
  return (
    <StatCard label={row.label} sub={row.sub}>
      <div className="pair">
        <div className="std">
          <small>Standard</small>
          <b>
            {row.fmt(a)}
            {row.unit || ''}
          </b>
        </div>
        <div className="hs">
          <small>HeatShift</small>
          <b>
            {row.fmt(b)}
            {row.unit || ''}
          </b>
        </div>
      </div>
      <span className={`delta ${cls}`}>{text}</span>
    </StatCard>
  );
}

export default function FleetSim({ weather, sim, setSim }) {
  const { running, run } = useSimRunner(weather, setSim);

  if (!sim) {
    return (
      <div className="card empty">
        <h3>Shift Simulator</h3>
        <p>
          {N_RIDERS} riders work an 11:00–17:00 shift on the OpenStreetMap road network of T. Nagar. The same order stream is dispatched twice:
          Standard (nearest rider, fastest route) and HeatShift (dose-aware assignment, cool routing and rest breaks).
        </p>
        <RunButton weather={weather} running={running} run={run} />
      </div>
    );
  }

  const { standard, heatshift } = sim;
  const sortedStd = standard.perRider.slice().sort((x, y) => y - x);
  const sortedHs = heatshift.perRider.slice().sort((x, y) => y - x);
  const bars = sortedStd.map((v, i) => ({ rank: i + 1, standard: Math.round(v), heatshift: Math.round(sortedHs[i]) }));
  const log = heatshift.rests
    .slice()
    .sort((a, b) => a.time - b.time)
    .slice(0, 8);

  return (
    <div className="stack">
      <div className="field-row" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <RunButton weather={weather} running={running} run={run} />
        <span className="tiny muted">
          {standard.ordersTotal} orders · seed 7 · computed in {Math.round(sim.ms)} ms · {sim.weatherLabel}
        </span>
      </div>

      <div className="grid cols-4">
        {ROWS.map((row) => (
          <DeltaCard key={row.key} row={row} standard={standard} heatshift={heatshift} />
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Max rider strain over the shift</h3>
          <div className="chart">
            <ResponsiveContainer>
              <LineChart data={sim.timeSeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={axis} stroke="#2a2f3a" interval={3} />
                <YAxis tick={axis} stroke="#2a2f3a" width={52} />
                <Tooltip {...tooltipStyle} />
                <ChartLegend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={STRAIN_LIMIT} stroke="#f59e0b" strokeDasharray="6 4" label={{ value: `Safe limit ${STRAIN_LIMIT}`, fill: '#f59e0b', fontSize: 11, position: 'insideTopLeft' }} />
                <Line type="monotone" dataKey="standardMax" name="Standard" stroke={STD} strokeWidth={2.5} dot={false} animationDuration={500} />
                <Line type="monotone" dataKey="heatshiftMax" name="HeatShift" stroke={HS} strokeWidth={2.5} dot={false} animationDuration={500} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3>Final strain per rider (sorted)</h3>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={bars} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barGap={1}>
                <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="rank" tick={axis} stroke="#2a2f3a" interval={4} />
                <YAxis tick={axis} stroke="#2a2f3a" width={52} />
                <Tooltip {...tooltipStyle} labelFormatter={(l) => `Rider rank ${l}`} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <ChartLegend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={STRAIN_LIMIT} stroke="#f59e0b" strokeDasharray="6 4" />
                <Bar dataKey="standard" name="Standard" fill={STD} animationDuration={500} />
                <Bar dataKey="heatshift" name="HeatShift" fill={HS} animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Rest-break log (HeatShift)</h3>
        {log.length ? (
          <ul className="log">
            {log.map((r, i) => (
              <li key={i}>
                {fmtTime(r.time)} · Rider {r.riderId} → {r.restPointName} ({Math.max(1, Math.round(r.minutesAway))} min)
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No rider crossed the safe limit, so no rest breaks were scheduled.</p>
        )}
        {heatshift.rests.length > log.length && (
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Showing the first {log.length} of {heatshift.rests.length} rest breaks.
          </p>
        )}
      </div>

      <p className="caption">
        Shift simulation on OpenStreetMap road network with Open-Meteo weather. Heat model: WBGT (BoM approximation) with street-level shade
        from OSM trees, parks and building density.
      </p>
    </div>
  );
}
