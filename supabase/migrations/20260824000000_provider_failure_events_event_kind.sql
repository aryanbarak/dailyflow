-- ADR-0018 (Capability-Oriented AI Provider Abstraction), Decision 6, S1c.
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- ("برو", Tier-1 per ADR-0008: schema/migration change). MUST be applied
-- BEFORE the S1c fallback-chain Worker code is deployed -- see
-- PROJECT_STATUS.md's own S1c DEPLOY ORDER note. `recordFallbackSuccess`
-- (agent/worker/providers/failureEvents.ts) is fail-safe the same way
-- `recordProviderFailure` already is (never lets a missing-column insert
-- error become the caller's own failure), so deploying INTO a
-- known-missing-column state degrades to a swallowed `console.warn`
-- rather than a caller-visible break -- but that is still not the
-- intended order.
--
-- 20260823000000_provider_failure_events.sql is already applied to
-- production (2026-08-23) -- this is a SEPARATE, additive migration, not
-- an edit to that one, per the standing rule that an applied migration is
-- immutable.
--
-- Why this column exists: S1c's FallbackTextGenerationProvider needs to
-- record that a SECOND provider served a request after the primary's own
-- ProviderUnavailableError -- a fact distinct from the ordinary failure
-- row recordProviderFailure already writes for the primary. The first
-- cut of this (recordFallbackSuccess) repurposed the `request_id` column
-- as a fixed sentinel string ('fallback_success') to signal this --
-- exactly the mangled-identity pattern Decision 6 already forbids for
-- `provider_id`, just relocated to a different column instead of
-- avoided. Fixed by adding a real, typed column instead of overloading
-- an existing free-text one: `request_id` goes back to carrying only its
-- original per-call meaning for every row, both kinds.
alter table public.provider_failure_events
  add column if not exists event_kind text not null default 'failure'
    check (event_kind in ('failure', 'fallback_success'));

comment on column public.provider_failure_events.event_kind is
  'ADR-0018 S1c: ''failure'' (default -- every row written by recordProviderFailure, and every row that existed before this column was added) or ''fallback_success'' (recordFallbackSuccess -- a second TextGenerationProvider served a request after the primary threw ProviderUnavailableError). request_id is NOT repurposed as a marker for either kind -- it keeps carrying only the real per-call request id, when one exists.';
