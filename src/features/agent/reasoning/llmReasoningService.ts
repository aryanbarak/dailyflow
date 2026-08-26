import { withTimeout } from "../executionEngine";
import type {
  AgentIntentProposal,
  AgentLlmReasoningCaller,
  AgentLlmReasoningRequest,
} from "./reasoningTypes";

// GH-06: the reasoning-overlay fetch previously had no timeout at all, so a
// Worker stall here hung Promise.all in ChatPage.tsx's handleSend
// indefinitely -- reasonAboutUserMessage's own `.catch(() => ({ rawText:
// "", providerUnavailable: true }))` (reasoningOrchestrator.ts) already
// treats ANY rejection from this caller as a provider-unavailable outcome
// (INC-01), so making this fetch reject on timeout -- instead of never
// settling -- is sufficient; no new honest-failure plumbing is needed here.
//
// ENG-06: this ceiling was 10_000 -- SHORTER than the plain-chat fetch's
// own CHAT_REQUEST_TIMEOUT_MS (15_000, ChatPage.tsx), even though the two
// run concurrently in the same Promise.all and this one is consistently
// the HEAVIER call: it asks the provider for structured generation
// against a schema that ENG-04 widened with the engineering-task fields
// (intentValidator.ts's engineeringInstruction alone is bounded at 4000
// chars), while /chat asks for free text. The inversion had a real
// user-visible cost: on a detailed engineering-task request, the
// reasoning lane hit its 10s ceiling first, the orchestrator's catch
// turned that into providerUnavailable, and the user got the honest chat
// reply with NO approval card -- the proposal they asked for silently
// never appeared. Raised to 20_000 so the heavier lane is never the first
// to give up: >= chat's 15s, plus a 5s margin proportional to the extra
// structured-generation work.
//
// The exact number is a reasoned default, NOT a measured p95. There is no
// latency telemetry in this repo to derive one from:
// provider_failure_events (20260823000000) stores failure metadata only
// -- {capability, provider_id, http_status, occurred_at, request_id}, no
// duration column -- and records only failures, never successful-call
// timings; reasoning-endpoint.ts's `durationMs=` line is an unaggregated
// console log of Worker-side handler time, not the client round trip.
// Revisit this constant if that telemetry ever gains a duration column.
const REASONING_FETCH_TIMEOUT_MS = 20_000;

export type AgentReasoningParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface AgentReasoningServiceOptions {
  endpoint?: string;
  accessToken?: string;
  fetcher?: typeof fetch;
  transport?: AgentReasoningTransport;
  requestIdFactory?: () => string;
}

export type AgentReasoningTransport = "stateful-chat" | "structured-reasoning";

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? "";
}

export function parseLlmIntentJson(rawText: string): AgentReasoningParseResult {
  const json = extractJson(rawText);
  if (!json) return { ok: false, error: "No JSON object found." };

  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false, error: "Malformed JSON." };
  }
}

export function createLlmReasoningCaller(
  options: AgentReasoningServiceOptions,
): AgentLlmReasoningCaller {
  return async (request: AgentLlmReasoningRequest) => {
    if (!options.endpoint) {
      return { rawText: "" };
    }

    const fetcher = options.fetcher ?? globalThis.fetch;
    const transport = options.transport ?? "stateful-chat";
    const requestId = options.requestIdFactory?.() ??
      `reasoning:${request.sessionId ?? "session"}:${Date.now()}`;
    const body = transport === "structured-reasoning"
      ? {
          requestId,
          reasoningPrompt: request.prompt,
          responseLanguage: request.responseLanguage,
        }
      : {
          message: request.prompt,
          session_id: request.sessionId ?? "flow-ai-reasoning",
          responseLanguage: request.responseLanguage,
          mode: "reasoning",
        };
    const response = await withTimeout(
      fetcher(options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      REASONING_FETCH_TIMEOUT_MS,
      "Reasoning overlay request timed out.",
    );

    if (!response.ok) {
      // INC-01: a 503 carrying the worker's typed PROVIDER_UNAVAILABLE
      // code (agent/worker/index.ts's handleChat, mode==="reasoning")
      // means the AI provider itself never got a chance to answer --
      // distinct from any other non-ok status, which keeps the existing
      // rawText:"" behavior (treated as "the model responded with nothing
      // usable" by reasoningOrchestrator.ts's parse/rescue path, same as
      // before this fix).
      if (response.status === 503) {
        const errorBody = await response.json().catch(() => null) as { code?: unknown } | null;
        if (errorBody?.code === "PROVIDER_UNAVAILABLE") {
          return { rawText: "", providerUnavailable: true };
        }
      }
      return { rawText: "" };
    }

    const data = (await response.json()) as {
      requestId?: unknown;
      proposal?: unknown;
      responseLanguage?: unknown;
      reply?: unknown;
      intent?: unknown;
    };
    if (transport === "structured-reasoning") {
      if (
        data.requestId !== requestId ||
        !isPartialIntentProposal(data.proposal) ||
        data.responseLanguage !== request.responseLanguage
      ) {
        return { rawText: "" };
      }
      return { rawText: JSON.stringify(data.proposal) };
    }
    if (typeof data.intent === "object" && data.intent) {
      return { rawText: JSON.stringify(data.intent) };
    }
    return { rawText: typeof data.reply === "string" ? data.reply : "" };
  };
}

export function isPartialIntentProposal(value: unknown): value is Partial<AgentIntentProposal> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
