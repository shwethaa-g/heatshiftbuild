import { bbox } from './graph.js';

export const BOUNDS = [
  [bbox.south, bbox.west],
  [bbox.north, bbox.east],
];

// Esri World Dark Gray Base: dark basemap that needs no API key.
export const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
export const TILE_ATTR = 'Tiles © Esri · Road data © OpenStreetMap contributors';
export const TILE_PROPS = { url: TILE_URL, attribution: TILE_ATTR, maxNativeZoom: 16, maxZoom: 19 };
