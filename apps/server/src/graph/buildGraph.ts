import path from "node:path";
import { fetchAndSaveOsmGraph } from "./osmLoader.js";
import { CITY_CONFIGS, DEFAULT_CITY } from "./cities.js";

const city = CITY_CONFIGS[DEFAULT_CITY];
const outPath = path.resolve(process.cwd(), "..", "..", "data", "cities", city.slug, "graph.geojson");

async function main() {
  console.log(`Fetching OSM walking graph for ${city.name}...`);
  const graph = await fetchAndSaveOsmGraph(city.bbox, outPath);
  console.log(`Saved ${graph.features.length} edges to ${outPath}`);
}

main().catch((err) => {
  console.error("Graph build failed:", err);
  process.exit(1);
});
