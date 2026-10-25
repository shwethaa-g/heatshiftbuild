# 🔥 HeatShift

**Heat-dose-aware routing & dispatch for gig delivery riders**, built on real Chennai road, building, tree, restaurant and weather data (T. Nagar, Chennai).

HeatShift tracks how much heat each delivery rider has absorbed over a shift, and uses that cumulative dose to pick cooler routes, schedule rest breaks at real rest points, assign orders fairly, and show the city where cooling kiosks would help most.

## Problem

India's delivery riders absorb the city's heat, but no app measures how much each rider has taken.

- 7.7M gig workers in 2020-21, projected to reach 23M by 2029-30 (NITI Aayog).
- Delivery riders are disproportionately affected by extreme heat (CEEW, 2025).
- Unions demand mandatory cooling breaks during IMD heat alerts (IFAT / TGPWU).
- Shade routing exists abroad, but no one manages *cumulative* heat dose.

Dispatch platforms optimise for speed. The same few riders end up on the hottest arterials through the afternoon, and nobody tracks the dose they build up.

## Solution: three layers

1. **Rider View.** Compares the fastest and coolest routes on real T. Nagar streets, with a shift heat-dose meter and a voice rest nudge in English or Tamil that names a real rest point.
2. **Shift Simulator.** Runs 30 riders over an 11:00–17:00 shift on the real road network under real weather. It compares **Standard dispatch** (nearest rider, fastest route) with **HeatShift dispatch** (dose-aware assignment, cool routing and rest breaks).
3. **City Dashboard.** Shows street-level heat-exposure hotspots from the simulated shift, plus the top 5 cooling-kiosk sites, each named by its real street.

## Data sources

All OSM and historical weather data is fetched by `scripts/fetch-data.mjs` and committed as JSON (`src/data/osm.json`, `src/data/heatwave.json`). The browser calls only the Open-Meteo forecast API.

| Data | Source | Used for | In this build |
|---|---|---|---|
| Road network | OpenStreetMap via Overpass API | Routing graph | 1,008 ways → 1,365 junctions, 1,821 street segments |
| Building footprints | OSM via Overpass | Urban heat island (density) | 9,324 buildings |
| Trees, tree rows, parks | OSM via Overpass | Street shade | 13 trees, 14 green areas |
| Restaurants | OSM via Overpass | Pickup hubs | 49 named → 12 hubs |
| Fuel stations, drinking water, parks | OSM via Overpass | Rest points | 17 rest points |
| Hottest day of May 2026 (hourly temp, RH, solar radiation) | Open-Meteo Historical API (ERA5) | "Heatwave Day" mode | 21 May 2026, peak 40.2 °C |
| Today's hourly forecast | Open-Meteo Forecast API (fetched live in browser) | "Live Today" mode | on demand |

Bounding box: `13.030, 80.222, 13.052, 80.246` (T. Nagar).

Attribution: Road & POI data © OpenStreetMap contributors. Weather: Open-Meteo (ERA5 reanalysis / forecast). Map tiles © Esri.

## Heat model

**Wet Bulb Globe Temperature** uses the Australian Bureau of Meteorology approximation:

```
e    = (RH/100) · 6.105 · exp(17.27·T / (237.7 + T))
WBGT = 0.567·T + 0.393·e + 3.94
```

**Street-level WBGT.** Each street segment adds its urban heat island offset and the unshaded solar load to the air temperature:

```
T_street = T_air + uhi + (radiation/1000) · 7 · (1 − shade)
```

**Shade and UHI from OSM**, computed per segment by sampling its midpoint and a point every ~40 m:

- `treeScore` = trees / tree-row centres within 35 m, plus 3 if within 60 m of a park, grass or wood. Normalised as `min(1, score/6)`.
- `bldDensity` = building centres within 80 m, normalised by the 95th percentile.
- `shade = clamp(0.05 + 0.25·bldDensity + 0.6·treeScore + classShade, 0.03, 0.92)`. Buildings shade narrow streets, while wide arterials stay exposed.
- `uhi = clamp(0.5 + 2·bldDensity + classUhi − 2·treeScore, −1.5, 3)`.

**Heat Strain Index (HSI)** = °C·min above 28 °C WBGT, accumulated over the shift. The safe limit is 400 HSI. A 15-minute rest in shade removes 40 % of accumulated strain. Idle time adds strain at 30 % of the open-air rate.

## Dispatch algorithm

- **Routing.** Dijkstra with a binary heap on the contracted OSM graph.
  - Fastest route: cost = minutes.
  - Coolest route: cost = `minutes + λ · strain` (λ = 0.6 by default, adjustable 0–2 in Rider View).
- **Orders.** Poisson(0.9) new orders per minute, generated once from a fixed seed and shared by both policies. Each order picks up at one of 12 restaurant hubs and drops at a node 6–20 minutes away.
- **Standard dispatch.** The rider with the lowest `wait + fastest travel time` gets the order. Both legs use the fastest route.
- **HeatShift dispatch.** The rider with the lowest `wait + cool travel time + 0.08 · current strain` gets the order. Both legs use the coolest route, and riders wait at hub shade. After a drop, a rider over 400 HSI takes the coolest route to the nearest real rest point and rests for 15 minutes.
- One Dijkstra from each pickup gives travel times to every rider, since the graph is undirected. Results are cached per policy, hour and source node, so a full two-policy shift runs in well under a second.

## Results

Seeded shift simulation (seed 7): 30 riders, 11:00–17:00, Heatwave Day (21 May 2026), 333 orders.

| Metric | Standard | HeatShift | Change |
|---|---:|---:|---:|
| Peak rider strain (HSI) | 4,505 | 921 | −79.5 % |
| Mean peak strain per rider (HSI) | 2,993 | 789 | −73.6 % |
| Riders over safe limit at 17:00 | 30 / 30 | 27 / 30 | −10.0 % |
| Rider-minutes over limit | 9,343 | 4,645 | −50.3 % |
| Strain inequality (Gini) | 0.177 | 0.112 | −36.4 % |
| Avg delivery time (min) | 11.6 | 15.1 | +29.7 % |
| Orders delivered by 17:00 | 319 | 316 | −0.9 % |
| Rest breaks | 0 | 292 | — |

HeatShift trades about 3.5 minutes of average delivery time for a 79.5 % lower peak heat dose and a fairer spread of strain across riders.

## Tech stack

- React 18.3.1 + Vite, in plain JavaScript
- Leaflet 1.9.4 + react-leaflet 4.2.1 (Esri World Dark Gray basemap)
- Recharts 2.12.7
- Node ≥ 18 data pipeline (`scripts/fetch-data.mjs`) using the Overpass API and the Open-Meteo Archive API
- No backend. It deploys as a static site (Vercel).

## Run locally

```bash
npm install
npm run fetch-data   # optional: refresh OSM + weather JSON
npm run dev
```

`npm run build` produces the static site in `dist/`.

## Roadmap

- City-wide rollout beyond T. Nagar
- Satellite land-surface temperature and canopy layers
- Platform dispatch API integration
- Wearable heart-rate input for personalised strain
- Extension to sanitation workers and traffic police

## License

MIT, see [LICENSE](LICENSE).
