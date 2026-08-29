import { FortyGuardClient, FortyGuardApiError } from "../fortyguard/client.js";
import { RoutingEngine, RouteResult } from "../routing/routingEngine.js";
import { CITY_CONFIGS, DEFAULT_CITY } from "../graph/cities.js";
import { bboxToPolygon } from "../fortyguard/validation.js";
import { buildTileIndex, celsiusToFahrenheit, exposureHoursAt, EXPOSURE_THRESHOLD_C, temperatureCAt } from "../routing/weighting.js";
import { geocode } from "./geocodingService.js";

export interface ToolContext {
  fortyGuard: FortyGuardClient;
  routingEngine: RoutingEngine;
}

/** Result returned to the Gemini conversation (kept small/summarized to save tokens). */
export interface ToolExecutionOutcome {
  forModel: unknown;
  /** Only set for compute_route — the full result (with route geometry) for the frontend map, not re-sent to Gemini. */
  fullRouteResult?: RouteResult;
}

async function toolGeocode(args: { query: string; city?: string }): Promise<ToolExecutionOutcome> {
  const result = await geocode(args.query, args.city);
  if (!result) {
    return { forModel: { found: false, message: `Could not find "${args.query}".` } };
  }
  return { forModel: { found: true, ...result } };
}

async function toolGetHeatmap(ctx: ToolContext, args: { date: string; time: string }): Promise<ToolExecutionOutcome> {
  const city = CITY_CONFIGS[DEFAULT_CITY];
  const polygon = bboxToPolygon(city.bbox.minLon, city.bbox.minLat, city.bbox.maxLon, city.bbox.maxLat);

  const [tcm, exceedance] = await Promise.all([
    ctx.fortyGuard.getHeatmap({ polygon, start_date: args.date, start_time: args.time, filter_type: 1, granularity: 100 }),
    ctx.fortyGuard.getHeatmap({
      polygon,
      start_date: args.date,
      filter_type: 3,
      granularity: 100,
      analytic_type: "exceedance",
      threshold: EXPOSURE_THRESHOLD_C,
      direction: "above",
    }),
  ]);

  return {
    forModel: {
      city: city.name,
      instantaneousTemperature: tcm.stats_data.temperature_stats
        ? {
            minC: Number(tcm.stats_data.temperature_stats.minimum.toFixed(1)),
            maxC: Number(tcm.stats_data.temperature_stats.maximum.toFixed(1)),
            meanC: Number(tcm.stats_data.temperature_stats.mean.toFixed(1)),
            minF: Number(celsiusToFahrenheit(tcm.stats_data.temperature_stats.minimum).toFixed(1)),
            maxF: Number(celsiusToFahrenheit(tcm.stats_data.temperature_stats.maximum).toFixed(1)),
            meanF: Number(celsiusToFahrenheit(tcm.stats_data.temperature_stats.mean).toFixed(1)),
          }
        : undefined,
      dailyHeatExposureHoursAboveThreshold: {
        thresholdC: EXPOSURE_THRESHOLD_C,
        thresholdF: celsiusToFahrenheit(EXPOSURE_THRESHOLD_C),
        min: Math.min(...exceedance.map_data.features.map((f) => f.properties.value ?? 0)),
        max: Math.max(...exceedance.map_data.features.map((f) => f.properties.value ?? 0)),
      },
      source: "FortyGuard POST /v1/heatmap (analytic_type=tcm and exceedance)",
    },
  };
}

async function toolGetEnvParams(
  ctx: ToolContext,
  args: { lat: number; lon: number; date: string; time: string }
): Promise<ToolExecutionOutcome> {
  const city = CITY_CONFIGS[DEFAULT_CITY];
  const polygon = bboxToPolygon(city.bbox.minLon, city.bbox.minLat, city.bbox.maxLon, city.bbox.maxLat);
  const tcm = await ctx.fortyGuard.getHeatmap({ polygon, start_date: args.date, start_time: args.time, filter_type: 1, granularity: 100 });
  const tempC = temperatureCAt(buildTileIndex(tcm), args.lon, args.lat);
  if (tempC === undefined) {
    return { forModel: { available: false, reason: "No heatmap coverage at this point/time." } };
  }

  const result = await ctx.fortyGuard.getEnvParams({
    lat: args.lat,
    lon: args.lon,
    start_date: args.date,
    start_time: args.time,
    temperatureC: tempC,
  });
  return { forModel: { available: true, source: "FortyGuard POST /v1/env_params", result } };
}

async function toolGetHeatIntelligence(
  ctx: ToolContext,
  args: { lat: number; lon: number; date: string }
): Promise<ToolExecutionOutcome> {
  try {
    const city = CITY_CONFIGS[DEFAULT_CITY];
    const polygon = bboxToPolygon(city.bbox.minLon, city.bbox.minLat, city.bbox.maxLon, city.bbox.maxLat);
    const tcm = await ctx.fortyGuard.getHeatmap({ polygon, start_date: args.date, start_time: "14:00", filter_type: 1, granularity: 100 });
    const tempC = temperatureCAt(buildTileIndex(tcm), args.lon, args.lat);
    if (tempC === undefined) {
      return { forModel: { available: false, reason: "No heatmap coverage at this point." } };
    }

    const result = await ctx.fortyGuard.getHeatIntelligence({
      lat: args.lat,
      lon: args.lon,
      date: args.date,
      temperatureF: celsiusToFahrenheit(tempC),
      analysis: ["environmental", "urban"],
    });
    // FortyGuard returns a temporary signed URL that embeds our API key — their docs say never
    // share it, so we never send it to the model/browser. We only confirm the report generated.
    return {
      forModel: {
        available: true,
        source: "FortyGuard POST /v1/heat_intelligence",
        reportGenerated: Boolean(result.download_link),
        note: "The full Heat Intelligence PDF (geographic, environmental, urban, events, anthropogenic analysis) was generated successfully. Do not fabricate a download URL — tell the user the report is ready and summarize the heat conditions from the heatmap/env data instead.",
      },
    };
  } catch (err) {
    // Premium/slow endpoint — degrade gracefully per plan §3, never block the agent turn.
    const reason = err instanceof FortyGuardApiError ? err.message : "Heat Intelligence is temporarily unavailable.";
    return { forModel: { available: false, reason } };
  }
}

async function toolComputeRoute(
  ctx: ToolContext,
  args: {
    origin_lat: number;
    origin_lon: number;
    destination_lat: number;
    destination_lon: number;
    date: string;
    time: string;
    beta?: number;
  }
): Promise<ToolExecutionOutcome> {
  const result = await ctx.routingEngine.computeRoute({
    origin: { lat: args.origin_lat, lon: args.origin_lon },
    destination: { lat: args.destination_lat, lon: args.destination_lon },
    date: args.date,
    time: args.time,
    beta: args.beta,
  });

  const fToC = (f: number) => Number((((f - 32) * 5) / 9).toFixed(1));

  const forModel = {
    city: result.city,
    shortest: {
      distance_m: Math.round(result.shortest.distance_m),
      duration_min: Math.round(result.shortest.duration_s / 60),
      avgTemperatureF: Number(result.shortest.avgTemperatureF.toFixed(1)),
      avgTemperatureC: fToC(result.shortest.avgTemperatureF),
      dailyHeatExposureHours: Number(result.shortest.avgExposureHours.toFixed(2)),
    },
    heatOptimized: {
      distance_m: Math.round(result.heatOptimized.distance_m),
      duration_min: Math.round(result.heatOptimized.duration_s / 60),
      avgTemperatureF: Number(result.heatOptimized.avgTemperatureF.toFixed(1)),
      avgTemperatureC: fToC(result.heatOptimized.avgTemperatureF),
      dailyHeatExposureHours: Number(result.heatOptimized.avgExposureHours.toFixed(2)),
      hottestPoint: result.heatOptimized.hottestPoint,
    },
    extraDistance_m: Math.round(result.extraDistance_m),
    extraDuration_min: Math.round(result.extraDuration_s / 60),
    exposureReductionHours: Number(result.exposureReductionHours.toFixed(2)),
    source: "FortyGuard POST /v1/heatmap (tcm + exceedance) + CoolPath A* routing engine",
  };

  return { forModel, fullRouteResult: result };
}

async function toolCheckCredits(ctx: ToolContext): Promise<ToolExecutionOutcome> {
  const usage = await ctx.fortyGuard.getCreditsUsage();
  return {
    forModel: {
      planType: usage.plan_details.plan_type,
      creditsRemaining: usage.credit_summary.cycle_remaining_credits,
      creditsUsedThisCycle: usage.credit_summary.cycle_credits_used,
      usagePercent: usage.credit_summary.cycle_usage_percentage,
      resetsOn: usage.plan_details.credits_reset_date,
    },
  };
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolExecutionOutcome> {
  switch (name) {
    case "geocode":
      return toolGeocode(args as { query: string; city?: string });
    case "get_heatmap":
      return toolGetHeatmap(ctx, args as { date: string; time: string });
    case "get_env_params":
      return toolGetEnvParams(ctx, args as { lat: number; lon: number; date: string; time: string });
    case "get_heat_intelligence":
      return toolGetHeatIntelligence(ctx, args as { lat: number; lon: number; date: string });
    case "compute_route":
      return toolComputeRoute(
        ctx,
        args as {
          origin_lat: number;
          origin_lon: number;
          destination_lat: number;
          destination_lon: number;
          date: string;
          time: string;
          beta?: number;
        }
      );
    case "check_credits":
      return toolCheckCredits(ctx);
    default:
      return { forModel: { error: `Unknown tool: ${name}` } };
  }
}
