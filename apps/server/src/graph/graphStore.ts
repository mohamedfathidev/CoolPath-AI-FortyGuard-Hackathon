import fs from "node:fs";
import path from "node:path";

export interface Edge {
  to: number;
  distance_m: number;
  /** Midpoint of the edge, used to look up the heat tile for weighting. */
  midLon: number;
  midLat: number;
}

export interface StreetGraph {
  citySlug: string;
  adjacency: Map<number, Edge[]>;
  nodeCoords: Map<number, { lon: number; lat: number }>;
}

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface GraphGeoJson {
  type: "FeatureCollection";
  features: Array<{
    properties: { from: number; to: number; distance_m: number };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }>;
}

const cache = new Map<string, StreetGraph>();

export function loadStreetGraph(citySlug: string, dataDir?: string): StreetGraph {
  const cached = cache.get(citySlug);
  if (cached) return cached;

  const graphPath = path.resolve(
    dataDir ?? path.resolve(process.cwd(), "..", "..", "data"),
    "cities",
    citySlug,
    "graph.geojson"
  );
  const raw = fs.readFileSync(graphPath, "utf-8");
  const geojson = JSON.parse(raw) as GraphGeoJson;

  const adjacency = new Map<number, Edge[]>();
  const nodeCoords = new Map<number, { lon: number; lat: number }>();

  const addEdge = (from: number, to: number, distance_m: number, midLon: number, midLat: number) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ to, distance_m, midLon, midLat });
  };

  for (const f of geojson.features) {
    const { from, to, distance_m } = f.properties;
    const [[lon1, lat1], [lon2, lat2]] = f.geometry.coordinates;
    nodeCoords.set(from, { lon: lon1, lat: lat1 });
    nodeCoords.set(to, { lon: lon2, lat: lat2 });
    const midLon = (lon1 + lon2) / 2;
    const midLat = (lat1 + lat2) / 2;
    // Walking is bidirectional regardless of any car-only OSM restriction.
    addEdge(from, to, distance_m, midLon, midLat);
    addEdge(to, from, distance_m, midLon, midLat);
  }

  const graph: StreetGraph = { citySlug, adjacency, nodeCoords };
  cache.set(citySlug, graph);
  return graph;
}

/** Linear-scan nearest node — fine for a single pilot city's graph size. */
export function nearestNode(graph: StreetGraph, lon: number, lat: number): { nodeId: number; distance_m: number } {
  let bestId = -1;
  let bestDist = Infinity;
  for (const [id, coord] of graph.nodeCoords) {
    const d = haversineMeters(lon, lat, coord.lon, coord.lat);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return { nodeId: bestId, distance_m: bestDist };
}

export { haversineMeters };
