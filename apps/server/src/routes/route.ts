import { Router } from "express";
import { FortyGuardClient, FortyGuardApiError } from "../fortyguard/client.js";
import { FortyGuardValidationError } from "../fortyguard/validation.js";
import { RoutingEngine } from "../routing/routingEngine.js";

export const routeRouter = Router();
const fortyGuard = new FortyGuardClient();
const routingEngine = new RoutingEngine(fortyGuard);

routeRouter.post("/", async (req, res) => {
  const { origin, destination, date, time, beta, comfortHours, citySlug } = req.body ?? {};

  if (!origin?.lat || !origin?.lon || !destination?.lat || !destination?.lon || !date || !time) {
    res.status(400).json({ error: "origin, destination, date, and time are required." });
    return;
  }

  try {
    const result = await routingEngine.computeRoute({
      origin,
      destination,
      date,
      time,
      beta,
      comfortHours,
      citySlug,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof FortyGuardValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof FortyGuardApiError) {
      // Graceful degradation: FortyGuard is unavailable — never show a blank screen.
      res.status(502).json({
        error: "Heat data is temporarily unavailable. Try again shortly, or request the shortest route only.",
        detail: err.message,
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Unexpected error computing route.", detail: (err as Error).message });
  }
});
