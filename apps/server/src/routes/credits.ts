import { Router } from "express";
import { FortyGuardClient } from "../fortyguard/client.js";

export const creditsRouter = Router();
const client = new FortyGuardClient();

creditsRouter.get("/", async (_req, res) => {
  try {
    const usage = await client.getCreditsUsage();
    res.json(usage);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
