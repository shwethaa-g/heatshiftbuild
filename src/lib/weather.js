import heatwave from '../data/heatwave.json';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export const HEATWAVE_PROFILE = {
  id: 'heatwave',
  label: `Heatwave Day (${formatDate(heatwave.date)})`,
  shortLabel: `Heatwave Day ${formatDate(heatwave.date)}`,
  date: heatwave.date,
  source: heatwave.source,
  hours: heatwave.hours,
  temp: heatwave.temp,
  rh: heatwave.rh,
  rad: heatwave.rad,
};

// Linear interpolation of temp / RH / solar radiation, clamped to 06:00–20:00.
export function weatherAt(profile, hourFloat) {
  const h = Math.min(20, Math.max(6, hourFloat));
  const { hours } = profile;
  let i = hours.findIndex((x) => x >= h);
  if (i <= 0) i = 1;
  const h0 = hours[i - 1];
  const h1 = hours[i];
  const f = h1 === h0 ? 0 : Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  const lerp = (arr) => arr[i - 1] + (arr[i] - arr[i - 1]) * f;
  return { temp: lerp(profile.temp), rh: lerp(profile.rh), rad: lerp(profile.rad) };
}

export async function fetchLiveToday() {
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=13.0418&longitude=80.2341&hourly=temperature_2m,relative_humidity_2m,shortwave_radiation&timezone=Asia%2FKolkata&forecast_days=1';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const out = { hours: [], temp: [], rh: [], rad: [] };
    json.hourly.time.forEach((t, i) => {
      const hr = Number(t.slice(11, 13));
      if (hr < 6 || hr > 20) return;
      const temp = json.hourly.temperature_2m[i];
      const rh = json.hourly.relative_humidity_2m[i];
      const rad = json.hourly.shortwave_radiation[i];
      if (temp == null || rh == null || rad == null) return;
      out.hours.push(hr);
      out.temp.push(temp);
      out.rh.push(rh);
      out.rad.push(rad);
    });
    if (out.hours.length < 2) throw new Error('incomplete forecast');
    const date = json.hourly.time[0].slice(0, 10);
    return {
      id: 'live',
      label: `Live Today (${formatDate(date)})`,
      shortLabel: `Live Today ${formatDate(date)}`,
      date,
      source: 'Open-Meteo Forecast',
      ...out,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
