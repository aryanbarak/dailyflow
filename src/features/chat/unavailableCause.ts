// SmartFlow -- ENG-06f.
//
// Three structurally unrelated failures render the SAME user-facing
// sentence, byte-identical in all three languages:
//
//   en "The AI assistant is temporarily unavailable. Please try again in a moment."
//   de "Der KI-Assistent ist vorübergehend nicht verfügbar. ..."
//   fa "دستیار هوش مصنوعی موقتاً در دسترس نیست. ..."
//
//   1. the Worker's typed 503 (agent/worker/index.ts -- the AI provider
//      returned 429/5xx or was unreachable),
//   2. the overlay lane resolving to providerUnavailable
//      (reasoningOrchestrator.ts -- the reasoning fetch rejected or the
//      Worker reported the 503 above),
//   3. the plain-chat lane exceeding CHAT_REQUEST_TIMEOUT_MS client-side
//      (ChatPage.tsx -- the Worker may well be fine and still working).
//
// Sharing the sentence is a deliberate product choice: from the user's
// seat all three mean "it didn't work, try again", and inventing three
// user-visible variants would leak plumbing. The problem is that they
// were indistinguishable in LOGS as well, and that cost real time --
// ENG-06 diagnosed (2) as a timeout, ENG-06c re-diagnosed it as (1) and
// was wrong, and ENG-06e finally measured it as (3). Three investigation
// rounds, each guessing which lane failed from a string that cannot
// carry that information.
//
// This module is the missing distinction. It changes nothing the user
// sees; it stamps a stable, greppable cause code into the console at each
// producer, so the next occurrence names its own lane. Every line shares
// the LOG_PREFIX below, so `wrangler tail | grep UnavailableCause` (or a
// browser-console filter) shows every producer and nothing else.
//
// The Worker's own producers are tagged separately, in agent/worker/
// index.ts, with the WORKER_* codes below -- deliberately duplicated as
// plain string literals there rather than imported: agent/worker is a
// separate deployable with its own tsconfig and never imports from src/
// (see scripts/typecheck-gate.mjs's two-target comment). The codes are
// kept identical by ENG-06f's own test in unavailableCause.test.ts, which
// reads the Worker file and asserts the literals still match.

export const UNAVAILABLE_CAUSE = {
  // Client, chat lane: withTimeout(CHAT_REQUEST_TIMEOUT_MS) rejected. The
  // request was ABANDONED by the browser -- the Worker was very likely
  // still running and may have completed server-side. Distinguishing this
  // from a real provider outage is the whole point: the cure is latency
  // or ceiling work, never provider work.
  CHAT_LANE_TIMEOUT: 'CHAT_LANE_TIMEOUT',
  // Client, overlay lane: reasoningOrchestrator reported providerUnavailable
  // -- either the Worker's typed 503 relayed through llmReasoningService,
  // or the reasoning fetch itself rejecting (network, or its own 30s
  // ceiling). Still coarser than the two below; narrowing it further is
  // possible but needs a flag threaded through the caller, which this
  // change deliberately does not do.
  OVERLAY_PROVIDER_UNAVAILABLE: 'OVERLAY_PROVIDER_UNAVAILABLE',
  // Client, overlay lane: ENG-06d's truncation outcome. Not an
  // "unavailable" case at all -- the model answered -- but tagged from
  // the same place so one grep enumerates every no-approval-card outcome.
  OVERLAY_MODEL_RESPONSE_INCOMPLETE: 'OVERLAY_MODEL_RESPONSE_INCOMPLETE',
  // Worker, reasoning mode: ProviderUnavailableError -> 503
  // PROVIDER_UNAVAILABLE.
  WORKER_PROVIDER_UNAVAILABLE_REASONING: 'WORKER_PROVIDER_UNAVAILABLE_REASONING',
  // Worker, plain chat: ProviderUnavailableError -> the honest 200 reply
  // (PROVIDER_UNAVAILABLE_CHAT_REPLY), not an HTTP error status.
  WORKER_PROVIDER_UNAVAILABLE_CHAT: 'WORKER_PROVIDER_UNAVAILABLE_CHAT',
} as const

export type UnavailableCause = typeof UNAVAILABLE_CAUSE[keyof typeof UNAVAILABLE_CAUSE]

export const UNAVAILABLE_CAUSE_LOG_PREFIX = '[UnavailableCause]'

/**
 * Builds the one-line, greppable diagnostic for an "unavailable"-class
 * outcome. Pure and exported so tests assert the exact shape rather than
 * spying on console -- the STRING is the contract here, since its only
 * consumers are humans grepping logs and whatever telemetry later scrapes
 * them.
 *
 * `detail` carries only non-sensitive diagnostics (elapsed ms, lane,
 * finishReason). Never a prompt, a reply, or a token -- these lines are
 * printed to the browser console and to Worker logs, which is exactly the
 * boundary provider_failure_events was also kept clear of (ADR-0018
 * Decision 6: failure metadata only).
 */
export function formatUnavailableCause(
  cause: UnavailableCause,
  detail?: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts = Object.entries(detail ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
  return parts.length > 0
    ? `${UNAVAILABLE_CAUSE_LOG_PREFIX} cause=${cause} ${parts.join(' ')}`
    : `${UNAVAILABLE_CAUSE_LOG_PREFIX} cause=${cause}`
}

/**
 * Emits the diagnostic. console.warn (not error) on purpose: every one of
 * these outcomes is already handled and reported honestly to the user, so
 * none is an unhandled fault -- but each is worth surfacing above debug
 * noise, since each one means a user did not get what they asked for.
 */
export function logUnavailableCause(
  cause: UnavailableCause,
  detail?: Record<string, string | number | boolean | null | undefined>,
): void {
  console.warn(formatUnavailableCause(cause, detail))
}
