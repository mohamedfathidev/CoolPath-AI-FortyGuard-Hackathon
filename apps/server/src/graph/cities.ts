export interface CityConfig {
  slug: string;
  name: string;
  /** Clean "City, State" label for geocoding queries — no parentheticals. */
  geocodeLabel: string;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
}

// Encanto Park + surrounding blocks, Phoenix, AZ — pilot area. ~2.2km x 2.3km
// (~5.1 km^2, well under the 10mi^2/130km^2 cap). Chosen over plain downtown
// because live FortyGuard data showed the downtown-pavement-only bbox is
// thermally flat (~0.07degC spread) — everywhere is uniformly hot, so no
// route can meaningfully differ. This bbox includes a large park (measured
// ~0.3degC / 0.5degF cooler pockets) alongside dense urban blocks.
export const CITY_CONFIGS: Record<string, CityConfig> = {
  phoenix: {
    slug: "phoenix",
    name: "Phoenix, AZ (Encanto Park area)",
    geocodeLabel: "Phoenix, AZ",
    bbox: { minLat: 33.47, minLon: -112.1, maxLat: 33.49, maxLon: -112.075 },
  },
};

export const DEFAULT_CITY = "phoenix";
