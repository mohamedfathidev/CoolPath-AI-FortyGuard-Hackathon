import { Router } from "express";
import { FortyGuardClient, FortyGuardApiError } from "../fortyguard/client.js";
import { FortyGuardValidationError } from "../fortyguard/validation.js";
import { getHeatIslands } from "../routing/heatIslands.js";

export const heatIslandsRouter = Router();
const fortyGuard = new FortyGuardClient();

heatIslandsRouter.get("/", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
  try {
    const result = await getHeatIslands(fortyGuard, date);
    res.json(result);
  } catch (err) {
    if (err instanceof FortyGuardValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof FortyGuardApiError) {
      res.status(502).json({ error: "Heat data is temporarily unavailable. Try again shortly." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});
