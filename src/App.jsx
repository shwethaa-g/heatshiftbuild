import { useEffect, useMemo, useState } from 'react';
import Hero from './components/Hero.jsx';
import RiderView from './components/RiderView.jsx';
import FleetSim from './components/FleetSim.jsx';
import CityDashboard from './components/CityDashboard.jsx';
import { HEATWAVE_PROFILE, weatherAt, fetchLiveToday } from './lib/weather.js';
import { wbgt } from './lib/heat.js';
import { counts } from './lib/graph.js';

const TABS = ['Overview', 'Rider View', 'Shift Simulator', 'City Dashboard'];
const nf = new Intl.NumberFormat('en-IN');

export default function App() {
  const [tab, setTab] = useState('Overview');
  const [mode, setMode] = useState('heatwave');
  const [live, setLive] = useState(null);
  const [liveStatus, setLiveStatus] = useState('idle');
  const [hour, setHour] = useState(14);
  const [sim, setSim] = useState(null);

  const weather = mode === 'live' && live ? live : HEATWAVE_PROFILE;
  const w = useMemo(() => weatherAt(weather, hour), [weather, hour]);

  useEffect(() => setSim(null), [weather]);

  const pickLive = async () => {
    if (live) {
      setMode('live');
      return;
    }
    setLiveStatus('loading');
    const p = await fetchLiveToday();
    if (p) {
      setLive(p);
      setMode('live');
      setLiveStatus('ok');
    } else {
      setMode('heatwave');
      setLiveStatus('error');
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>
            🔥 <span>Heat</span>Shift
          </h1>
          <p>Heat-dose-aware routing &amp; dispatch for gig riders</p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Weather mode">
            <button className={mode === 'heatwave' ? 'on' : ''} onClick={() => setMode('heatwave')}>
              {HEATWAVE_PROFILE.label}
            </button>
            <button className={mode === 'live' ? 'on' : ''} onClick={pickLive} disabled={liveStatus === 'loading'}>
              {liveStatus === 'loading' ? 'Loading…' : 'Live Today'}
            </button>
          </div>
          <span className="chip">
            <b>{w.temp.toFixed(1)} °C</b> · RH {Math.round(w.rh)}% · Street Heat Index (°C) <b>{wbgt(w.temp, w.rh).toFixed(1)}</b>
          </span>
          <label className="hour">
            Hour
            <input type="range" min="6" max="20" step="1" value={hour} onChange={(e) => setHour(Number(e.target.value))} />
            <output>{String(hour).padStart(2, '0')}:00</output>
          </label>
        </div>
      </header>
      {liveStatus === 'error' && mode === 'heatwave' && <div className="notice">Live forecast unreachable — showing Heatwave Day</div>}

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'Overview' && <Hero onStart={() => setTab('Rider View')} />}
        {tab === 'Rider View' && <RiderView weather={weather} hour={hour} />}
        {tab === 'Shift Simulator' && <FleetSim weather={weather} sim={sim} setSim={setSim} />}
        {tab === 'City Dashboard' && <CityDashboard weather={weather} sim={sim} setSim={setSim} />}
      </main>

      <footer className="footer">
        <span>
          Road &amp; POI data © OpenStreetMap contributors · Weather: Open-Meteo (ERA5 reanalysis / forecast) · Map tiles © Esri
        </span>
        <span>
          {nf.format(counts.edges)} street segments · {nf.format(counts.buildings)} buildings · {nf.format(counts.trees)} trees mapped
        </span>
      </footer>
    </div>
  );
}
