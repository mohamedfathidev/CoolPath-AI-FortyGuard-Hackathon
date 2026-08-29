import { CITY_CONFIGS, DEFAULT_CITY } from "../graph/cities.js";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Free, no-key geocoding via OSM Nominatim, biased to the pilot city's bbox. */
export async function geocode(query: string, cityHint?: string): Promise<GeocodeResult | undefined> {
  const city = CITY_CONFIGS[DEFAULT_CITY];
  const { minLon, minLat, maxLon, maxLat } = city.bbox;
  const viewbox = `${minLon},${maxLat},${maxLon},${minLat}`;
  const q = `${query}, ${cityHint ?? city.geocodeLabel}`;

  const search = async (bounded: boolean): Promise<NominatimResult[]> => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", q);
    url.searchParams.set("viewbox", viewbox);
    if (bounded) url.searchParams.set("bounded", "1");

    const res = await fetch(url, { headers: { "User-Agent": "CoolPath-Agent-Hackathon/0.1" } });
    if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
    return (await res.json()) as NominatimResult[];
  };

  let results = await search(true);
  if (results.length === 0) results = await search(false);
  if (results.length === 0) return undefined;

  const r = results[0];
  return { latitude: parseFloat(r.lat), longitude: parseFloat(r.lon), displayName: r.display_name };
}

interface PhotonFeature {
  properties: {
    name?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    [key: string]: unknown;
  };
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

function photonLabel(p: PhotonFeature["properties"]): string {
  return [p.name, p.street, p.district ?? p.city, p.state].filter(Boolean).join(", ");
}

/**
 * Live typeahead search via Photon (komoot's free, no-key, autocomplete-oriented OSM
 * geocoder) — unlike Nominatim's geocode() above, this is built for "search as you type"
 * and returns several ranked candidates. Results are filtered to the pilot city's bbox
 * (+ same margin RoutingEngine allows) since anything outside it can't actually be routed.
 */
export async function autocompleteSearch(query: string, limit = 6): Promise<GeocodeResult[]> {
  if (query.trim().length < 2) return [];

  const city = CITY_CONFIGS[DEFAULT_CITY];
  const centerLat = (city.bbox.minLat + city.bbox.maxLat) / 2;
  const centerLon = (city.bbox.minLon + city.bbox.maxLon) / 2;
  const margin = 0.01;

  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("lat", String(centerLat));
  url.searchParams.set("lon", String(centerLon));
  url.searchParams.set("limit", String(limit * 3)); // over-fetch, then bbox-filter

  const res = await fetch(url, { headers: { "User-Agent": "CoolPath-Agent-Hackathon/0.1" } });
  if (!res.ok) throw new Error(`Autocomplete request failed: ${res.status}`);
  const data = (await res.json()) as PhotonResponse;

  return data.features
    .filter(
      (f) =>
        f.geometry.coordinates[1] >= city.bbox.minLat - margin &&
        f.geometry.coordinates[1] <= city.bbox.maxLat + margin &&
        f.geometry.coordinates[0] >= city.bbox.minLon - margin &&
        f.geometry.coordinates[0] <= city.bbox.maxLon + margin
    )
    .slice(0, limit)
    .map((f) => ({
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
      displayName: photonLabel(f.properties) || query,
    }));
}
