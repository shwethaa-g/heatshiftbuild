import StatCard from './StatCard.jsx';
import { counts } from '../lib/graph.js';
import { HEATWAVE_PROFILE, formatDate } from '../lib/weather.js';

const nf = new Intl.NumberFormat('en-IN');
const peakTemp = Math.max(...HEATWAVE_PROFILE.temp);

const STEPS = [
  { title: 'Measure dose', text: 'Every street gets a WBGT from live or historical weather, OSM shade and building density. Each rider carries a running Heat Strain Index.' },
  { title: 'Route cool & rest', text: 'Routing trades minutes for heat strain, and nudges riders to a real rest point, in English or Tamil, before they cross the safe limit.' },
  { title: 'Dispatch fairly', text: 'Orders go to riders who are close and least heat-loaded, so no single rider absorbs the whole afternoon.' },
  { title: 'Plan city cooling', text: 'Fleet-wide exposure shows the streets where riders absorb the most heat — the best sites for cooling kiosks.' },
];

export default function Hero({ onStart }) {
  const rows = [
    { data: 'Road network', source: 'OpenStreetMap via Overpass API', use: 'Routing graph', n: `${nf.format(counts.ways)} ways → ${nf.format(counts.edges)} street segments` },
    { data: 'Building footprints', source: 'OSM via Overpass', use: 'Urban heat island (density)', n: `${nf.format(counts.buildings)} buildings` },
    { data: 'Trees, tree rows, parks', source: 'OSM via Overpass', use: 'Street shade', n: `${nf.format(counts.trees)} trees · ${nf.format(counts.parks)} green areas` },
    { data: 'Restaurants', source: 'OSM via Overpass', use: 'Pickup hubs', n: `${nf.format(counts.restaurants)} named → 12 hubs` },
    { data: 'Fuel stations, drinking water, parks', source: 'OSM via Overpass', use: 'Rest points', n: `${nf.format(counts.restPoints)} rest points` },
    {
      data: 'Hottest day of May (hourly temp, RH, solar radiation)',
      source: 'Open-Meteo Historical API (ERA5)',
      use: '"Heatwave Day" mode',
      n: `${formatDate(HEATWAVE_PROFILE.date)} · peak ${peakTemp.toFixed(1)} °C`,
    },
    { data: "Today's hourly forecast", source: 'Open-Meteo Forecast API (live in browser)', use: '"Live Today" mode', n: 'fetched on demand' },
  ];

  return (
    <div>
      <section className="hero">
        <h2>
          India&apos;s delivery riders absorb the city&apos;s heat — <em>but no app measures how much each rider has taken.</em>
        </h2>
        <p>
          HeatShift tracks each rider&apos;s cumulative heat dose and uses it to route, rest and dispatch, on real T. Nagar streets under real
          Chennai weather.
        </p>
      </section>

      <div className="grid cols-4">
        <StatCard label="Gig workforce" value="7.7M → 23M" sub="gig workers in 2020-21, projected by 2029-30" source="NITI Aayog" />
        <StatCard label="Heat risk" value="Riders hit hardest" sub="Delivery riders are disproportionately affected by extreme heat" source="CEEW, 2025" />
        <StatCard label="Worker demand" value="Cooling breaks" sub="Unions demand mandatory cooling breaks during IMD heat alerts" source="IFAT / TGPWU" />
        <StatCard label="The gap" value="Cumulative dose" sub="Shade routing exists abroad, but no one manages cumulative heat dose" source="HeatShift focus" />
      </div>

      <h2 className="section-title">How it works</h2>
      <div className="grid cols-4 steps">
        {STEPS.map((s) => (
          <div className="card step" key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </div>

      <h2 className="section-title">Built on real data</h2>
      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Source</th>
              <th>Used for</th>
              <th>In this build</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.data}>
                <td>{r.data}</td>
                <td className="muted">{r.source}</td>
                <td>{r.use}</td>
                <td className="num">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cta">
        <button className="btn" onClick={onStart}>
          See it on the map →
        </button>
      </div>
    </div>
  );
}
