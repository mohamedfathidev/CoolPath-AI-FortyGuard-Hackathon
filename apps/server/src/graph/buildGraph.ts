import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAndSaveOsmGraph } from "./osmLoader.js";
import { CITY_CONFIGS, DEFAULT_CITY } from "./cities.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const city = CITY_CONFIGS[DEFAULT_CITY];
// apps/server/data — inside the deploy root so Railway ships it (see graphStore.ts).
const outPath = path.resolve(moduleDir, "..", "..", "data", "cities", city.slug, "graph.geojson");

async function main() {
  console.log(`Fetching OSM walking graph for ${city.name}...`);
  const graph = await fetchAndSaveOsmGraph(city.bbox, outPath);
  console.log(`Saved ${graph.features.length} edges to ${outPath}`);
}

main().catch((err) => {
  console.error("Graph build failed:", err);
  process.exit(1);
});
