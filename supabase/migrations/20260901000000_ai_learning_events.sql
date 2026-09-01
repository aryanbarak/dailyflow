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
-- layer by shared/aiLearning.ts's closed-schema check).
--
-- IDEMPOTENCY SCOPE (ARCHITECTURAL REVIEW CORRECTION): idempotency_key's
-- uniqueness is scoped to (user_id, idempotency_key), never globally
-- unique on its own -- matching agent_tool_executions' own
-- (user_id, request_id) idempotency convention
-- (agent_tool_executions_user_request_unique,
-- supabase/migrations/20260831120000_agent_tool_executions.sql). A
-- globally unique idempotency_key would let one user's caller-supplied
-- key collide with a completely unrelated user's, forcing either an
-- artificially-widened key format or (worse) a false-duplicate rejection
-- across users who never coordinated with each other. See
-- agent/worker/ai-learning/learning-ledger.ts's own header comment for
-- how a (user_id, idempotency_key) conflict is reconciled at the
-- application layer -- a duplicate append is only ever treated as an
-- idempotent success when the conflicting row's own immutable content
-- actually matches; a same-key-different-content conflict is a distinct,
-- reported failure (IDEMPOTENCY_CONFLICT), never silently accepted or
-- silently overwritten.

create table if not exists public.ai_learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  source_message_id uuid,
  correlation_id text not null,
  idempotency_key text not null,
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
  -- ARCHITECTURAL REVIEW CORRECTION (round 2): the database vocabulary
  -- must not accept an arbitrary schema_version string for a registered
  -- learning_task. Mirrors shared/aiLearning.ts's authoritative
  -- AI_LEARNING_TASK_SCHEMA_VERSIONS mapping (a registered learningTask
  -- has EXACTLY ONE valid schemaVersion) as an explicit `case` pairing --
  -- not merely `schema_version <> ''` -- so a stray/unregistered
  -- schema_version (e.g. 'intent-routing-v2', typo'd, or blank-but-
  -- nonblank noise) can never be inserted even by a caller that bypassed
  -- the application-level check. A future intent-routing-v2 (or a second
  -- learning_task) requires adding its own `when` branch here, in the
  -- SAME reviewed migration/version-contract change that adds it to
  -- AI_LEARNING_TASK_SCHEMA_VERSIONS -- never something that silently
  -- fits through a bare non-blank-string check.
  constraint ai_learning_events_task_schema_version_check check (
    case learning_task
      when 'intent_routing_v1' then schema_version = 'intent-routing-v1'
      else false
    end
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
  constraint ai_learning_events_payload_object_check check (jsonb_typeof(payload) = 'object'),
  -- USER-SCOPED, not globally unique -- see this migration's own
  -- IDEMPOTENCY SCOPE header comment above. Two different users may
  -- legitimately use the same idempotencyKey independently.
  constraint ai_learning_events_user_idempotency_key_unique unique (user_id, idempotency_key)
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
