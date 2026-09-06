-- CORE-W1 (2026-09-06, CORE audit item ۲-۱): Telegram capture channel.
-- See agent/worker/telegram-webhook.ts for the full trust-model comment.
--
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- ("برو") -- Tier-1 per ADR-0008: schema/migration change.
--
-- Trust shape (same family as engineering_tasks, 20260826000000): the
-- Worker (service_role) owns the webhook side entirely -- code lookup and
-- consumption, binding insert/replace, and the resulting `tasks` insert.
-- The browser touches only what linking UX needs: it CREATES short-lived
-- link codes for itself and READS/DELETES its own binding. Telegram is
-- never a Supabase-authenticated principal; the Worker authenticates it
-- with the setWebhook secret_token header instead.

-- Short-lived, single-use codes the Settings page generates; the user
-- relays one to the bot as `/link <code>`.
create table if not exists public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4,32}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Stamped by the Worker when the bot consumes the code; never cleared.
  consumed_at timestamptz
);

alter table public.telegram_link_codes enable row level security;

-- The browser creates codes only for itself, with a bounded lifetime (the
-- 15-minute ceiling guards against a tampered client minting long-lived
-- codes; the UI advertises 10 minutes).
create policy "telegram_link_codes_insert_own"
  on public.telegram_link_codes for insert
  with check (
    auth.uid() = user_id
    and expires_at <= now() + interval '15 minutes'
  );

create policy "telegram_link_codes_select_own"
  on public.telegram_link_codes for select
  using (auth.uid() = user_id);

-- No UPDATE/DELETE policies: consumption is the Worker's (service_role)
-- job; stale rows are harmless (expires_at filters them out).

-- One Telegram chat maps to exactly one SmartFlow user.
create table if not exists public.telegram_links (
  chat_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

-- Read: Settings shows "connected" state. Delete: the in-app disconnect
-- button. Insert stays service_role-only (the Worker binds after code
-- verification) -- no insert policy on purpose.
create policy "telegram_links_select_own"
  on public.telegram_links for select
  using (auth.uid() = user_id);

create policy "telegram_links_delete_own"
  on public.telegram_links for delete
  using (auth.uid() = user_id);

create index if not exists telegram_links_user_id_idx
  on public.telegram_links (user_id);
