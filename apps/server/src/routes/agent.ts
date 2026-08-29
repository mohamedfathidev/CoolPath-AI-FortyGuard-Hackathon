import { Router } from "express";
import { FortyGuardClient } from "../fortyguard/client.js";
import { RoutingEngine } from "../routing/routingEngine.js";
import { runAgent } from "../agent/orchestrator.js";

export const agentRouter = Router();
const fortyGuard = new FortyGuardClient();
const routingEngine = new RoutingEngine(fortyGuard);

agentRouter.post("/", async (req, res) => {
  const { message } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message (string) is required." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await runAgent(message, { fortyGuard, routingEngine }, send);
  } catch (err) {
    send({ type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});
