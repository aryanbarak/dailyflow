-- CORE-W6 (2026-09-07, CORE audit item 1-6): recall/consumption log for
-- PersonalMemoryRecord. See ADR-0023 SS2.
--
-- One row per (recall event, record) pair. Deliberately stores ONLY
-- record_id, as a real FK with ON DELETE CASCADE -- never a text/content
-- snapshot of what was recalled. Storing content here would silently defeat
-- ADR-0010 Q1's "forget means forget" guarantee: deleting a
-- personal_memory_records row must also and automatically remove its
-- citation row(s) here, with no application code required to keep the two
-- in sync. Consequence, stated precisely: a batch that cited several
-- records loses only the rows for the ones later deleted (3 cited, 1
-- deleted -> 2 remain); a batch whose EVERY cited record has since been
-- deleted loses every one of its rows and so no longer appears in the log
-- at all -- not an empty placeholder, its entire trace disappears, exactly
-- as if that recall had never been recorded. Accepted behavior, not a
-- defect: a recall log must not outlive the memory it recalled.
create table if not exists public.personal_memory_recall_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.personal_memory_records(id) on delete cascade,
  consumer text not null check (consumer in ('chat', 'briefing', 'tutor')),
  -- Shared across every row from one read event, so the UI can group "these
  -- N records were recalled together at time T by consumer X".
  recall_batch_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists personal_memory_recall_log_user_id_created_at_idx
  on public.personal_memory_recall_log (user_id, created_at desc);

create index if not exists personal_memory_recall_log_record_id_idx
  on public.personal_memory_recall_log (record_id);

alter table public.personal_memory_recall_log enable row level security;

-- Mirrors agent_write_log / agent_tool_executions exactly: only the service
-- role writes directly; authenticated clients only ever read their own rows.
-- The one authenticated write path (the Learn AI tutor, which runs entirely
-- in the browser -- see ADR-0023 Context) goes through the
-- log_personal_memory_recall SECURITY DEFINER RPC below, never a bare grant.
revoke insert, update, delete on public.personal_memory_recall_log from anon, authenticated;

grant select on public.personal_memory_recall_log to authenticated;
grant select, insert, update, delete on public.personal_memory_recall_log to service_role;

drop policy if exists "Users can read own recall log" on public.personal_memory_recall_log;
create policy "Users can read own recall log"
  on public.personal_memory_recall_log
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.personal_memory_recall_log is
  'ADR-0023 SS2: one row per (recall event, record) pair. record_id-only by design (ON DELETE CASCADE) -- never a content snapshot, so a hard-deleted PersonalMemoryRecord''s citation rows disappear automatically; a batch with zero remaining citations no longer appears in the log at all.';

-- ---------------------------------------------------------------------------
-- log_personal_memory_recall: the Learn AI tutor's ONLY write path for this
-- table. The tutor runs entirely in the browser (it is not part of
-- agent/worker -- see ADR-0023 Context), so it authenticates as the user,
-- never as service_role. This RPC re-derives eligibility server-side rather
-- than trusting the caller: every id must belong to the caller AND already
-- be user_confirmed/user_corrected -- the same boundary
-- listConfirmedByOwner/fetchConfirmedPersonalMemory already enforce for
-- every other consumer. p_consumer is hard-restricted to 'tutor': a browser
-- caller has no legitimate way to produce a 'chat' or 'briefing' recall
-- event, since those paths never run in the browser.
-- ---------------------------------------------------------------------------
create or replace function public.log_personal_memory_recall(
  p_record_ids uuid[],
  p_consumer text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_batch_id uuid;
  v_eligible_count integer;
begin
  v_owner_id := auth.uid();
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_consumer <> 'tutor' then
    raise exception 'UNSUPPORTED_CONSUMER';
  end if;

  if p_record_ids is null or cardinality(p_record_ids) < 1 or cardinality(p_record_ids) > 10 then
    raise exception 'INVALID_RECORD_IDS';
  end if;

  select count(*) into v_eligible_count
  from public.personal_memory_records
  where id = any(p_record_ids)
    and user_id = v_owner_id
    and status in ('user_confirmed', 'user_corrected');

  if v_eligible_count <> cardinality(p_record_ids) then
    raise exception 'RECORD_NOT_ELIGIBLE';
  end if;

  v_batch_id := gen_random_uuid();

  insert into public.personal_memory_recall_log (user_id, record_id, consumer, recall_batch_id)
  select v_owner_id, id, p_consumer, v_batch_id
  from unnest(p_record_ids) as id;

  return jsonb_build_object('outcome', 'logged', 'recallBatchId', v_batch_id);
end;
$$;

comment on function public.log_personal_memory_recall is
  'ADR-0023 SS2: the Learn AI tutor''s only write path into personal_memory_recall_log. Re-verifies ownership and user_confirmed/user_corrected eligibility server-side for every id; p_consumer is hard-restricted to ''tutor''.';

revoke all on function public.log_personal_memory_recall(uuid[], text) from public;
grant execute on function public.log_personal_memory_recall(uuid[], text) to authenticated;
