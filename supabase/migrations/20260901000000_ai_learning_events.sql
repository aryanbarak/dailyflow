-- ALF-0: AI Learning Foundation -- append-only learning-event ledger.
-- Authored only. Do not apply to production without PO authorization.
-- See ADR-0020 (docs/decisions/adr/ADR-0020-ai-learning-foundation-and-
-- shadow-model-governance.md) and agent/worker/ai-learning/learning-ledger.ts
-- for the full design/decision record this table implements.
--
-- APPEND-ONLY BY CONVENTION (application-enforced, not database-enforced):
-- application code must never UPDATE a row in this table to rewrite
-- history. A later fact about the same observed turn (a shadow-model
-- prediction, a user's approval/correction, a verified execution outcome)
-- is always appended as a NEW row sharing the same correlation_id, never
-- an edit to an earlier row. correlation_id -- not id -- is what a reader
-- groups by to reconstruct one turn's whole timeline:
--   turn_observed -> production_label -> shadow_prediction ->
--   user_feedback -> execution_outcome
-- This migration deliberately does NOT add a trigger or REVOKE UPDATE
-- outright: service_role already bypasses RLS for every other ledger-
-- shaped table in this codebase (agent_proposal_outcomes,
-- agent_tool_executions), and the append-only guarantee for those tables
-- is likewise an application-code discipline documented in their own
-- Worker modules, not a database-level restriction. Matching that
-- existing convention rather than introducing a new, inconsistent
-- enforcement mechanism for this one table.
--
-- WHY NOT flow_write_undo_records / agent_proposal_outcomes /
-- agent_tool_executions: none of those answer "what did SmartFlow decide,
-- what did a shadow model predict, and what did the user/execution
-- confirm" for a turn -- they record undo bookkeeping, proposal-outcome
-- shape, and tool-execution lifecycle respectively. This table is a
-- distinct concern: it exists to accumulate portable, provenance-aware
-- training/eval signal, not to drive or audit any write itself. See
-- Section 3 ("Learning subsystem is NOT Memory") of ADR-0020 for the
-- adjacent distinction from personal_memory_records.
--
-- RAW TEXT / PRIVACY (ADR-0020 Decision): this table never stores a
-- duplicate copy of full chat message text. Where a durable source
-- message already exists, source_message_id + source_hash (a fingerprint,
-- not the text itself) are stored instead -- see
-- agent/worker/ai-learning/learning-ledger.ts's computeSourceHash. payload
-- is deliberately shape-only (see shared/aiLearning.ts's
-- IntentRoutingLearningPayloadV1) -- classification labels, not message
-- content, and never identity/secrets (guarded again at the application
-- layer by shared/aiLearning.ts's forbidden-key check).

create table if not exists public.ai_learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  source_message_id uuid,
  correlation_id text not null,
  idempotency_key text not null unique,
  learning_task text not null,
  schema_version text not null,
  event_kind text not null,
  producer_type text not null,
  provider_id text,
  model_id text,
  model_version text,
  label_confidence text,
  source_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_learning_events_learning_task_check check (
    learning_task in ('intent_routing_v1')
  ),
  constraint ai_learning_events_event_kind_check check (
    event_kind in ('turn_observed', 'production_label', 'shadow_prediction', 'user_feedback', 'execution_outcome')
  ),
  constraint ai_learning_events_producer_type_check check (
    producer_type in ('deterministic_policy', 'shadow_model', 'user', 'execution_verifier')
  ),
  constraint ai_learning_events_label_confidence_check check (
    label_confidence is null or label_confidence in ('candidate', 'validated', 'user_confirmed', 'execution_verified')
  ),
  constraint ai_learning_events_correlation_id_not_blank check (char_length(correlation_id) between 1 and 200),
  constraint ai_learning_events_idempotency_key_not_blank check (char_length(idempotency_key) between 1 and 200),
  constraint ai_learning_events_schema_version_not_blank check (char_length(schema_version) between 1 and 100),
  constraint ai_learning_events_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists ai_learning_events_user_created_idx
  on public.ai_learning_events (user_id, created_at desc);

create index if not exists ai_learning_events_correlation_idx
  on public.ai_learning_events (correlation_id);

create index if not exists ai_learning_events_session_idx
  on public.ai_learning_events (session_id)
  where session_id is not null;

create index if not exists ai_learning_events_source_message_idx
  on public.ai_learning_events (source_message_id)
  where source_message_id is not null;

create index if not exists ai_learning_events_task_kind_idx
  on public.ai_learning_events (learning_task, event_kind, created_at desc);

alter table public.ai_learning_events enable row level security;

-- SERVER-OWNED, NO BROWSER ACCESS AT ALL (ADR-0020 Decision -- stricter
-- than agent_tool_executions/agent_proposal_outcomes, which both grant
-- `authenticated` a SELECT-own policy). This table is deliberately NOT
-- exposed for browser SELECT in ALF-0: nothing in this slice builds a
-- user-facing surface that reads it (no runtime authority, no UI -- see
-- ADR-0020 Section 13), and every row's payload is model/learning-shaped
-- data whose value is to the learning pipeline, not to an end-user
-- reading their own history back. Revisit with its own RLS policy (and
-- its own ADR amendment) if/when a concrete user-facing reader is built --
-- until then, the narrower grant is the safer default per this table's
-- fail-closed posture.
revoke all on public.ai_learning_events from anon, authenticated;
grant select, insert, update, delete on public.ai_learning_events to service_role;

comment on table public.ai_learning_events is
  'ALF-0 append-only AI learning ledger. Application code must never UPDATE a row to rewrite history -- later facts about the same turn are appended as new rows sharing correlation_id. service_role (the Worker) is the only writer; no browser access. See ADR-0020.';
