export interface CityConfig {
  slug: string;
  name: string;
  /** Clean "City, State" label for geocoding queries — no parentheticals. */
  geocodeLabel: string;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
}

// Central + Downtown Phoenix, AZ. ~4.9km x 3.2km (~16 km^2, still under the
// 10mi^2/130km^2 cap). Extends from the Encanto Park area south into Downtown
// (Arizona Center / Van Buren) so routing covers the city core. Graph stays
// small enough (~7MB) for Railway's 512MB free tier. Encanto Park's cooler
// pockets keep real heat-optimization signal in the mix.
export const CITY_CONFIGS: Record<string, CityConfig> = {
  phoenix: {
    slug: "phoenix",
    name: "Phoenix, AZ (Central + Downtown)",
    geocodeLabel: "Phoenix, AZ",
    bbox: { minLat: 33.45, minLon: -112.105, maxLat: 33.494, maxLon: -112.07 },
  },
};

export const DEFAULT_CITY = "phoenix";
