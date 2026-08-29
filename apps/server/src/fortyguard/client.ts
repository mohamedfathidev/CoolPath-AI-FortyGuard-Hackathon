import {
  assertPolygonAreaWithinLimit,
  assertUsCoordinate,
  assertUsPolygon,
  assertValidDateTime,
  toPolygonAoi,
} from "./validation.js";
import { getCached, pointCacheKey, polygonCacheKey, setCached } from "./cache.js";
import type {
  AnalyticType,
  CreditsUsage,
  EnvParamsResult,
  FilterType,
  HeatIntelligenceAnalysis,
  HeatIntelligenceResult,
  HeatmapResult,
  Polygon,
  StatusResponse,
  SubmitResponse,
} from "./types.js";

export class FortyGuardApiError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
  }
}

/** Activity is still "Processing" after our poll budget — NOT a failure. Never resubmit on this. */
export class FortyGuardTimeoutError extends FortyGuardApiError {}

/** Activity reached terminal "Failed" status — safe to resubmit once, per FortyGuard's docs (failed tasks cost no credits). */
export class FortyGuardTaskFailedError extends FortyGuardApiError {}

interface PollOptions {
  maxAttempts?: number;
  backoffMs?: number[];
}

// Empirically, a small heatmap tile took ~30-40s to complete — budget generously.
const DEFAULT_BACKOFF_MS = [3000, 5000, 8000, 12000, 20000, 20000, 20000];
// Heat Intelligence reports can take "several minutes" per FortyGuard's docs —
// poll longer, but still bounded so the agent turn doesn't hang indefinitely.
// Heat Intelligence generates a full PDF report and genuinely takes 2-4 minutes; measured
// ~154s+ live. Budget ~5 min of polling so it actually completes instead of timing out.
const HEAT_INTELLIGENCE_BACKOFF_MS = [
  5000, 10000, 15000, 20000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000,
];

export class FortyGuardClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey = process.env.FORTYGUARD_API_KEY, baseUrl = process.env.FORTYGUARD_BASE_URL) {
    if (!apiKey) {
      throw new Error("FORTYGUARD_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? "https://api.fortyguard.com";
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }

    if (!res.ok) {
      throw new FortyGuardApiError(`FortyGuard ${method} ${path} failed: ${res.status}`, res.status, json);
    }
    return json as T;
  }

  /** Submit a job, poll status with backoff, retry once on failure (failed tasks cost no credits). */
  private async submitAndPoll<TResult>(
    submitPath: string,
    body: unknown,
    opts: PollOptions = {}
  ): Promise<TResult> {
    const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
    const maxAttempts = opts.maxAttempts ?? backoff.length;

    const run = async (): Promise<TResult> => {
      const submitted = await this.request<SubmitResponse>("POST", submitPath, body);
      const activityId = submitted.data.activity_id;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const status = await this.request<StatusResponse<TResult>>(
          "GET",
          `/v1/status/${activityId}`
        );

        if (status.data.status === "Completed") {
          if (status.data.result === undefined) {
            throw new FortyGuardApiError(`Activity ${activityId} completed with no result`);
          }
          return status.data.result;
        }
        if (status.data.status === "Failed") {
          throw new FortyGuardTaskFailedError(`Activity ${activityId} failed`);
        }

        await sleep(backoff[Math.min(attempt, backoff.length - 1)]);
      }

      throw new FortyGuardTimeoutError(`Activity ${activityId} is still processing after ${maxAttempts} polls`);
    };

    try {
      return await run();
    } catch (err) {
      // Only a genuinely Failed task is safe to resubmit (costs no credits).
      // A timeout means the task may still be running — resubmitting would waste credits.
      if (err instanceof FortyGuardTaskFailedError) {
        return await run();
      }
      throw err;
    }
  }

  async getHeatmap(opts: {
    polygon: Polygon;
    start_date: string;
    /** Required for filter_type 1 (Single Hour, default) and 2 (Range of Hours). Omit for 3 (Single Day) or 4 (Range of Days). */
    start_time?: string;
    end_time?: string;
    end_date?: string;
    filter_type?: FilterType;
    granularity: 60 | 80 | 100;
    /** Default "tcm" (instantaneous temperature). Use "exceedance"/"persistence" for cumulative daily heat exposure. */
    analytic_type?: AnalyticType;
    threshold?: number;
    direction?: "above" | "below";
  }): Promise<HeatmapResult> {
    assertUsPolygon(opts.polygon);
    assertPolygonAreaWithinLimit(opts.polygon);
    assertValidDateTime(opts.start_date, opts.start_time ?? "00:00");

    const filter_type = opts.filter_type ?? 1;
    const key = polygonCacheKey(opts.polygon, {
      start_date: opts.start_date,
      start_time: opts.start_time,
      end_time: opts.end_time,
      end_date: opts.end_date,
      filter_type,
      granularity: opts.granularity,
      analytic_type: opts.analytic_type ?? "tcm",
      threshold: opts.threshold,
      direction: opts.direction,
    });
    const cached = await getCached<HeatmapResult>("heatmap_cache", key);
    if (cached) return cached;

    const body = {
      polygon_aoi: toPolygonAoi(opts.polygon),
      date_time: {
        start_date: opts.start_date,
        filter_type,
        ...(opts.start_time ? { start_time: opts.start_time } : {}),
        ...(opts.end_time ? { end_time: opts.end_time } : {}),
        ...(opts.end_date ? { end_date: opts.end_date } : {}),
      },
      granularity: opts.granularity,
      ...(opts.analytic_type ? { analytic_type: opts.analytic_type } : {}),
      ...(opts.threshold !== undefined ? { threshold: opts.threshold } : {}),
      ...(opts.direction ? { direction: opts.direction } : {}),
    };
    const result = await this.submitAndPoll<HeatmapResult>("/v1/heatmap", body);
    await setCached("heatmap_cache", key, body, result);
    return result;
  }

  async getEnvParams(opts: {
    lat: number;
    lon: number;
    start_date: string;
    start_time: string;
    /** Temperature in Celsius at this point/time — should come from a prior get_heatmap tile. */
    temperatureC: number;
    analysis?: string[];
  }): Promise<EnvParamsResult> {
    assertUsCoordinate(opts.lon, opts.lat);
    assertValidDateTime(opts.start_date, opts.start_time);

    const key = pointCacheKey(opts.lon, opts.lat, {
      start_date: opts.start_date,
      start_time: opts.start_time,
      kind: "env_params",
    });
    const cached = await getCached<EnvParamsResult>("env_params_cache", key);
    if (cached) return cached;

    const body = {
      latitude: opts.lat,
      longitude: opts.lon,
      temperature: opts.temperatureC,
      date_time: { start_date: opts.start_date, start_time: opts.start_time, filter_type: 1 as const },
      ...(opts.analysis ? { analysis: opts.analysis } : {}),
    };
    const result = await this.submitAndPoll<EnvParamsResult>("/v1/env_params", body);
    await setCached("env_params_cache", key, body, result);
    return result;
  }

  /** Premium, PDF-report endpoint — caller should catch and degrade gracefully if unavailable. */
  async getHeatIntelligence(opts: {
    lat: number;
    lon: number;
    date: string;
    /** Temperature in Fahrenheit — should match the heatmap that produced this reading. */
    temperatureF: number;
    analysis: HeatIntelligenceAnalysis[];
  }): Promise<HeatIntelligenceResult> {
    assertUsCoordinate(opts.lon, opts.lat);
    assertValidDateTime(opts.date, "00:00");

    const key = pointCacheKey(opts.lon, opts.lat, {
      date: opts.date,
      analysis: [...opts.analysis].sort(),
      kind: "heat_intelligence",
    });
    const cached = await getCached<HeatIntelligenceResult>("heat_intelligence_cache", key);
    if (cached) return cached;

    const body = {
      latitude: opts.lat,
      longitude: opts.lon,
      temperature: opts.temperatureF,
      date: opts.date,
      analysis: opts.analysis,
    };
    const result = await this.submitAndPoll<HeatIntelligenceResult>("/v1/heat_intelligence", body, {
      backoffMs: HEAT_INTELLIGENCE_BACKOFF_MS,
    });
    await setCached("heat_intelligence_cache", key, body, result);
    return result;
  }

  async getCreditsUsage(): Promise<CreditsUsage> {
    return this.request<CreditsUsage>("POST", "/v1/system/fetch-api-key-usage", {
      request: {},
      api_key: this.apiKey,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
