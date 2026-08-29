import "dotenv/config";
import { FortyGuardClient } from "./client.js";
import { bboxToPolygon } from "./validation.js";

// Tiny polygon over downtown Phoenix, AZ — pilot city, well inside US coverage.
const polygon = bboxToPolygon(-112.078, 33.448, -112.068, 33.458);

async function main() {
  const client = new FortyGuardClient();

  const today = new Date();
  const start_date = today.toISOString().slice(0, 10);
  const start_time = "14:00";

  console.log(`Submitting heatmap request for ${start_date} ${start_time}...`);
  const result = await client.getHeatmap({
    polygon,
    start_date,
    start_time,
    granularity: 100,
  });

  console.log("stats_data:", JSON.stringify(result.stats_data, null, 2).slice(0, 1500));
  const features = result.map_data.features ?? [];
  console.log(`map_data has ${features.length} tile features. First 5 (°C -> °F):`);
  for (const f of features.slice(0, 5)) {
    const c = f.properties.average_temperature;
    if (c === undefined) continue;
    const fahrenheit = (c * 9) / 5 + 32;
    console.log(`  tile ${f.properties.tile_id}: ${c.toFixed(1)}°C / ${fahrenheit.toFixed(1)}°F`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Heatmap test failed:", err);
    process.exit(1);
  });
