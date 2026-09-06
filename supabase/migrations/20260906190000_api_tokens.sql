-- CORE-W3 (2026-09-06, CORE audit items ۲-۳ + ۲-۵): personal API tokens,
-- the authentication for the Worker's MCP endpoint (mcp-endpoint.ts).
--
-- AUTHORED ONLY -- do not apply to production without PO authorization
-- ("برو") -- Tier-1 per ADR-0008: schema/migration change.
--
-- The browser NEVER stores the plaintext token: it generates one locally
-- (sfp_<random>), shows it exactly once, and inserts only its SHA-256 hex
-- hash. The Worker authenticates an MCP request by hashing the presented
-- bearer token and looking the hash up service-role (revoked_at is null).
-- Same one-way trust shape as CORE's PATs and this repo's
-- ENGINEERING_TASKS_COMPANION_TOKEN: possession of the plaintext is the
-- credential; the database can only ever verify, never reveal.

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  -- SHA-256 of the plaintext token, lowercase hex.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_tokens_user_id_idx
  on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;

create policy "api_tokens_select_own"
  on public.api_tokens for select
  using (auth.uid() = user_id);

create policy "api_tokens_insert_own"
  on public.api_tokens for insert
  with check (auth.uid() = user_id);

-- Update is allowed only so the owner can revoke; the token_hash itself
-- never changes (mint a new token instead). Enforcing column-level
-- immutability is out of scope for v1 -- an owner "corrupting" their own
-- hash only breaks their own token, which revocation equals anyway.
create policy "api_tokens_update_own"
  on public.api_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "api_tokens_delete_own"
  on public.api_tokens for delete
  using (auth.uid() = user_id);

-- last_used_at is stamped by the Worker (service_role) on successful MCP
-- authentication -- no user-facing write path needed.
