import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let poolInstance: Pool | undefined;
let initialized: Promise<void> | undefined;

/** Lazily created so importing this module doesn't crash before DATABASE_URL is configured. */
export function getPool(): Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (expected a Postgres connection string, e.g. from Neon)");
    }
    poolInstance = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return poolInstance;
}

export function ensureSchema(): Promise<void> {
  if (!initialized) {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
    initialized = getPool()
      .query(schema)
      .then(() => undefined);
  }
  return initialized;
}
