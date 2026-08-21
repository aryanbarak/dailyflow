-- Task 39, ADR-0016: proposal outcome ledger -- records how SmartFlow's own
-- write proposals fared (auto-executed / approved / rejected), as a
-- foundation for Noticing and for future write-policy decisions (e.g.
-- whether to loosen finance's ask-clamp, ADR-0012). Grants no new write
-- authority and changes no user-visible behaviour on its own -- see
-- ADR-0016 for the full design, including why System 1 (the Worker's
-- deterministic auto-write path) and System 2 (the LLM-based ask-lane
-- proposal path) must BOTH record through this table to avoid the same
-- one-sided-instrumentation bias task 30 already exposed elsewhere.
--
-- AUTHORED ONLY -- not applied. Do not run `supabase db push` for this
-- migration without explicit Product Owner authorization, and only against
-- the verified project ref (taqxwnlwllbywaklwyno).
--
-- FIRE-AND-FORGET: recording an outcome must NEVER block or fail the
-- user's actual write. This table exists purely as a side-effect log --
-- see ADR-0016's explicit principle on this. Nothing here enforces that at
-- the schema level (it's a caller discipline), but it shapes why every
-- column here is either nullable or has a safe default -- a slow or
-- temporarily-unavailable insert must never be a reason to reject a
-- perfectly good write.
--
-- SHAPE, NOT VALUES: no proposal target payload (amounts, IBANs, task/event
-- titles, comment bodies, repo/issue identifiers) and no message text is
-- stored here. target_fields records which fields were POPULATED, never
-- their content. Task 39-amend: deliberately NOT constrained to a known
-- vocabulary by a database CHECK (an earlier draft of this migration did
-- this and was reverted) -- a DB-level enum of field names is itself a
-- hand-maintained copy of "what fields exist," living in a place no
-- typecheck or registry-loop test can guard, which is exactly the failure
-- class ADR-0013's five slices were spent eliminating from this codebase.
-- A new write domain's field names would otherwise be silently REJECTED by
-- the database until someone remembered to alter this constraint too. Any
-- validation of target_fields against shared/writeIntentRegistry.ts's
-- vocabulary belongs in the Worker's recording code, where the registry is
-- reachable and a loop test (task 29-fix's pattern) can guard it -- not
-- here.
--
-- 'approved-after-user-edit' is deliberately absent from the outcome CHECK:
-- no UI in this codebase allows editing a proposal before approving it
-- today (verified directly against StepApprovalDialog.tsx), so the state
-- cannot occur. Widen this constraint if/when edit capability ships, rather
-- than reserving a dead enum value now.
--
-- 'abandoned' is ALSO deliberately absent from v1 (task 39-amend, PO
-- decision): there is no complete detection mechanism for it -- see
-- ADR-0016's own section on this for the options considered and why
-- shipping a column that only sometimes gets populated, with no way for a
-- reader to tell which rows are missing, was rejected in favor of not
-- claiming a state this system cannot actually observe yet.
--
-- Retention: indefinite, by explicit Product Owner decision (task 39) --
-- matches agent_write_log's existing behaviour. No cleanup job exists and
-- none is implied by this migration.

create table if not exists public.agent_proposal_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Correlates to writeRuntime's own requestId / execution audit records,
  -- for debugging only -- opaque identifier, never a value.
  request_id text check (char_length(request_id) between 1 and 200),
  intent_type text not null check (char_length(intent_type) between 1 and 64),
  tool_id text not null check (char_length(tool_id) between 1 and 100),
  domain text not null check (domain in ('tasks', 'calendar', 'finance', 'github')),
  -- Which of the two independent write systems produced this row -- see
  -- ADR-0016's Context section. This is the field that makes the
  -- auto-vs-ask instrumentation bias analyzable in the data itself.
  write_mode text not null check (write_mode in ('auto', 'ask')),
  outcome text not null check (outcome in ('auto_executed', 'approved', 'rejected')),
  -- NULL when outcome is 'rejected' -- nothing was attempted.
  -- Enforced below, not just by convention.
  succeeded boolean,
  risk_level text check (risk_level in ('none', 'low', 'medium', 'high')),
  -- Field NAMES only (which target fields were populated), never their
  -- values. No database CHECK against a field-name vocabulary here on
  -- purpose -- see this file's own header comment (task 39-amend): that
  -- vocabulary lives in shared/writeIntentRegistry.ts and belongs to the
  -- Worker's recording code to validate, where a registry-loop test can
  -- guard it, not to a hand-maintained copy in the database schema.
  target_fields text[] not null default '{}',
  constraint agent_proposal_outcomes_succeeded_requires_attempt
    check (outcome in ('auto_executed', 'approved') or succeeded is null)
);

create index if not exists agent_proposal_outcomes_user_id_created_at_idx
  on public.agent_proposal_outcomes (user_id, created_at desc);

alter table public.agent_proposal_outcomes enable row level security;

-- Same trust model as agent_write_log (EPIC-07) and
-- agent_code_proposal_approvals (EPIC-08): only the Worker (service_role)
-- can write a row; a user can only ever read their own. A browser client
-- that could insert or edit its own outcome rows would make this ledger
-- worthless as a future judgment signal the moment anyone realized it
-- existed -- see ADR-0016.
revoke insert, update, delete on public.agent_proposal_outcomes from anon, authenticated;

grant select on public.agent_proposal_outcomes to authenticated;
grant select, insert, update, delete on public.agent_proposal_outcomes to service_role;

drop policy if exists "Users can read own proposal outcomes" on public.agent_proposal_outcomes;
create policy "Users can read own proposal outcomes"
  on public.agent_proposal_outcomes
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.agent_proposal_outcomes is
  'Task 39, ADR-0016: records how SmartFlow''s own write proposals fared (auto_executed/approved/rejected), as a foundation for Noticing and future write-policy decisions. Written only by the Worker via the service role, from both the deterministic auto-write path and the LLM-based ask-lane approval path, so neither is under-represented, as a fire-and-forget side effect that never blocks or fails the underlying write. Stores proposal SHAPE only -- intent type, tool id, domain, outcome, risk level, which target fields were populated -- never target field values or message text; target_fields is intentionally unconstrained by the database (see this migration''s header comment) since that vocabulary belongs to application code, not a hand-maintained schema copy. ''abandoned'' is deliberately absent from v1 -- no complete detection mechanism exists yet (see ADR-0016). Grants no write authority and is not read by any user-visible feature yet.';
