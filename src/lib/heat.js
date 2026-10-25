export function wbgt(t, rh){const e=(rh/100)*6.105*Math.exp((17.27*t)/(237.7+t));return 0.567*t+0.393*e+3.94;} // BoM approximation
export function segmentWBGT(edge,w){const solar=(w.rad/1000)*7*(1-edge.shade);return wbgt(w.temp+edge.uhi+solar,w.rh);}
export const SAFE_WBGT=28, STRAIN_LIMIT=400, REST_MINUTES=15, REST_RECOVERY=0.4;
export const strainFor=(edge,w,min)=>Math.max(0,segmentWBGT(edge,w)-SAFE_WBGT)*min;
export const idleStrainPerMin=(w)=>Math.max(0,wbgt(w.temp,w.rh)-SAFE_WBGT)*0.3;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rampColor(stops, x) {
  if (x <= stops[0].at) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i].at) {
      const f = (x - stops[i - 1].at) / (stops[i].at - stops[i - 1].at);
      const a = hexToRgb(stops[i - 1].color);
      const b = hexToRgb(stops[i].color);
      const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return stops[stops.length - 1].color;
}

