import fs from "node:fs";
import path from "node:path";

export interface Bbox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

type OverpassElement = OverpassNode | OverpassWay | { type: string };

interface OverpassResponse {
  elements: OverpassElement[];
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Walkable highway types; excludes motorways/trunks which pedestrians can't use.
const EXCLUDED_HIGHWAY = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "raceway", "proposed", "construction"]);

function buildQuery(bbox: Bbox): string {
  const { minLat, minLon, maxLat, maxLon } = bbox;
  return `[out:json][timeout:90];
(
  way["highway"]["foot"!~"no|private"](${minLat},${minLon},${maxLat},${maxLon});
);
out body;
>;
out skel qt;`;
}

export interface GraphEdgeFeature {
  type: "Feature";
  properties: { from: number; to: number; distance_m: number };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export interface GraphGeoJson {
  type: "FeatureCollection";
  features: GraphEdgeFeature[];
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

export async function fetchOsmGraph(bbox: Bbox): Promise<GraphGeoJson> {
  const query = buildQuery(bbox);
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "CoolPath-Agent-Hackathon/0.1",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as OverpassResponse;

  const nodes = new Map<number, { lon: number; lat: number }>();
  const ways: OverpassWay[] = [];
  for (const el of data.elements) {
    if (el.type === "node") {
      const n = el as OverpassNode;
      nodes.set(n.id, { lon: n.lon, lat: n.lat });
    } else if (el.type === "way") {
      ways.push(el as OverpassWay);
    }
  }

  const features: GraphEdgeFeature[] = [];
  const seenEdges = new Set<string>();

  for (const way of ways) {
    const highway = way.tags?.highway;
    if (highway && EXCLUDED_HIGHWAY.has(highway)) continue;

    for (let i = 0; i < way.nodes.length - 1; i++) {
      const fromId = way.nodes[i];
      const toId = way.nodes[i + 1];
      const from = nodes.get(fromId);
      const to = nodes.get(toId);
      if (!from || !to) continue;

      const key = fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);

      const distance_m = haversineMeters(from.lon, from.lat, to.lon, to.lat);
      if (distance_m === 0) continue;

      features.push({
        type: "Feature",
        properties: { from: fromId, to: toId, distance_m },
        geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export async function fetchAndSaveOsmGraph(bbox: Bbox, outPath: string): Promise<GraphGeoJson> {
  const graph = await fetchOsmGraph(bbox);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(graph));
  return graph;
}
