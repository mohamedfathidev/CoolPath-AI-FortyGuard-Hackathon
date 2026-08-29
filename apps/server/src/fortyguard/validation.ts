import type { LonLat, Polygon, PolygonAoi } from "./types.js";

export class FortyGuardValidationError extends Error {}

// Approximate bounding boxes: CONUS, Alaska, Hawaii. Good enough to reject
// obviously-non-U.S. coordinates client-side before spending a credit.
const US_BOXES: Array<{ minLon: number; maxLon: number; minLat: number; maxLat: number }> = [
  { minLon: -125, maxLon: -66.9, minLat: 24.4, maxLat: 49.5 }, // CONUS
  { minLon: -179.2, maxLon: -129.9, minLat: 51, maxLat: 71.5 }, // Alaska
  { minLon: -160.3, maxLon: -154.7, minLat: 18.9, maxLat: 22.3 }, // Hawaii
];

export function isUsCoordinate(lon: number, lat: number): boolean {
  return US_BOXES.some(
    (b) => lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat
  );
}

export function assertUsCoordinate(lon: number, lat: number): void {
  if (!isUsCoordinate(lon, lat)) {
    throw new FortyGuardValidationError(
      `Coordinate (${lon}, ${lat}) is outside FortyGuard's U.S. coverage area.`
    );
  }
}

export function assertUsPolygon(polygon: Polygon): void {
  for (const ring of polygon.coordinates) {
    for (const [lon, lat] of ring) {
      assertUsCoordinate(lon, lat);
    }
  }
}

// FortyGuard's documented date floor (Known Limitations page, confirmed live 2026-08-29).
const MIN_DATE = new Date("2019-01-01T00:00:00Z");

/** Every FortyGuard endpoint allows historical data back to 2019-01-01 and forecasts up to now+12h. */
export function assertValidDateTime(date: string, time: string): void {
  const dt = new Date(`${date}T${time}`);
  if (Number.isNaN(dt.getTime())) {
    throw new FortyGuardValidationError(`Invalid date/time: ${date} ${time}`);
  }
  if (dt < MIN_DATE) {
    throw new FortyGuardValidationError(`Date must be on or after 2019-01-01 (got ${date}).`);
  }
  const maxDate = new Date();
  maxDate.setHours(maxDate.getHours() + 12);
  if (dt > maxDate) {
    throw new FortyGuardValidationError(
      `Date/time ${date} ${time} is more than 12 hours in the future, which FortyGuard does not support.`
    );
  }
}

// Rough area check via the shoelace formula projected to meters at the
// polygon centroid — precise enough to catch a polygon that's grossly over
// the ~130 km^2 / 50 mi^2 cap before we waste an API call.
export function assertPolygonAreaWithinLimit(polygon: Polygon, maxKm2 = 130): void {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) {
    throw new FortyGuardValidationError("Polygon must have a closed ring of at least 4 points.");
  }
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    throw new FortyGuardValidationError("Polygon ring must be closed (first point == last point).");
  }

  const centroidLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const metersPerDegLon = 111_320 * Math.cos((centroidLat * Math.PI) / 180);
  const metersPerDegLat = 110_540;

  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const x1 = lon1 * metersPerDegLon;
    const y1 = lat1 * metersPerDegLat;
    const x2 = lon2 * metersPerDegLon;
    const y2 = lat2 * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  const areaKm2 = Math.abs(area / 2) / 1_000_000;

  if (areaKm2 > maxKm2) {
    throw new FortyGuardValidationError(
      `Polygon area ${areaKm2.toFixed(1)} km^2 exceeds the ${maxKm2} km^2 cap.`
    );
  }
}

export function bboxToPolygon(minLon: number, minLat: number, maxLon: number, maxLat: number): Polygon {
  const ring: LonLat[] = [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
  return { type: "Polygon", coordinates: [ring] };
}

/** FortyGuard requires polygon_aoi as a GeoJSON FeatureCollection, not a bare Polygon. */
export function toPolygonAoi(polygon: Polygon): PolygonAoi {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: polygon }],
  };
}
