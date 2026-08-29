import type { HeatmapResult, HeatmapTileFeature } from "../fortyguard/types.js";
import { haversineMeters } from "../graph/graphStore.js";

// Instantaneous temperature turned out to be nearly flat (~0.5degF spread) at
// pedestrian-route scale in real FortyGuard data for the pilot area — routes
// weighted on it were indistinguishable from plain shortest-path. Cumulative
// daily heat exposure (exceedance: hours/day above a threshold) showed a real
// ~2.8hr spread instead, so that's what actually drives route weighting; the
// instant degF numbers below are kept only for user-facing "how hot right now" display.
export const DEFAULT_BETA = 0.05;
export const DEFAULT_COMFORT_F = 85;

export const EXPOSURE_THRESHOLD_C = 35; // ~95degF
// Empirically, beta beyond ~0.5 saturates (no larger detour is available in the
// pilot graph regardless of how high beta goes) — 0.5 captures the achievable
// exposure reduction without pushing A* through pointless extra computation.
export const DEFAULT_BETA_EXPOSURE = 0.5;
export const DEFAULT_COMFORT_HOURS = 8;

export interface TileIndex {
  tiles: HeatmapTileFeature[];
}

export function buildTileIndex(heatmap: HeatmapResult): TileIndex {
  return { tiles: heatmap.map_data.features };
}

function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function tileCentroid(tile: HeatmapTileFeature): { lon: number; lat: number } {
  const ring = tile.geometry.coordinates[0];
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

/** Generic point lookup against a tile grid: exact tile if the point falls inside one, else nearest tile centroid. */
function tileValueAt(index: TileIndex, lon: number, lat: number, extract: (t: HeatmapTileFeature) => number | undefined): number | undefined {
  if (index.tiles.length === 0) return undefined;

  for (const tile of index.tiles) {
    if (pointInRing(lon, lat, tile.geometry.coordinates[0])) {
      return extract(tile);
    }
  }

  let best: HeatmapTileFeature | undefined;
  let bestDist = Infinity;
  for (const tile of index.tiles) {
    const c = tileCentroid(tile);
    const d = haversineMeters(lon, lat, c.lon, c.lat);
    if (d < bestDist) {
      bestDist = d;
      best = tile;
    }
  }
  return best ? extract(best) : undefined;
}

/** Degrees Celsius at a point, from a "tcm" (instantaneous) heatmap. */
export function temperatureCAt(index: TileIndex, lon: number, lat: number): number | undefined {
  return tileValueAt(index, lon, lat, (t) => t.properties.average_temperature);
}

/** Hours/day above threshold at a point, from an "exceedance" heatmap. */
export function exposureHoursAt(index: TileIndex, lon: number, lat: number): number | undefined {
  return tileValueAt(index, lon, lat, (t) => t.properties.value);
}

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/** distance_m * (1 + beta * max(0, value - comfort)) — used for both the degF and hours-exposure signals. */
export function heatWeightedCost(distance_m: number, value: number | undefined, beta: number, comfort: number): number {
  if (value === undefined) return distance_m;
  return distance_m * (1 + beta * Math.max(0, value - comfort));
}
