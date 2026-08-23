-- ADR-0018 (Capability-Oriented AI Provider Abstraction), Decision 6, S0.
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- (Tier-1 per ADR-0008: schema/migration change).
--
-- INC-01 (2026-08-22): Gemini returned 429 for every call and no record of
-- the outage existed anywhere -- "one billing event silenced the entire
-- product, and the product could not say so honestly" (ADR-0018 Context).
-- This table is the missing piece: every ProviderUnavailableError
-- (provider-errors.ts) is persisted here, minimum
-- {capability, provider_id, http_status, occurred_at, request_id}, so a
-- provider outage leaves a trace instead of only a fabricated user-facing
-- symptom. No prompt content, no response bodies, no secrets are ever
-- written here (ADR-0018 Decision 6) -- this is failure metadata only.
--
-- Not wired to any call site yet -- S1/S2/S3 (per-capability adapter
-- slices) are what actually insert rows here. S0 is schema only.
--
-- Same trust model as finance_import_batches (20260822000002): this is
-- Worker-internal bookkeeping, never user-facing, no owning user_id at
-- all (a provider failure is a system-level event, not scoped to one
-- user) -- RLS enabled with zero policies for anon/authenticated
-- (default-deny), service_role only.
create table if not exists public.provider_failure_events (
  id uuid primary key default gen_random_uuid(),
  -- The three ADR-0018 Decision 1 capabilities -- constrained so a typo'd
  -- or drifted capability name fails loudly at insert time rather than
  -- silently fragmenting this table's own aggregation queries.
  capability text not null check (capability in ('text_generation', 'structured_generation', 'embedding')),
  provider_id text not null,
  -- Nullable: a network-level failure (the fetch call itself rejecting --
  -- DNS, offline, timeout) never receives an HTTP response at all, so
  -- there is no status code to record for that case (see
  -- provider-errors.ts's fetchGeminiOrThrow -- it throws
  -- ProviderUnavailableError for both a retryable HTTP status AND a raw
  -- fetch rejection).
  http_status integer,
  occurred_at timestamptz not null default now(),
  -- Nullable: not every call site that will eventually write here has a
  -- request id to attach yet (only the structured-reasoning transport
  -- generates one today, per llmReasoningService.ts's requestIdFactory).
  request_id text
);

create index if not exists provider_failure_events_occurred_at_idx
  on public.provider_failure_events (occurred_at);

alter table public.provider_failure_events enable row level security;

revoke all on public.provider_failure_events from anon, authenticated;
grant select, insert, update, delete on public.provider_failure_events to service_role;

comment on table public.provider_failure_events is
  'ADR-0018 Decision 6 (INC-01 follow-up): every ProviderUnavailableError persisted as minimum failure metadata (capability, provider_id, http_status, occurred_at, request_id) -- no prompt content, no response bodies, no secrets. Written and read only by the Worker (service_role); not user-facing, no RLS policy grants authenticated/anon access. Retention: 30 days via a future scheduled cleanup in the existing 0 6 * * * cron (not implemented by this migration -- S1+ work).';
