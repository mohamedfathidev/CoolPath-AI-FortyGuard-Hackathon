import { Router } from "express";
import { autocompleteSearch, geocode } from "../agent/geocodingService.js";

export const geocodeRouter = Router();

geocodeRouter.get("/", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "q (string) query param is required." });
    return;
  }
  try {
    const result = await geocode(q);
    if (!result) {
      res.status(404).json({ error: `Could not find "${q}".` });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

geocodeRouter.get("/autocomplete", async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    res.json([]);
    return;
  }
  try {
    const results = await autocompleteSearch(q);
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
