import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HeatIslandsData, RouteResultData } from "../api";
import { CITY_BBOX } from "../cityConfig";

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const SHORTEST_COLOR = "#3b82f6";
const HEAT_OPTIMIZED_COLOR = "#16a34a";

function lineGeoJson(coords: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
}

// When the shortest and heat-optimized routes are identical (or nearly so — no viable
// cooler detour exists for that pair), one line would completely hide the other. Nudge the
// heat-optimized line a few meters sideways so both stay visible; the offset is small enough
// to be invisible once the routes genuinely diverge by more than that.
function offsetPerpendicular(coords: [number, number][], meters: number): [number, number][] {
  if (coords.length < 2) return coords;
  const [lon1, lat1] = coords[0];
  const [lon2, lat2] = coords[coords.length - 1];
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const len = Math.sqrt(dLon * dLon + dLat * dLat) || 1;
  const perpLon = -dLat / len;
  const perpLat = dLon / len;
  const metersPerDegLat = 110_540;
  const metersPerDegLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const offsetLon = (perpLon * meters) / metersPerDegLon;
  const offsetLat = (perpLat * meters) / metersPerDegLat;
  return coords.map(([lon, lat]) => [lon + offsetLon, lat + offsetLat]);
}

// Google-Maps-style labeled teardrop pin ("A" for origin, "B" for destination) — a
// maplibregl.Marker's built-in `color` option gives a plain unlabeled dot, so this builds a
// small custom DOM element instead.
function pinElement(label: string, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "30px";
  el.style.height = "40px";
  el.innerHTML = `
    <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z" fill="${color}"/>
      <circle cx="15" cy="15" r="10" fill="white"/>
      <text x="15" y="20" font-size="13" font-weight="700" text-anchor="middle" fill="${color}" font-family="sans-serif">${label}</text>
    </svg>`;
  return el;
}

function heatTilesGeoJson(data: HeatIslandsData | null) {
  return {
    type: "FeatureCollection" as const,
    features: (data?.tiles ?? []).map((t) => ({
      type: "Feature" as const,
      properties: { hours: t.exposureHours },
      geometry: { type: "Point" as const, coordinates: [t.lon, t.lat] },
    })),
  };
}

interface MapViewProps {
  route: RouteResultData | null;
  origin: { lat: number; lon: number } | null;
  destination: { lat: number; lon: number } | null;
  selection: "both" | "shortest" | "heatOptimized";
  heatIslands?: HeatIslandsData | null;
}

export default function MapView({ route, origin, destination, selection, heatIslands }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: [number, number] = [(CITY_BBOX.minLon + CITY_BBOX.maxLon) / 2, (CITY_BBOX.minLat + CITY_BBOX.maxLat) / 2];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center,
      zoom: 14,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Heat-island overlay (added first so routes/markers draw on top). Each tile is a circle
      // coloured cool→hot by hours/day above the threshold — the climate heat-island view.
      map.addSource("heat-islands", { type: "geojson", data: heatTilesGeoJson(null) });
      map.addLayer({
        id: "heat-islands",
        type: "circle",
        source: "heat-islands",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 14, 15, 22, 17, 34],
          "circle-blur": 0.35,
          "circle-opacity": 0.75,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.5)",
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "hours"],
            10, "#2c7bb6",
            11.5, "#abd9e9",
            12.5, "#ffffbf",
            13, "#fdae61",
            13.5, "#d7191c",
          ],
        },
      });

      map.addSource("shortest-route", { type: "geojson", data: lineGeoJson([]) });
      map.addLayer({
        id: "shortest-route",
        type: "line",
        source: "shortest-route",
        paint: { "line-color": SHORTEST_COLOR, "line-width": 4, "line-opacity": 0.85 },
      });

      map.addSource("heat-route", { type: "geojson", data: lineGeoJson([]) });
      map.addLayer({
        id: "heat-route",
        type: "line",
        source: "heat-route",
        paint: { "line-color": HEAT_OPTIMIZED_COLOR, "line-width": 5, "line-opacity": 0.95 },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Heat-island overlay update — separate from routes so toggling tabs doesn't refit route bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("heat-islands") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData(heatTilesGeoJson(heatIslands ?? null));
      if (heatIslands && heatIslands.tiles.length && !route) {
        // Fit to the actual tile extent (the heat view covers a wider area than routing).
        const lons = heatIslands.tiles.map((t) => t.lon);
        const lats = heatIslands.tiles.map((t) => t.lat);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 40, duration: 500 }
        );
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [heatIslands, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyData = () => {
      const shortestSrc = map.getSource("shortest-route") as maplibregl.GeoJSONSource | undefined;
      const heatSrc = map.getSource("heat-route") as maplibregl.GeoJSONSource | undefined;
      if (!shortestSrc || !heatSrc) return;

      shortestSrc.setData(lineGeoJson(route?.shortest.coordinates ?? []));
      const heatCoords = route?.heatOptimized.coordinates ?? [];
      heatSrc.setData(lineGeoJson(heatCoords.length ? offsetPerpendicular(heatCoords, 5) : heatCoords));

      // The route-selector buttons dim the route not chosen so the picked one stands out.
      const shortestVisible = selection !== "heatOptimized";
      const heatVisible = selection !== "shortest";
      if (map.getLayer("shortest-route")) {
        map.setPaintProperty("shortest-route", "line-opacity", shortestVisible ? 0.85 : 0.15);
        map.setPaintProperty("shortest-route", "line-width", selection === "shortest" ? 6 : 4);
      }
      if (map.getLayer("heat-route")) {
        map.setPaintProperty("heat-route", "line-opacity", heatVisible ? 0.95 : 0.15);
        map.setPaintProperty("heat-route", "line-width", selection === "heatOptimized" ? 7 : 5);
      }

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      if (origin) {
        markersRef.current.push(
          new maplibregl.Marker({ element: pinElement("A", "#111827"), anchor: "bottom" })
            .setLngLat([origin.lon, origin.lat])
            .addTo(map)
        );
      }
      if (destination) {
        markersRef.current.push(
          new maplibregl.Marker({ element: pinElement("B", "#dc2626"), anchor: "bottom" })
            .setLngLat([destination.lon, destination.lat])
            .addTo(map)
        );
      }

      if (route?.shortest.coordinates.length) {
        const coords = [...route.shortest.coordinates, ...route.heatOptimized.coordinates];
        const lons = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 60, duration: 500 }
        );
      }
    };

    if (map.isStyleLoaded()) applyData();
    else map.once("load", applyData);
  }, [route, origin, destination, selection]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
