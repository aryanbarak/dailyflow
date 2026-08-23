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

export async function recordProviderFailure(
  env: ProviderFailureEnv,
  event: ProviderFailureEvent,
  fetcher: typeof fetch = fetch,
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
      body: JSON.stringify({
        capability: event.capability,
        provider_id: event.provider_id,
        http_status: event.http_status ?? null,
        request_id: event.request_id ?? null,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Supabase POST error (provider_failure_events): ${body}`)
    }
  } catch (err) {
    console.warn('[ProviderFailureEvents] failed to record a provider failure event (non-fatal, the caller\'s own request is unaffected):', (err as Error).message)
  }
}
