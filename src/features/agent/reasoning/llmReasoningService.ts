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
// ENG-06 / ENG-06f / ENG-06h. This ceiling MUST stay strictly greater than
// ChatPage.tsx's CHAT_REQUEST_TIMEOUT_MS. That invariant is pinned by
// src/features/chat/laneTimeoutOrdering.test.ts -- edit either constant and
// that test tells you which way it broke.
//
// History, because the rule has now been derived twice from two different
// premises and only the second one holds:
//
//   10_000 (original)  -- BELOW chat's 15_000. The reasoning lane hit its
//                         ceiling first on a detailed engineering-task
//                         request, the orchestrator's catch turned that
//                         into providerUnavailable, and the user got an
//                         honest chat reply with NO approval card.
//   20_000 (ENG-06)    -- restored the ordering, justified by "this is
//                         consistently the HEAVIER call".
//   25_000 chat        -- ENG-06f raised the OTHER constant past this one
//        (ENG-06f)       on the premise that reasoning is actually the
//                         faster lane. That re-inverted the ordering and
//                         reopened the window in a worse form (below).
//   30_000 (ENG-06h)   -- ordering restored, on a premise that does not
//                         depend on which lane is faster.
//
// Both speed premises were wrong, in opposite directions, because each read
// half the record. Full measured maxima: this lane 14 493 ms (ENG-06c,
// 19:26Z), the chat lane 14 071 ms (ENG-06e, 21:50Z) -- within 3% of each
// other. ENG-06f's "reasoning is faster (12 297 ms)" used only the ENG-06e
// half and missed the ENG-06c capture that agent/worker/index.ts's own
// truncation comment already cites as the worst case. Neither lane is
// reliably heavier, so relative speed cannot support an ordering rule at
// all.
//
// What DOES support it is that the two lanes fail asymmetrically. Both run
// under one Promise.all in handleSend, but:
//
//   - the chat lane REJECTS on timeout, so Promise.all rejects, handleSend's
//     catch fires, and the user is told the request timed out. That is a
//     statement about US giving up, and it is true.
//   - this lane CATCHES its own timeout and RESOLVES with a
//     providerUnavailable proposal (reasoningOrchestrator.ts), which becomes
//     a trailing note claiming the AI provider is unavailable. That is a
//     statement about the PROVIDER -- and it gets attached to whatever the
//     chat lane returns afterwards.
//
// So whichever ceiling is LOWER decides which of those two things happens.
// With this lane lower, it manufactures a claim about the provider while the
// chat lane is still in flight; the chat lane then succeeds, and the user
// reads a real answer with "the AI is temporarily unavailable" stapled
// underneath it. Same defect class as ENG-06g: the system asserting
// something untrue about its own state.
//
// Hence the rule, in the form that survives future latency changes: the lane
// that makes CLAIMS must never be the first to give up. Direction chosen
// deliberately over the alternative (lowering chat back under this ceiling),
// which cannot work while chat keeps a defensible margin -- chat's observed
// max of 14 071 ms needs >= 22 514 ms to hold the project's 1.6x per-lane
// factor, which is already above this constant's old 20_000.
//
// 30_000 is 2.07x this lane's own observed max of 14 493 ms (comfortably
// past that same 1.6x bar) and leaves 5 000 ms of ordering margin over
// chat's 25_000 -- enough that the invariant does not depend on the two
// lanes being started in the same synchronous block, which today they are
// but need not stay.
//
// ACCEPTED COST, stated because it is real: this lane resolving rather than
// rejecting means Promise.all waits for it even when the chat lane already
// finished. So on a turn where chat returns quickly and this lane hangs, the
// worst-case wait rises from 25 s to 30 s. That is the price of the
// ordering, and it is the right trade -- five seconds of extra spinner on a
// hung overlay is cheaper than telling a user their working AI is down. The
// structural fix that would avoid both costs is to stop making the user wait
// on a lane whose only remaining output is a failure note; that is a
// redesign of the Promise.all, not a constant.
//
// The exact number is still a reasoned default, NOT a measured p95. There is
// no latency telemetry in this repo to derive one from:
// provider_failure_events (20260823000000) stores failure metadata only --
// {capability, provider_id, http_status, occurred_at, request_id}, no
// duration column -- and records only failures, never successful-call
// timings; reasoning-endpoint.ts's `durationMs=` line is an unaggregated
// console log of Worker-side handler time, not the client round trip.
// Revisit if that telemetry ever gains a duration column.
export const REASONING_FETCH_TIMEOUT_MS = 30_000;

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
      // ENG-06d: the worker's typed MODEL_RESPONSE_INCOMPLETE (index.ts's
      // reasoning branch) -- the model DID answer but was cut off
      // mid-JSON. Deliberately NOT folded into providerUnavailable above:
      // the provider was fine, and telling the user "the AI is
      // unavailable" when it answered would be exactly the kind of
      // inaccurate-but-convenient message INC-01 exists to prevent. Also
      // not left to fall through to rawText:"" below, because that feeds
      // the malformed-output rescue and manufactures an ask_clarification
      // out of a truncation (ENG-06c's confirmed symptom).
      if (response.status === 502) {
        const errorBody = await response.json().catch(() => null) as { code?: unknown } | null;
        if (errorBody?.code === "MODEL_RESPONSE_INCOMPLETE") {
          return { rawText: "", responseIncomplete: true };
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
