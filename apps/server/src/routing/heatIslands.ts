import { FortyGuardClient } from "../fortyguard/client.js";
import { CITY_CONFIGS, DEFAULT_CITY } from "../graph/cities.js";
import { bboxToPolygon } from "../fortyguard/validation.js";
import { celsiusToFahrenheit, EXPOSURE_THRESHOLD_C } from "./weighting.js";
import { reverseGeocode } from "../agent/geocodingService.js";

export interface HeatTile {
  lon: number;
  lat: number;
  exposureHours: number;
}

export interface Hotspot {
  lon: number;
  lat: number;
  exposureHours: number;
  label: string;
}

export interface HeatIslandsResult {
  city: string;
  date: string;
  thresholdF: number;
  thresholdC: number;
  minHours: number;
  maxHours: number;
  meanHours: number;
  /** How much more extreme heat the worst zones endure vs the coolest — the heat-island gap. */
  spreadHours: number;
  tiles: HeatTile[];
  hotspots: Hotspot[];
  insight: string;
}

function tileCentroid(coords: [number, number][]): { lon: number; lat: number } {
  let lon = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lon += x;
    lat += y;
  }
  return { lon: lon / coords.length, lat: lat / coords.length };
}

/**
 * Surfaces FortyGuard's daily heat-exposure (exceedance) data as a city-wide heat-island map:
 * every tile's hours/day above the threshold, plus the worst hotspots and a climate insight.
 */
export async function getHeatIslands(fortyGuard: FortyGuardClient, date: string): Promise<HeatIslandsResult> {
  const city = CITY_CONFIGS[DEFAULT_CITY];

  // The heat-island view covers a wider area than routing (routing is tied to the OSM graph;
  // the heat map isn't). Expand the pilot bbox ~2x per side (~4x area, still well under
  // FortyGuard's ~130 km^2 / 50 mi^2 per-request cap) so it shows more of Phoenix at once.
  const b = city.bbox;
  const cLat = (b.minLat + b.maxLat) / 2;
  const cLon = (b.minLon + b.maxLon) / 2;
  const halfLat = (b.maxLat - b.minLat);
  const halfLon = (b.maxLon - b.minLon);
  const polygon = bboxToPolygon(cLon - halfLon, cLat - halfLat, cLon + halfLon, cLat + halfLat);

  const heatmap = await fortyGuard.getHeatmap({
    polygon,
    start_date: date,
    filter_type: 3,
    granularity: 100,
    analytic_type: "exceedance",
    threshold: EXPOSURE_THRESHOLD_C,
    direction: "above",
  });

  const tiles: HeatTile[] = heatmap.map_data.features.map((f) => {
    const c = tileCentroid(f.geometry.coordinates[0]);
    return { lon: c.lon, lat: c.lat, exposureHours: f.properties.value ?? 0 };
  });

  const hoursValues = tiles.map((t) => t.exposureHours);
  const minHours = Math.min(...hoursValues);
  const maxHours = Math.max(...hoursValues);
  const meanHours = hoursValues.reduce((s, v) => s + v, 0) / hoursValues.length;
  const spreadHours = maxHours - minHours;

  // Top hotspots — dedup nearby tiles so we don't return 5 adjacent cells of the same block.
  const sorted = [...tiles].sort((a, b) => b.exposureHours - a.exposureHours);
  const picked: HeatTile[] = [];
  for (const t of sorted) {
    if (picked.length >= 4) break;
    const tooClose = picked.some(
      (p) => Math.abs(p.lat - t.lat) < 0.004 && Math.abs(p.lon - t.lon) < 0.004
    );
    if (!tooClose) picked.push(t);
  }

  const hotspots: Hotspot[] = await Promise.all(
    picked.map(async (t) => ({
      lon: t.lon,
      lat: t.lat,
      exposureHours: t.exposureHours,
      label: (await reverseGeocode(t.lat, t.lon)) ?? `${t.lat.toFixed(4)}, ${t.lon.toFixed(4)}`,
    }))
  );

  const insight =
    `Across ${city.name}, the hottest blocks endure ${maxHours.toFixed(1)} hours/day above ` +
    `${celsiusToFahrenheit(EXPOSURE_THRESHOLD_C).toFixed(0)}°F — ${spreadHours.toFixed(1)} more hours than the coolest, ` +
    `shaded areas (${minHours.toFixed(1)} hrs). That gap is a textbook urban heat island: dense pavement and ` +
    `little tree cover trap heat long after cooler, greener blocks have relieved. As climate change pushes ` +
    `Phoenix summers hotter and longer, these are exactly the blocks where cooling infrastructure — shade, ` +
    `tree canopy, reflective surfaces — delivers the most protection for people on foot.`;

  return {
    city: city.name,
    date,
    thresholdF: celsiusToFahrenheit(EXPOSURE_THRESHOLD_C),
    thresholdC: EXPOSURE_THRESHOLD_C,
    minHours,
    maxHours,
    meanHours,
    spreadHours,
    tiles,
    hotspots,
    insight,
  };
}
