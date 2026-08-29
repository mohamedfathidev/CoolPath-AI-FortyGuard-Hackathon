import crypto from "node:crypto";
import { ensureSchema, getPool } from "../db/client.js";
import type { Polygon } from "./types.js";

type CacheTable = "heatmap_cache" | "env_params_cache" | "heat_intelligence_cache";

// Round to ~11m precision (5 decimal places) so near-identical polygons/points
// hit the same cache entry instead of re-spending credits over float noise.
function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function polygonCacheKey(polygon: Polygon, extra: Record<string, unknown>): string {
  const rounded = polygon.coordinates.map((ring) => ring.map(([lon, lat]) => [roundCoord(lon), roundCoord(lat)]));
  return hashKey({ polygon: rounded, ...extra });
}

export function pointCacheKey(lon: number, lat: number, extra: Record<string, unknown>): string {
  return hashKey({ lon: roundCoord(lon), lat: roundCoord(lat), ...extra });
}

function hashKey(payload: unknown): string {
  const json = JSON.stringify(payload, Object.keys(payload as object).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

export async function getCached<T>(table: CacheTable, key: string): Promise<T | undefined> {
  await ensureSchema();
  const { rows } = await getPool().query<{ result_json: string }>(
    `SELECT result_json FROM ${table} WHERE cache_key = $1`,
    [key]
  );
  return rows[0] ? (JSON.parse(rows[0].result_json) as T) : undefined;
}

export async function setCached(table: CacheTable, key: string, request: unknown, result: unknown): Promise<void> {
  await ensureSchema();
  await getPool().query(
    `INSERT INTO ${table} (cache_key, request_json, result_json, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cache_key) DO UPDATE SET request_json = $2, result_json = $3, created_at = $4`,
    [key, JSON.stringify(request), JSON.stringify(result), Date.now()]
  );
}
