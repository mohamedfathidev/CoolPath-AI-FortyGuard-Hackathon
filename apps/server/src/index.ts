import "dotenv/config";
import cors from "cors";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { creditsRouter } from "./routes/credits.js";
import { routeRouter } from "./routes/route.js";
import { agentRouter } from "./routes/agent.js";
import { geocodeRouter } from "./routes/geocode.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/credits", creditsRouter);
app.use("/api/route", routeRouter);
app.use("/api/agent", agentRouter);
app.use("/api/geocode", geocodeRouter);

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`CoolPath server listening on http://localhost:${port}`);
});
