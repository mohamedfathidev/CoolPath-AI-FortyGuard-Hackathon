export type LonLat = [number, number];

export interface Polygon {
  type: "Polygon";
  coordinates: LonLat[][];
}

export interface PolygonAoi {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: Polygon;
  }>;
}

/** filter_type: 1=Single Hour, 2=Range of Hours (same day), 3=Single Day, 4=Range of Days (heatmap only, <=1 month) */
export type FilterType = 1 | 2 | 3 | 4;

export interface DateTimeFilter {
  start_date: string;
  filter_type: FilterType;
  start_time?: string;
  end_time?: string;
  end_date?: string;
}

export type AnalyticType = "tcm" | "time_of_measure" | "exceedance" | "persistence";

export interface HeatmapRequest {
  polygon_aoi: PolygonAoi;
  date_time: DateTimeFilter;
  granularity: 60 | 80 | 100;
  analytic_type?: AnalyticType;
  threshold?: number;
  direction?: "above" | "below";
}

export interface SubmitResponse {
  error: boolean;
  status_code: number;
  message: string;
  data: { activity_id: string };
}

export type ActivityStatus = "Processing" | "Completed" | "Failed";

export interface StatusResponse<T = unknown> {
  error: boolean;
  status_code: number;
  message: string;
  data: {
    activity_id: string;
    status: ActivityStatus;
    result?: T;
  };
}

export interface HeatmapTileStats {
  minimum: number;
  maximum: number;
  mean: number;
  standard_deviation: number;
  [key: string]: unknown;
}

export interface HeatmapTileFeature {
  id: string;
  type: "Feature";
  properties: {
    tile_id: number;
    /** Present when analytic_type is "tcm" (the default). Degrees Celsius. */
    average_temperature?: number;
    min_temperature?: number;
    max_temperature?: number;
    /** Present when analytic_type is exceedance/persistence/time_of_measure. Hours (or hour-of-day for time_of_measure). */
    value?: number;
    [key: string]: unknown;
  };
  geometry: Polygon;
}

export interface HeatmapResult {
  map_data: { type: "FeatureCollection"; features: HeatmapTileFeature[] };
  stats_data: {
    temperature_stats?: HeatmapTileStats;
    overall_temperature_distribution?: number[];
    [key: string]: unknown;
  };
}

export interface EnvParamsRequest {
  latitude: number;
  longitude: number;
  /** Temperature in Celsius — should match the heatmap tile for this location/time. */
  temperature: number;
  date_time: DateTimeFilter;
  analysis?: string[];
}

export interface EnvParamsResult {
  metadata: {
    timezone: string;
    timezone_offset_hours: number;
    time_range: { start: string; end: string; interval: string; count: number };
    timestamps: string[];
  };
  locations: Array<{
    lat: number;
    lon: number;
    elevation?: number;
    temperature: number;
    parameters: Record<string, Array<number | null>>;
    solar_irradiance?: Record<string, unknown>;
  }>;
}

export type HeatIntelligenceAnalysis =
  | "geographic"
  | "environmental"
  | "urban"
  | "events"
  | "anthropogenic";

export interface HeatIntelligenceRequest {
  latitude: number;
  longitude: number;
  /** Temperature in Fahrenheit — should match the heatmap that produced this reading. */
  temperature: number;
  date: string;
  analysis: HeatIntelligenceAnalysis[];
}

export interface HeatIntelligenceResult {
  download_link: string;
}

export interface CreditsUsage {
  api_key: string | null;
  subscription_id: string;
  plan_details: {
    plan_type: string;
    cycle_type: string;
    subscription_start_date: string;
    billing_period: string;
    active: boolean;
    credits_reset_date: string;
  };
  api_key_details: {
    status: string;
    valid: boolean;
    expiry_date: string;
    api_access_available: boolean;
  };
  credit_summary: {
    total_available_credits: number;
    cycle_credits_used: number;
    cycle_remaining_credits: number;
    cycle_usage_percentage: number;
    total_credits_used: number;
    total_remaining_credits: number;
  };
  [key: string]: unknown;
}
