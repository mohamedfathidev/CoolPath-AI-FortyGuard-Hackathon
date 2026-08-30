# CoolPath AI

A heat-aware walking route planner for Phoenix, AZ — built on [FortyGuard](https://fortyguard.com)'s
temperature intelligence API for the FortyGuard Hackathon '26 (Track 1 · Resilient Cities +
Track 6 · Agentic crossover).

Two ways in:

1. **Plan a route** — pick an origin and destination, a date/time, and get the shortest walking
   route vs. a heat-optimized route side by side, with distance/time/heat-exposure deltas on a map.
2. **Ask the agent** — a plain-language brief ("walk from X to Y at 2pm, keep me cool, tell me why
   the bad blocks are bad") drives an LLM tool-calling agent that geocodes, pulls FortyGuard heat
   data, computes the route, and returns a source-cited explanation.

## How it works

```
Browser (React + Vite + MapLibre GL)
   │  REST + SSE
   ▼
Express server (TypeScript)
   ├─ /api/route    → A* routing over an OSM street graph, edges weighted by heat exposure
   ├─ /api/agent    → LLM agent (Gemini, NVIDIA Nemotron fallback) with 6 tools, streams its trace
   ├─ /api/geocode  → place search/autocomplete (Nominatim + Photon)
   ├─ /api/credits  → FortyGuard credit usage
   │
   ├─ FortyGuardClient — submit/poll async pattern, retry, U.S./date validation, Postgres caching
   └─ Postgres (Neon) — caches every FortyGuard result so repeat queries are free and instant
```

### FortyGuard endpoints used

| Endpoint | Used for |
|---|---|
| `POST /v1/heatmap` (`analytic_type=tcm`) | Instantaneous temperature for display |
| `POST /v1/heatmap` (`analytic_type=exceedance`) | Daily heat-exposure hours — the signal that actually weights routes |
| `POST /v1/env_params` | Heat index, humidity, air quality at a route's hottest point |
| `POST /v1/heat_intelligence` | Optional deep-dive PDF report (agent tool) |
| `GET /v1/status/{activity_id}` | Polling the async jobs above |
| `POST /v1/system/fetch-api-key-usage` | Credit usage readout |

**Why exposure-hours, not instantaneous temperature:** live FortyGuard data showed the
instantaneous temperature is nearly uniform (~0.5°F) block-to-block across this compact pilot
area, so it can't meaningfully distinguish routes. Cumulative daily heat exposure
(hours/day above 95°F) has real spatial spread (~1–3 hrs), so that's what drives the
heat-optimized route. The route weighting is `distance_m × (1 + β × max(0, exposure_hrs − comfort_hrs))`.

## Integration API

CoolPath's heat-aware routing isn't just a UI — it's a plain REST endpoint any delivery,
mobility, or logistics app can call to get the **coolest viable route**, not just the shortest.
Send two points and a time; get both routes plus the heat trade-off as JSON.

### `POST /api/route`

Request:

```json
{
  "origin":      { "lat": 33.4725, "lon": -112.0901 },
  "destination": { "lat": 33.4889, "lon": -112.0981 },
  "date": "2025-07-20",
  "time": "14:00",
  "beta": 0.5
}
```

Response (trimmed):

```json
{
  "city": "Phoenix, AZ (Encanto Park area)",
  "shortest":      { "distance_m": 2667, "duration_s": 1905, "avgTemperatureF": 98.5, "avgExposureHours": 12.6 },
  "heatOptimized": { "distance_m": 2691, "duration_s": 1922, "avgTemperatureF": 98.5, "avgExposureHours": 12.5,
                     "coordinates": [[-112.0901, 33.4725], "…"] },
  "extraDistance_m": 24,
  "extraDuration_s": 17,
  "exposureReductionHours": 0.15
}
```

`coordinates` on each route is a `[lon, lat]` polyline ready to drop onto a map. `exposureReductionHours`
is the concrete benefit: how many fewer hours/day of extreme-heat exposure the cooler route buys.

### Example clients

```js
// JavaScript — e.g. inside a delivery app's routing step
const res = await fetch("https://coolpath-ai-fortyguard-hackathon-production.up.railway.app/api/route", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    origin: { lat: 33.4725, lon: -112.0901 },
    destination: { lat: 33.4889, lon: -112.0981 },
    date: "2025-07-20", time: "14:00",
  }),
});
const { heatOptimized, exposureReductionHours } = await res.json();
console.log(`Cooler route saves ${exposureReductionHours} hrs/day of extreme heat`);
```

```python
# Python
import requests
r = requests.post("https://coolpath-ai-fortyguard-hackathon-production.up.railway.app/api/route", json={
    "origin": {"lat": 33.4725, "lon": -112.0901},
    "destination": {"lat": 33.4889, "lon": -112.0981},
    "date": "2025-07-20", "time": "14:00",
})
route = r.json()
print("cooler route:", route["heatOptimized"]["coordinates"])
```

### Other endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/route` | Shortest vs. heat-optimized walking route + deltas |
| `POST /api/agent` | Natural-language agent (SSE stream of tool calls + answer) |
| `GET /api/heat-islands?date=YYYY-MM-DD` | City-wide heat-island map (per-tile exposure hours, hotspots, insight) |
| `GET /api/geocode?q=` · `/api/geocode/autocomplete?q=` | Place lookup |
| `GET /api/credits` · `GET /api/health` | FortyGuard credit usage · health check |

**Roadmap:** publish a versioned `@coolpath/client` SDK, add API-key auth + rate limiting, and
expand beyond the Phoenix pilot to any FortyGuard-covered U.S. city — turning this into a
drop-in heat-aware routing service for third-party fleets.

## Local development

Prerequisites: Node 20+, a Postgres connection string (free from [Neon](https://neon.tech)),
a FortyGuard API key, and a [Gemini API key](https://ai.google.dev) (optionally an NVIDIA NIM key
for fallback).

```bash
# 1. Backend
cd apps/server
cp .env.example .env      # fill in FORTYGUARD_API_KEY, GEMINI_API_KEY, DATABASE_URL
npm install
npm run build:graph       # one-time: pulls the OSM walking graph for the pilot area
npm run dev               # http://localhost:8787

# 2. Frontend (separate terminal)
cd apps/web
npm install
npm run dev               # http://localhost:5173  (proxies /api to the backend)
```

## Deployment (all free tier)

**Live backend:** https://coolpath-ai-fortyguard-hackathon-production.up.railway.app

- **Database** — Neon (free, no card).
- **Backend** — Railway free web service. Push this repo to GitHub, then Railway → New →
  deploy from the repo. Set **Root Directory** to `apps/server`, build `npm install`,
  start `npm start`, and add the env vars (`FORTYGUARD_API_KEY`, `GEMINI_API_KEY`,
  `NVIDIA_API_KEY`, `DATABASE_URL`) — `PORT` is injected automatically. Note: free instances
  sleep after inactivity — the first request after idle takes ~30–50s, so ping `/api/health`
  a few minutes before demoing to warm it up.
- **Frontend** — Vercel. Set the project **Root Directory** to `apps/web`, and set the
  `VITE_API_BASE` environment variable to the Railway backend URL
  (`https://coolpath-ai-fortyguard-hackathon-production.up.railway.app`).

## Notes

- All API keys live server-side only and are never exposed to the browser (a FortyGuard Terms
  requirement).
- On some date/route-pair combinations the shortest and heat-optimized routes are identical —
  that's honest data-driven behavior when no cooler detour exists, not a bug. The default
  origin/destination/date is chosen to show a genuine divergence.
