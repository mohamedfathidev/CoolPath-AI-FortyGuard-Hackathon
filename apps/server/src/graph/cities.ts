export interface CityConfig {
  slug: string;
  name: string;
  /** Clean "City, State" label for geocoding queries — no parentheticals. */
  geocodeLabel: string;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
}

// Encanto Park + surrounding blocks, Phoenix, AZ — pilot area. ~3.1km x 2.6km
// (~2x the original ~5km^2 pilot, still well under the 10mi^2/130km^2 cap).
// Widened from the original Encanto-only bbox to cover more of central Phoenix
// for routing. Kept modest (2x, not 4x) to stay within Railway's 512MB free-tier
// memory when the OSM walking graph loads. Includes Encanto Park (cooler pockets)
// alongside denser urban blocks so heat-optimized routes still have real signal.
export const CITY_CONFIGS: Record<string, CityConfig> = {
  phoenix: {
    slug: "phoenix",
    name: "Phoenix, AZ (Central)",
    geocodeLabel: "Phoenix, AZ",
    bbox: { minLat: 33.466, minLon: -112.105, maxLat: 33.494, maxLon: -112.07 },
  },
};

export const DEFAULT_CITY = "phoenix";
