-- Chat V2 Slice 2A: server-owned tool execution lifecycle.
-- Authored only. Do not apply to production without PO authorization.
--
-- WHY a new table rather than repurposing flow_write_undo_records: that
-- table is undo-specific and success-oriented by design (one row per
-- successful, reversible write; no pending/approved/failed/denied states
-- exist for it, and its CHECK constraint is a hand-maintained kind
-- allowlist cross-checked against UNDO_KIND_VALUES). This table exists to
-- answer a different question -- "did this specific approved action
-- actually execute, and what happened" -- for every attempt, not just
-- successful reversible ones. See agent/worker/agent-tool-execution.ts's
-- own header comment for the full request -> approve -> execute lifecycle
-- this table backs.
--
-- STRUCTURAL LESSON already learned once in this exact codebase (see
-- supabase/migrations/20260815000000_widen_flow_write_undo_kinds.sql's own
-- header comment: production evidence 23514 on POST flow_write_undo_records
-- because that migration was authored alongside its code but never
-- applied): code referencing this table MUST NOT deploy before this
-- migration is applied. Task instructions for this slice explicitly defer
-- both (no production migration, no Worker deploy) for exactly this
-- reason.

create table if not exists public.agent_tool_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  chat_message_id uuid,
  request_id text not null,
  tool_id text not null,
  domain text not null,
  action text not null,
  intent_id text not null,
  canonical_hash text not null,
  normalized_arguments jsonb not null default '{}'::jsonb,
  -- Not part of the canonical hash (see agent-tool-execution.ts's
  -- computeToolExecutionCanonicalHash preimage) -- a request's IANA time
  -- zone labels how normalized_arguments' wall-clock date/time values
  -- resolve to a real instant, but is not itself part of what makes this
  -- the SAME immutable action. Stored once at request time and never
  -- re-accepted from the client at approve time, for the same reason
  -- normalized_arguments itself is never re-accepted: an approve call that
  -- could supply a new time zone could shift a calendar event's resolved
  -- UTC instant after the fact, which is exactly the "modified args after
  -- approval" hazard decision 10 requires failing closed on.
  time_zone text,
  -- Same reasoning and same never-re-accepted-at-approve-time rule as
  -- time_zone above -- affects only which language the reply text is
  -- written in, never the action itself.
  language text not null default 'en',
  status text not null default 'approval_pending',
  created_at timestamptz not null default now(),
  approval_requested_at timestamptz,
  approved_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  target_type text,
  target_id uuid,
  error_code text,
  constraint agent_tool_executions_domain_check check (domain in ('tasks', 'calendar')),
  constraint agent_tool_executions_language_check check (language in ('en', 'de', 'fa')),
  constraint agent_tool_executions_action_check check (action in ('create', 'update', 'complete')),
  constraint agent_tool_executions_status_check check (
    status in ('approval_pending', 'approved', 'executing', 'succeeded', 'failed', 'denied', 'expired', 'revoked')
  ),
  constraint agent_tool_executions_normalized_arguments_object_check check (
    jsonb_typeof(normalized_arguments) = 'object'
  ),
  -- BLOCKER B CORRECTION: idempotency identity is the per-attempt
  -- (user_id, request_id) pair, never the permanent semantic intent hash
  -- alone. canonical_hash/intent_id name WHICH immutable action this is;
  -- request_id names WHICH ATTEMPT at performing it this is. A user must be
  -- able to legitimately repeat the exact same semantic action twice (e.g.
  -- "complete this task" in two separate, independently approved turns) --
  -- that produces two rows sharing one intent_id under two different
  -- request_ids, both valid. What must never happen is the same request_id
  -- resolving to two DIFFERENT canonical hashes (a request-id substitution
  -- attempt: replaying an old, already-bound request_id against new
  -- arguments to try to inherit its approval) -- agent-tool-execution.ts's
  -- request handler enforces that explicitly, by comparing the row fetched
  -- on a (user_id, request_id) conflict against the freshly computed hash
  -- and failing closed on a mismatch, rather than creating a second row or
  -- reusing the first row's approval. A permanent unique(intent_id), the
  -- original (incorrect) design here, would have made every retried
  -- request of the SAME semantic action collapse onto one row forever --
  -- silently blocking a legitimate second "complete this task" after the
  -- first one succeeded.
  constraint agent_tool_executions_user_request_unique unique (user_id, request_id)
);

create index if not exists agent_tool_executions_user_created_idx
  on public.agent_tool_executions (user_id, created_at desc);

create index if not exists agent_tool_executions_session_idx
  on public.agent_tool_executions (session_id)
  where session_id is not null;

create index if not exists agent_tool_executions_chat_message_idx
  on public.agent_tool_executions (chat_message_id)
  where chat_message_id is not null;

alter table public.agent_tool_executions enable row level security;

-- Browser SELECT own rows only; browser can never INSERT/UPDATE/DELETE --
-- authoritative transitions happen exclusively through the Worker's
-- service-role key. Mirrors flow_write_undo_records' own grant shape
-- exactly (supabase/migrations/20260813010000_flow_write_permissions.sql).
revoke insert, update, delete on public.agent_tool_executions from anon, authenticated;
grant select on public.agent_tool_executions to authenticated;
grant select, insert, update, delete on public.agent_tool_executions to service_role;

drop policy if exists "Users can read own agent tool executions" on public.agent_tool_executions;
create policy "Users can read own agent tool executions"
on public.agent_tool_executions
for select
to authenticated
using (auth.uid() = user_id);

-- Section F: optional, nullable correlation from an undo record back to the
-- execution that produced it -- flow_write_undo_records' own undo-specific
-- semantics (kind/task_id/payload/expires_at/consumed_at) are otherwise
-- completely unchanged by this slice.
alter table public.flow_write_undo_records
  add column if not exists execution_id uuid references public.agent_tool_executions(id) on delete set null;
