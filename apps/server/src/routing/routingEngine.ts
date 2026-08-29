import { FortyGuardClient } from "../fortyguard/client.js";
import { loadStreetGraph, nearestNode } from "../graph/graphStore.js";
import { CITY_CONFIGS, DEFAULT_CITY } from "../graph/cities.js";
import { bboxToPolygon } from "../fortyguard/validation.js";
import { astar } from "./astar.js";
import {
  buildTileIndex,
  celsiusToFahrenheit,
  DEFAULT_BETA_EXPOSURE,
  DEFAULT_COMFORT_F,
  DEFAULT_COMFORT_HOURS,
  EXPOSURE_THRESHOLD_C,
  exposureHoursAt,
  heatWeightedCost,
  temperatureCAt,
  TileIndex,
} from "./weighting.js";

// Average unencumbered walking speed.
const WALKING_SPEED_MPS = 1.4;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteRequest {
  origin: LatLon;
  destination: LatLon;
  date: string;
  time: string;
  /** Weights exposure-hours (not instant degF) — see weighting.ts for why. */
  beta?: number;
  comfortHours?: number;
  citySlug?: string;
}

export interface RoutePath {
  coordinates: [number, number][];
  distance_m: number;
  duration_s: number;
  avgTemperatureF: number;
  maxTemperatureF: number;
  /** Hours/day this path's segments spend above EXPOSURE_THRESHOLD_C, distance-weighted average. */
  avgExposureHours: number;
  maxExposureHours: number;
  hottestPoint?: { lon: number; lat: number; temperatureF: number };
}

export interface RouteResult {
  city: string;
  shortest: RoutePath;
  heatOptimized: RoutePath;
  extraDistance_m: number;
  extraDuration_s: number;
  temperatureReductionF: number;
  exposureReductionHours: number;
}

export class RoutingEngine {
  constructor(private fortyGuard: FortyGuardClient) {}

  async computeRoute(req: RouteRequest): Promise<RouteResult> {
    const citySlug = req.citySlug ?? DEFAULT_CITY;
    const city = CITY_CONFIGS[citySlug];
    if (!city) throw new Error(`Unknown city: ${citySlug}`);

    // A geocoded point can legitimately resolve outside our pilot bbox (a real place,
    // just not one our graph/heatmap cover) — nearestNode has no bounds check and would
    // silently snap to whatever's closest, however far away. Catch that here instead.
    for (const [label, point] of [["origin", req.origin], ["destination", req.destination]] as const) {
      const margin = 0.01; // ~1km
      const { minLat, minLon, maxLat, maxLon } = city.bbox;
      if (
        point.lat < minLat - margin ||
        point.lat > maxLat + margin ||
        point.lon < minLon - margin ||
        point.lon > maxLon + margin
      ) {
        throw new Error(
          `The ${label} (${point.lat}, ${point.lon}) is outside the supported area for ${city.name}. ` +
            `This pilot only covers a small area around Encanto Park.`
        );
      }
    }

    const graph = loadStreetGraph(citySlug);
    const origin = nearestNode(graph, req.origin.lon, req.origin.lat);
    const destination = nearestNode(graph, req.destination.lon, req.destination.lat);

    const polygon = bboxToPolygon(city.bbox.minLon, city.bbox.minLat, city.bbox.maxLon, city.bbox.maxLat);

    // Instant temperature (for user-facing degF display) and cumulative daily
    // heat exposure (for actual route weighting — see weighting.ts) are two
    // separate FortyGuard requests; both cache independently.
    const [tcmHeatmap, exceedanceHeatmap] = await Promise.all([
      this.fortyGuard.getHeatmap({
        polygon,
        start_date: req.date,
        start_time: req.time,
        filter_type: 1,
        granularity: 100,
      }),
      this.fortyGuard.getHeatmap({
        polygon,
        start_date: req.date,
        filter_type: 3,
        granularity: 100,
        analytic_type: "exceedance",
        threshold: EXPOSURE_THRESHOLD_C,
        direction: "above",
      }),
    ]);
    const tempIndex = buildTileIndex(tcmHeatmap);
    const exposureIndex = buildTileIndex(exceedanceHeatmap);

    const beta = req.beta ?? DEFAULT_BETA_EXPOSURE;
    const comfortHours = req.comfortHours ?? DEFAULT_COMFORT_HOURS;

    const shortestResult = astar(graph, origin.nodeId, destination.nodeId, (distance_m) => distance_m);
    if (!shortestResult) {
      throw new Error("No walking route found between origin and destination in this city's graph.");
    }

    const heatResult = astar(graph, origin.nodeId, destination.nodeId, (distance_m, midLon, midLat) => {
      const exposureHours = exposureHoursAt(exposureIndex, midLon, midLat);
      return heatWeightedCost(distance_m, exposureHours, beta, comfortHours);
    });
    if (!heatResult) {
      throw new Error("No heat-optimized walking route found between origin and destination.");
    }

    const shortest = this.buildRoutePath(graph, shortestResult.nodeIds, tempIndex, exposureIndex);
    const heatOptimized = this.buildRoutePath(graph, heatResult.nodeIds, tempIndex, exposureIndex);

    return {
      city: city.name,
      shortest,
      heatOptimized,
      extraDistance_m: heatOptimized.distance_m - shortest.distance_m,
      extraDuration_s: heatOptimized.duration_s - shortest.duration_s,
      temperatureReductionF: shortest.avgTemperatureF - heatOptimized.avgTemperatureF,
      exposureReductionHours: shortest.avgExposureHours - heatOptimized.avgExposureHours,
    };
  }

  private buildRoutePath(
    graph: ReturnType<typeof loadStreetGraph>,
    nodeIds: number[],
    tempIndex: TileIndex,
    exposureIndex: TileIndex
  ): RoutePath {
    const coordinates: [number, number][] = [];
    let distance_m = 0;
    let weightedTempSum = 0;
    let weightedExposureSum = 0;
    let maxTemperatureF = -Infinity;
    let maxExposureHours = -Infinity;
    let hottestPoint: RoutePath["hottestPoint"];

    for (let i = 0; i < nodeIds.length; i++) {
      const coord = graph.nodeCoords.get(nodeIds[i])!;
      coordinates.push([coord.lon, coord.lat]);

      if (i > 0) {
        const prev = graph.nodeCoords.get(nodeIds[i - 1])!;
        const edge = (graph.adjacency.get(nodeIds[i - 1]) ?? []).find((e) => e.to === nodeIds[i]);
        const segDist = edge?.distance_m ?? 0;
        const midLon = (prev.lon + coord.lon) / 2;
        const midLat = (prev.lat + coord.lat) / 2;

        const tempC = temperatureCAt(tempIndex, midLon, midLat);
        const tempF = tempC !== undefined ? celsiusToFahrenheit(tempC) : DEFAULT_COMFORT_F;
        const exposureHours = exposureHoursAt(exposureIndex, midLon, midLat) ?? 0;

        distance_m += segDist;
        weightedTempSum += tempF * segDist;
        weightedExposureSum += exposureHours * segDist;
        if (tempF > maxTemperatureF) {
          maxTemperatureF = tempF;
          hottestPoint = { lon: midLon, lat: midLat, temperatureF: tempF };
        }
        if (exposureHours > maxExposureHours) maxExposureHours = exposureHours;
      }
    }

    const avgTemperatureF = distance_m > 0 ? weightedTempSum / distance_m : 0;
    const avgExposureHours = distance_m > 0 ? weightedExposureSum / distance_m : 0;

    return {
      coordinates,
      distance_m,
      duration_s: distance_m / WALKING_SPEED_MPS,
      avgTemperatureF,
      maxTemperatureF: maxTemperatureF === -Infinity ? avgTemperatureF : maxTemperatureF,
      avgExposureHours,
      maxExposureHours: maxExposureHours === -Infinity ? avgExposureHours : maxExposureHours,
      hottestPoint,
    };
  }
}
