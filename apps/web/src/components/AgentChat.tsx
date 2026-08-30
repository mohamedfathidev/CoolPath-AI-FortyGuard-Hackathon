import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { streamAgent, RouteResultData } from "../api";

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

interface TraceItem {
  tool: string;
  status: "running" | "ok" | "error";
}

const TOOL_LABELS: Record<string, string> = {
  geocode: "Geocoding location (OSM Nominatim)",
  get_heatmap: "Fetching heatmap overview (FortyGuard POST /v1/heatmap)",
  get_env_params: "Fetching environmental conditions (FortyGuard POST /v1/env_params)",
  get_heat_intelligence: "Fetching heat intelligence report (FortyGuard POST /v1/heat_intelligence)",
  compute_route: "Computing routes (FortyGuard POST /v1/heatmap + CoolPath A*)",
  check_credits: "Checking FortyGuard credits (POST /v1/system/fetch-api-key-usage)",
};

// The first prompt uses a pair verified (by real API calls) to produce a genuinely different
// heat-optimized route — most pairs come back identical when no cooler detour exists, which is
// honest data behavior. This one reliably diverges (~26m extra for ~0.18 fewer heat-hours/day).
const EXAMPLE_PROMPTS = [
  "Walk from Encanto Park to St Gregory Parish Hall at 2pm on July 20th 2025 — find me the coolest route and explain why it's cooler.",
  "Give me a detailed heat intelligence report for Encanto Park on July 15th 2024.",
];

interface AgentChatProps {
  onRouteResult: (result: RouteResultData) => void;
}

export default function AgentChat({ onRouteResult }: AgentChatProps) {
  const [message, setMessage] = useState("");
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runMessage(text: string) {
    if (!text.trim() || running) return;
    setRunning(true);
    setTrace([]);
    setAnswer(null);
    setModel(null);
    setError(null);

    try {
      await streamAgent(text, (event) => {
        if (event.type === "tool_start") {
          setTrace((t) => [...t, { tool: event.tool, status: "running" }]);
        } else if (event.type === "tool_complete") {
          setTrace((t) => {
            const next = [...t];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].tool === event.tool && next[i].status === "running") {
                next[i] = { tool: event.tool, status: event.ok ? "ok" : "error" };
                break;
              }
            }
            return next;
          });
        } else if (event.type === "route_result") {
          onRouteResult(event.result);
        } else if (event.type === "model") {
          setModel(event.model);
        } else if (event.type === "final") {
          setAnswer(event.answer);
          setModel(event.model);
        } else if (event.type === "error") {
          setError(event.message);
        }
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="agent-chat">
      <div className="example-chips">
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button
            type="button"
            key={i}
            className="chip"
            disabled={running}
            onClick={() => {
              setMessage(p);
              runMessage(p);
            }}
          >
            {p.length > 60 ? p.slice(0, 57) + "…" : p}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runMessage(message);
        }}
      >
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="e.g. Walk from Encanto Park to Sprouts Farmers Market at 5pm — keep me cool and tell me why."
        />
        <button type="submit" disabled={running || !message.trim()}>
          {running ? "Thinking…" : "Ask agent"}
        </button>
      </form>

      {trace.length > 0 && (
        <ul className="tool-trace">
          {trace.map((item, i) => (
            <li key={i} className={item.status}>
              {item.status === "running" ? "⏳" : item.status === "ok" ? "✓" : "✗"} {TOOL_LABELS[item.tool] ?? item.tool}
            </li>
          ))}
        </ul>
      )}

      {(running || answer) && model && (
        <div className="model-badge">
          <span className="model-dot" /> Answered by <strong>{model}</strong>
        </div>
      )}
      {answer && <div className="agent-answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }} />}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
