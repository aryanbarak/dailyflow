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
const REASONING_FETCH_TIMEOUT_MS = 10_000;

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
