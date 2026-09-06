-- CORE-W3 (2026-09-06, CORE audit item ۱-۱): journal assistant notes.
--
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- ("برو") -- Tier-1 per ADR-0008: schema/migration change.
--
-- One row per executed `@ai <instruction>` from a journal entry: the
-- instruction the user wrote and the reply the model gave, keyed by entry
-- date so the notes render alongside that day's entry. Writes happen in
-- the Worker route /journal/assistant (journal-assistant-endpoint.ts) but
-- ALWAYS with the user's own JWT -- these RLS policies are the actual
-- boundary, there is no service-role write path. The user's journal text
-- itself is never touched (append-only companion data, CORE's "the user's
-- own writing is sacred" rule).

create table if not exists public.journal_ai_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  instruction text not null check (char_length(instruction) between 1 and 500),
  reply text not null check (char_length(reply) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists journal_ai_notes_user_date_idx
  on public.journal_ai_notes (user_id, entry_date);

alter table public.journal_ai_notes enable row level security;

create policy "journal_ai_notes_select_own"
  on public.journal_ai_notes for select
  using (auth.uid() = user_id);

create policy "journal_ai_notes_insert_own"
  on public.journal_ai_notes for insert
  with check (auth.uid() = user_id);

create policy "journal_ai_notes_delete_own"
  on public.journal_ai_notes for delete
  using (auth.uid() = user_id);

-- No UPDATE policy: a note is an immutable record of what was asked and
-- answered; the correction path is delete + re-run.
