// In production the frontend and backend are on different hosts, so calls go to VITE_API_BASE
// (e.g. the Render URL). Locally it's empty, and Vite's dev proxy forwards /api to localhost:8787.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface RoutePathData {
  coordinates: [number, number][];
  distance_m: number;
  duration_s: number;
  avgTemperatureF: number;
  maxTemperatureF: number;
  avgExposureHours: number;
  maxExposureHours: number;
  hottestPoint?: { lon: number; lat: number; temperatureF: number };
}

export interface RouteResultData {
  city: string;
  shortest: RoutePathData;
  heatOptimized: RoutePathData;
  extraDistance_m: number;
  extraDuration_s: number;
  temperatureReductionF: number;
  exposureReductionHours: number;
}

export interface GeocodeResultData {
  latitude: number;
  longitude: number;
  displayName: string;
}

export interface HeatTileData {
  lon: number;
  lat: number;
  exposureHours: number;
}

export interface HotspotData {
  lon: number;
  lat: number;
  exposureHours: number;
  label: string;
}

export interface HeatIslandsData {
  city: string;
  date: string;
  thresholdF: number;
  thresholdC: number;
  minHours: number;
  maxHours: number;
  meanHours: number;
  spreadHours: number;
  tiles: HeatTileData[];
  hotspots: HotspotData[];
  insight: string;
}

export async function fetchHeatIslands(date: string): Promise<HeatIslandsData> {
  const res = await fetch(`${API_BASE}/api/heat-islands?date=${encodeURIComponent(date)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? `Heat islands request failed (${res.status})`);
  return res.json();
}

export async function geocodeQuery(q: string): Promise<GeocodeResultData> {
  const res = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? `Geocoding failed (${res.status})`);
  return res.json();
}

export async function autocompleteQuery(q: string): Promise<GeocodeResultData[]> {
  const res = await fetch(`${API_BASE}/api/geocode/autocomplete?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return res.json();
}

export async function computeRoute(opts: {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  date: string;
  time: string;
}): Promise<RouteResultData> {
  const res = await fetch(`${API_BASE}/api/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `Route request failed (${res.status})`);
  return res.json();
}

export type AgentEvent =
  | { type: "tool_start"; tool: string; args: Record<string, unknown> }
  | { type: "tool_complete"; tool: string; ok: boolean }
  | { type: "route_result"; result: RouteResultData }
  | { type: "model"; model: string }
  | { type: "final"; answer: string; model: string }
  | { type: "error"; message: string };

export async function streamAgent(message: string, onEvent: (event: AgentEvent) => void): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.body) throw new Error("No response body from /api/agent");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice("data:".length).trim();
      if (!json) continue;
      onEvent(JSON.parse(json) as AgentEvent);
    }
  }
}
