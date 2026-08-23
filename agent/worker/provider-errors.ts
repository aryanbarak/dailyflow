// SmartFlow -- INC-01 (2026-08-22 incident): Gemini returned 429
// RESOURCE_EXHAUSTED for every call for a sustained period. The auto-write
// title-resolution path (flow-write-policy.ts's resolveCreateTitle) caught
// that failure the same way it catches a model genuinely responding with
// nothing usable, and silently fell through to "ask the user" -- so a
// provider outage surfaced as a fabricated clarification ("What should the
// task be called?") instead of an honest "AI unavailable". See the INC-01
// incident report for the full trace.
//
// The fix is a distinction, not a retry or a circuit breaker: a provider
// HTTP failure (429 rate limit, 5xx, or the fetch call itself failing at
// the network level) is a DISTINCT outcome from the provider answering
// with something unusable (malformed JSON, missing field, a non-STOP
// finishReason). Only the former is "the AI never got a chance to
// answer" -- the latter is legitimate ask_clarification/pattern-fallback
// territory exactly as before. This module is the single place that draws
// that line for every Gemini call site in this worker.
export class ProviderUnavailableError extends Error {
  // ADR-0018 S1: optional so existing constructions (INC-01's own, and
  // every existing `new ProviderUnavailableError(message)` call) keep
  // compiling unchanged. Populated by fetchGeminiOrThrow below whenever an
  // actual HTTP response was received (429/5xx) -- left undefined for a
  // genuine network-level failure (fetch itself rejecting), since there is
  // no status to report for that case. Lets a caller with its own richer
  // classification (e.g. document-memory-extraction-endpoint.ts's
  // ProviderCallError taxonomy, which distinguishes >=500 from <500
  // independently of this module's own 429-is-retryable rule) recover the
  // real status without re-deriving it from the error message string.
  readonly status?: number
  readonly body?: string

  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'ProviderUnavailableError'
    this.status = status
    this.body = body
  }
}

// ADR-0018 S1: a non-retryable HTTP failure (a status fetchGeminiOrThrow
// does NOT classify as provider-unavailable -- e.g. a 400, a problem with
// OUR request, not the provider being unreachable). Extends Error, so
// every existing call site that only ever checked `instanceof Error` or
// read `.message` (never `instanceof ProviderUnavailableError` for this
// branch) keeps working identically -- this is what used to be a plain
// `Error` thrown from the same branch; only the concrete class name and
// the two additive `status`/`body` fields are new. Named separately from
// ProviderUnavailableError (not a subclass of it) so
// `instanceof ProviderUnavailableError` checks elsewhere (flow-write-
// policy.ts's resolveCreateTitle, INC-01) stay correctly false for this
// case, exactly as before.
export class ProviderRequestError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'ProviderRequestError'
    this.status = status
    this.body = body
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * Performs one Gemini fetch call and classifies any failure to reach a
 * usable HTTP response. Network-level failures (fetch itself rejecting --
 * DNS, offline, timeout) and retryable HTTP statuses (429/5xx) throw
 * ProviderUnavailableError. Any other non-ok status (e.g. a 400 from a
 * malformed request on our own side) throws ProviderRequestError, since
 * that is not the provider being unavailable. Callers still do their own
 * response body parsing on the returned, already-ok Response.
 */
export async function fetchGeminiOrThrow(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  apiLabel: string,
): Promise<Response> {
  let res: Response
  try {
    res = await fetcher(url, init)
  } catch (err) {
    throw new ProviderUnavailableError(`${apiLabel}: network error reaching the provider (${(err as Error).message})`)
  }
  if (!res.ok) {
    const body = await res.text()
    if (isRetryableStatus(res.status)) {
      throw new ProviderUnavailableError(`${apiLabel}: provider error ${res.status}: ${body}`, res.status, body)
    }
    throw new ProviderRequestError(`${apiLabel} error: ${body}`, res.status, body)
  }
  return res
}
