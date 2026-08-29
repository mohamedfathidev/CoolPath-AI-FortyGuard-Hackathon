import type { FunctionDeclaration } from "@google/genai";

// Adaptations from the original tool sketch, made after inspecting FortyGuard's real API:
// - get_heatmap takes no polygon: the agent is scoped to one fixed pilot-city bbox (see
//   graph/cities.ts), so there's nothing for the model to specify, and letting an LLM emit
//   raw polygon coordinates is error-prone and can waste a real FortyGuard credit on a bad shape.
// - get_env_params / get_heat_intelligence take no temperature param even though FortyGuard's
//   API requires one — the implementation looks it up from a heatmap tile automatically so the
//   model doesn't have to coordinate two calls just to satisfy an API quirk.
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "geocode",
    description:
      "Resolve a place name or address (e.g. 'Encanto Park', 'Central Ave and McDowell Rd') into latitude/longitude, biased to the pilot city.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Place name or address to look up." },
        city: { type: "string", description: "Optional city/state hint, e.g. 'Phoenix, AZ'." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_heatmap",
    description:
      "Get a summary of current FortyGuard heat data (instantaneous temperature range and cumulative daily heat-exposure-hours range) across the pilot city area for a given date/time. Useful for answering general 'how hot is it' questions before computing a specific route.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, between 2019-01-01 and 12 hours from now." },
        time: { type: "string", description: "HH:MM 24-hour time." },
      },
      required: ["date", "time"],
    },
  },
  {
    name: "get_env_params",
    description:
      "Get detailed environmental conditions (heat index, humidity, air quality, etc.) at a specific point and time. Use for a route waypoint or the hottest segment of a route.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM 24-hour time." },
      },
      required: ["lat", "lon", "date", "time"],
    },
  },
  {
    name: "get_heat_intelligence",
    description:
      "Get an in-depth FortyGuard Heat Intelligence report (geographic/environmental/urban/events/anthropogenic analysis) for a specific point. Premium and can take a couple of minutes; may be unavailable — treat that as normal and continue without it.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["lat", "lon", "date"],
    },
  },
  {
    name: "compute_route",
    description:
      "Compute both the shortest walking route and a heat-optimized walking route between two points, with distance/time/heat-exposure deltas and the hottest segment. This is the main routing tool.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        origin_lat: { type: "number" },
        origin_lon: { type: "number" },
        destination_lat: { type: "number" },
        destination_lon: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM 24-hour time." },
        beta: {
          type: "number",
          description: "How aggressively to avoid heat exposure (higher = more willing to detour). Omit to use the default.",
        },
      },
      required: ["origin_lat", "origin_lon", "destination_lat", "destination_lon", "date", "time"],
    },
  },
  {
    name: "check_credits",
    description: "Check remaining FortyGuard API credits for this key. Call before a burst of expensive operations if unsure.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
];
