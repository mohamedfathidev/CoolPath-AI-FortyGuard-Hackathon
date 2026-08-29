CREATE TABLE IF NOT EXISTS heatmap_cache (
  cache_key TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS env_params_cache (
  cache_key TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS heat_intelligence_cache (
  cache_key TEXT PRIMARY KEY,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_edges (
  city_slug TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  distance_m DOUBLE PRECISION NOT NULL,
  geometry_json TEXT NOT NULL,
  PRIMARY KEY (city_slug, edge_id)
);

CREATE TABLE IF NOT EXISTS route_requests (
  id SERIAL PRIMARY KEY,
  origin_json TEXT NOT NULL,
  destination_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  beta DOUBLE PRECISION NOT NULL,
  result_json TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id SERIAL PRIMARY KEY,
  brief TEXT NOT NULL,
  tool_trace_json TEXT,
  final_answer TEXT,
  created_at BIGINT NOT NULL
);
