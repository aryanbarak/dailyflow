// SmartFlow -- ADR-0018 Decision 6, S1: persists every ProviderUnavailableError
// so a provider outage leaves a trace (INC-01: "one billing event silenced
// the entire product, and the product could not say so honestly").
//
// FAIL-SAFE, non-negotiable: this module NEVER lets a persistence failure
// (missing table, network error, RLS denial, ...) become the caller's own
// failure. The caller's request must succeed or fail purely on its own
// terms -- recording the fact that a provider failed must never itself
// cause a second, unrelated failure. Every error is caught, logged ONCE
// with console.warn (not console.error -- this is expected-to-sometimes-
// happen infrastructure, not a bug in the calling request), and swallowed.
//
// No prompt content, no response bodies, no secrets -- matches the
// migration's own column list exactly (capability, provider_id,
// http_status, request_id; id/occurred_at are server-assigned defaults).

// Deliberately its own minimal structural type, not agent/worker/types.ts's
// full `Env` -- this module is called from adapters constructed with
// different callers' own env shapes (index.ts's `Env`, document-memory-
// extraction-endpoint.ts's `DocumentMemoryExtractionEnv`, ...), and the
// only two fields this module actually needs are these. Same reasoning as
// GeminiTextGenerationProvider's own `GeminiProviderEnv` -- see that file.
export interface ProviderFailureEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

export type ProviderFailureCapability = 'text_generation' | 'structured_generation' | 'embedding'

export interface ProviderFailureEvent {
  capability: ProviderFailureCapability
  provider_id: string
  http_status?: number
  request_id?: string
}

async function insertProviderEvent(
  env: ProviderFailureEnv,
  row: { capability: ProviderFailureCapability; provider_id: string; http_status: number | null; request_id: string | null },
  fetcher: typeof fetch,
  logLabel: string,
): Promise<void> {
  try {
    const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/provider_failure_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Supabase POST error (provider_failure_events): ${body}`)
    }
  } catch (err) {
    console.warn(`[ProviderFailureEvents] failed to record ${logLabel} (non-fatal, the caller's own request is unaffected):`, (err as Error).message)
  }
}

export async function recordProviderFailure(
  env: ProviderFailureEnv,
  event: ProviderFailureEvent,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await insertProviderEvent(
    env,
    {
      capability: event.capability,
      provider_id: event.provider_id,
      http_status: event.http_status ?? null,
      request_id: event.request_id ?? null,
    },
    fetcher,
    'a provider failure event',
  )
}

// ADR-0018 S1c: the fallback text-generation chain (fallbackTextProvider.ts)
// needs to leave a trace when a SECOND provider serves a request after the
// primary's own ProviderUnavailableError -- INC-01's whole point was "the
// product could not say so honestly" about an outage; a fallback that
// recovers silently re-creates the same blind spot for recoveries instead
// of outright failures. The primary's own failure is already recorded by
// its own adapter's `recordProviderFailure` call (every real
// TextGenerationProvider adapter does this itself, S1/S1b) -- this
// function records the DIFFERENT fact that the secondary then succeeded.
//
// Reuses this table rather than adding a Tier-1 migration for one boolean
// (task instruction: "check the table first; prefer an encoding without
// migration"). `provider_id` stays the real, unmangled id of the provider
// that actually served the request (e.g. 'workers-ai' or 'gemini') --
// never a synthesized string like 'workers-ai:fallback' (task instruction:
// "NOT a mangled provider_id"). Disambiguated from an ordinary FAILURE row
// for that same provider_id by `request_id`, repurposed as a fixed
// sentinel: real request ids (llmReasoningService.ts's requestIdFactory)
// are per-call generated values that will never coincidentally equal this
// literal string, and no failure row ever sets `request_id` to it. No
// `http_status` -- a fallback success is not an HTTP outcome, and this
// column is already nullable for exactly this "not applicable" case (see
// recordProviderFailure's own http_status:null path for network-level
// failures).
export const FALLBACK_SUCCESS_MARKER = 'fallback_success'

export interface FallbackSuccessEvent {
  capability: ProviderFailureCapability
  provider_id: string
}

export async function recordFallbackSuccess(
  env: ProviderFailureEnv,
  event: FallbackSuccessEvent,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await insertProviderEvent(
    env,
    {
      capability: event.capability,
      provider_id: event.provider_id,
      http_status: null,
      request_id: FALLBACK_SUCCESS_MARKER,
    },
    fetcher,
    'a fallback-success marker',
  )
}
