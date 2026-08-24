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
// ADR-0018 S1c adds one more optional column, event_kind (see
// 20260824000000_provider_failure_events_event_kind.sql) -- still no
// prompt/response content, purely a fixed-vocabulary discriminant.

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

interface ProviderEventRow {
  capability: ProviderFailureCapability
  provider_id: string
  http_status: number | null
  request_id: string | null
  // ADR-0018 S1c: absent for an ordinary failure row (recordProviderFailure)
  // -- JSON.stringify drops an `undefined` property, so the insert omits
  // the key entirely and the column's own `default 'failure'` applies.
  // Only recordFallbackSuccess ever sets this, to the one other known
  // value.
  event_kind?: 'fallback_success'
}

async function insertProviderEvent(
  env: ProviderFailureEnv,
  row: ProviderEventRow,
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
// Reuses this table (task instruction: "check the table first") via a
// dedicated `event_kind` column (20260824000000_provider_failure_events_
// event_kind.sql, authored, NOT yet applied -- see that migration's own
// header for the required deploy order) rather than repurposing an
// existing free-text column as a sentinel. An earlier draft of this
// function set `request_id` to a fixed marker string to distinguish a
// fallback-success row from an ordinary failure row -- rejected on
// review as the same mangled-identity problem the task explicitly
// forbids for `provider_id`, just moved to a different column.
// `provider_id` stays (and always stayed) the real, unmangled id of the
// provider that actually served the request (e.g. 'workers-ai' or
// 'gemini'); `request_id`, when the caller has a real one, keeps only its
// original per-call meaning -- exactly like `recordProviderFailure`'s own
// optional `request_id`. No `http_status` -- a fallback success is not an
// HTTP outcome, and this column is already nullable for exactly this
// "not applicable" case (see recordProviderFailure's own
// http_status:null path for network-level failures).
//
// Fail-safe the same way recordProviderFailure is (via the shared
// insertProviderEvent helper): a missing `event_kind` column -- the exact
// state this codebase is in until the migration above is applied -- never
// becomes the caller's own failure, only a swallowed console.warn.
export interface FallbackSuccessEvent {
  capability: ProviderFailureCapability
  provider_id: string
  request_id?: string
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
      request_id: event.request_id ?? null,
      event_kind: 'fallback_success',
    },
    fetcher,
    'a fallback-success marker',
  )
}
