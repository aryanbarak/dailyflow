-- CORE-W2 (2026-09-06, CORE audit item ۳-۴): the user persona document.
--
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- ("برو") -- Tier-1 per ADR-0008: schema/migration change.
--
-- One hand-written markdown document per user, injected verbatim (bounded)
-- into the /chat system prompt as a <user-persona> block. This is the
-- user's OWN authored text about who they are and how the assistant should
-- work with them -- deliberately distinct from personal_memory_records
-- (model-extracted, ADR-0010-governed) and from user_context (writes
-- frozen per ADR-0010 Q3). ONLY the user ever writes this table; there is
-- deliberately no model/worker write path (CORE's incremental LLM editing
-- of the persona was considered and NOT adopted -- it would reopen the
-- auto-memory-write territory ADR-0010 closed; revisit only via a new
-- recorded decision). The Worker reads it service-role (fetchUserPersona,
-- best-effort).

create table if not exists public.user_persona (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- 8000-char cap, mirrored by USER_PERSONA_MAX_PROMPT_CHARS in
  -- agent/worker/prompt-builder.ts and the Settings editor's maxLength --
  -- three independent bounds on token-budget impact.
  content text not null check (char_length(content) <= 8000),
  updated_at timestamptz not null default now()
);

alter table public.user_persona enable row level security;

create policy "user_persona_select_own"
  on public.user_persona for select
  using (auth.uid() = user_id);

create policy "user_persona_insert_own"
  on public.user_persona for insert
  with check (auth.uid() = user_id);

create policy "user_persona_update_own"
  on public.user_persona for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_persona_delete_own"
  on public.user_persona for delete
  using (auth.uid() = user_id);
