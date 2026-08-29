import { GoogleGenAI } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { TOOL_DECLARATIONS } from "./tools.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, ToolContext } from "./toolImplementations.js";
import type { RouteResult } from "../routing/routingEngine.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MAX_TOOL_CALLS = 12;
const GEMINI_RETRY_BACKOFF_MS = [1000, 3000, 6000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry only transient 503 "high demand" errors. A 429 is a quota wall — Gemini's own retry
 * hint is tens of seconds, so retrying (or even trying again at all) just delays the inevitable
 * fallback. Fail fast on 429 so we hand off to NVIDIA immediately instead of stalling ~10s.
 */
async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]
): Promise<Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 503 || attempt >= GEMINI_RETRY_BACKOFF_MS.length) throw err;
      await sleep(GEMINI_RETRY_BACKOFF_MS[attempt]);
    }
  }
}

export interface ToolTraceEntry {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AgentRunResult {
  finalAnswer: string;
  toolTrace: ToolTraceEntry[];
  routeResult?: RouteResult;
  model: string;
}

export type AgentEvent =
  | { type: "tool_start"; tool: string; args: Record<string, unknown> }
  | { type: "tool_complete"; tool: string; ok: boolean }
  | { type: "route_result"; result: RouteResult }
  | { type: "model"; model: string }
  | { type: "final"; answer: string; model: string };

interface RunState {
  toolTrace: ToolTraceEntry[];
  routeResult?: RouteResult;
}

/** Shared by both providers: run one tool call, record the trace, report the result back. */
async function runOneTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  state: RunState,
  onEvent?: (event: AgentEvent) => void
): Promise<{ forModel: unknown; ok: boolean }> {
  onEvent?.({ type: "tool_start", tool: name, args });

  let outcome: { forModel: unknown; ok: boolean };
  try {
    const result = await executeTool(name, args, ctx);
    if (result.fullRouteResult) {
      state.routeResult = result.fullRouteResult;
      onEvent?.({ type: "route_result", result: result.fullRouteResult });
    }
    outcome = { forModel: result.forModel, ok: true };
  } catch (err) {
    // Tool errors are reported back to the model as structured data (not thrown) so it
    // can explain the fallback, per the plan's "never show a blank screen" requirement.
    outcome = { forModel: { error: (err as Error).message }, ok: false };
  }

  onEvent?.({ type: "tool_complete", tool: name, ok: outcome.ok });
  state.toolTrace.push({ name, args, ok: outcome.ok, summary: summarize(outcome.forModel) });
  return outcome;
}

async function runWithGemini(
  userMessage: string,
  ctx: ToolContext,
  state: RunState,
  onEvent?: (event: AgentEvent) => void
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const ai = new GoogleGenAI({ apiKey });
  const contents: Content[] = [{ role: "user", parts: [{ text: userMessage }] }];

  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    const response = await generateContentWithRetry(ai, {
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: buildSystemPrompt(),
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
    });

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      return response.text ?? "";
    }

    // Preserve the model's turn (including its functionCall parts) before appending results.
    const modelContent = response.candidates?.[0]?.content;
    contents.push(modelContent ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });

    const responseParts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "unknown";
      const args = (call.args ?? {}) as Record<string, unknown>;
      const outcome = await runOneTool(name, args, ctx, state, onEvent);
      responseParts.push({
        functionResponse: {
          name,
          response: outcome.ok ? { output: outcome.forModel } : { error: outcome.forModel },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  return "I made a lot of tool calls but couldn't reach a final answer in time. Here's what I found so far: " +
    state.toolTrace.map((t) => `${t.name} (${t.ok ? "ok" : "failed"})`).join(", ");
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

const NVIDIA_TOOLS = TOOL_DECLARATIONS.map((d) => ({
  type: "function" as const,
  function: { name: d.name, description: d.description, parameters: d.parametersJsonSchema },
}));

async function callNvidia(messages: OpenAiMessage[]): Promise<{
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set");

  const res = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: NVIDIA_MODEL, messages, tools: NVIDIA_TOOLS, max_tokens: 2000 }),
  });
  if (!res.ok) {
    throw new Error(`NVIDIA API failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string | null; tool_calls?: OpenAiToolCall[] } }> };
  return data.choices[0].message;
}

// Nemotron is a reasoning model that otherwise dumps its whole chain-of-thought into `content`.
// "detailed thinking off" is its documented directive to return only the final answer. As a
// safety net we also strip any leaked "thinking process" preamble before a markdown answer.
function stripThinking(text: string): string {
  const withoutTags = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // If the model still narrated its reasoning, keep only from the first markdown heading/bold.
  const match = withoutTags.match(/(^|\n)\s*(#{1,6}\s|\*\*)/);
  if (/thinking process|let me|i need to|i'll|analyze user input/i.test(withoutTags.slice(0, 200)) && match) {
    return withoutTags.slice(match.index!).trim();
  }
  return withoutTags;
}

/** Fallback provider when Gemini's free-tier quota is exhausted. */
async function runWithNvidia(
  userMessage: string,
  ctx: ToolContext,
  state: RunState,
  onEvent?: (event: AgentEvent) => void
): Promise<string> {
  const messages: OpenAiMessage[] = [
    { role: "system", content: `detailed thinking off\n\n${buildSystemPrompt()}` },
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    const message = await callNvidia(messages);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return stripThinking(message.content ?? "");
    }

    messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // malformed arguments — let the tool executor's "unknown tool"/validation surface it
      }
      const outcome = await runOneTool(name, args, ctx, state, onEvent);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.ok ? outcome.forModel : { error: outcome.forModel }),
      });
    }
  }

  return "I made a lot of tool calls but couldn't reach a final answer in time. Here's what I found so far: " +
    state.toolTrace.map((t) => `${t.name} (${t.ok ? "ok" : "failed"})`).join(", ");
}

// Gemini's free tier is a DAILY quota, so once it's exhausted every request would waste a
// round-trip getting rejected. After a 429 we skip Gemini entirely for this long and go
// straight to the fallback — cleared automatically once the window passes (or the process restarts).
const GEMINI_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
let geminiBlockedUntil = 0;

export async function runAgent(
  userMessage: string,
  ctx: ToolContext,
  onEvent?: (event: AgentEvent) => void
): Promise<AgentRunResult> {
  const state: RunState = { toolTrace: [] };
  const hasNvidia = Boolean(process.env.NVIDIA_API_KEY);
  const geminiOnCooldown = hasNvidia && Date.now() < geminiBlockedUntil;

  let answer: string;
  let model: string;

  const runFallback = async () => {
    answer = await runWithNvidia(userMessage, ctx, state, onEvent);
    model = NVIDIA_MODEL;
  };

  if (geminiOnCooldown) {
    // Known-exhausted Gemini quota — don't even try it, go straight to NVIDIA.
    await runFallback();
  } else {
    try {
      answer = await runWithGemini(userMessage, ctx, state, onEvent);
      model = GEMINI_MODEL;
    } catch (err) {
      if (!hasNvidia) throw err;
      if ((err as { status?: number }).status === 429) {
        geminiBlockedUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
      }
      // Restart the whole turn on NVIDIA rather than splicing two providers' histories.
      // Tool calls Gemini already made get redone, but they hit our cache so it's cheap.
      await runFallback();
    }
  }

  onEvent?.({ type: "model", model: model! });
  onEvent?.({ type: "final", answer: answer!, model: model! });
  return { finalAnswer: answer!, toolTrace: state.toolTrace, routeResult: state.routeResult, model: model! };
}

function summarize(value: unknown): string {
  const json = JSON.stringify(value);
  return json && json.length > 200 ? json.slice(0, 200) + "…" : json ?? "";
}
