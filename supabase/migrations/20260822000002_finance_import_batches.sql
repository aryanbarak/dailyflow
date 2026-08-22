-- Task 45c PART B (Ruling 3, PO), ADR-0017: short-lived staging table
-- locking a bank-import batch's already-decided (post-quarantine,
-- post-duplicate-exclusion) row set between POST /finance/import-batch/
-- preview and POST /finance/import-batch/commit. Authored only. Do not
-- apply to production without PO authorization.
--
-- Why this table exists: without it, the commit endpoint would have to
-- either re-parse the uploaded file and re-run duplicate exclusion from
-- scratch (letting the approved-vs-executed row set silently diverge if
-- anything changed in finance_import_rows between the two calls) or trust
-- a client-echoed row list (letting a tampered client claim any rows it
-- likes). Locking the exact importable set server-side at preview time,
-- keyed by an opaque server-issued batchId, closes both gaps -- see
-- agent/worker/flow-write-policy.ts's own header comment on
-- persistImportBatch/loadImportBatch for the full reasoning.
--
-- `rows` stores ParsedBankRow[] (shared/bankStatementParser.ts) verbatim,
-- as JSONB -- the exact shape executeBatchFinanceImport already expects,
-- so commit never has to reconstruct or re-derive it from anything else.
-- This is short-lived governance bookkeeping, not user-facing data (same
-- trust model as finance_import_rows, added in the prior migration): RLS
-- grants service_role only, no UI ever reads this table directly.
create table if not exists public.finance_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rows jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Set once the batch reaches a terminal outcome (successful commit, or a
  -- duplicate collision detected at commit time) -- see
  -- markImportBatchConsumed's own comment for why a transient
  -- infrastructure failure deliberately does NOT set this, leaving the
  -- batch commitable again with the same batchId (Ruling 1: "the same
  -- proposal retryable").
  consumed_at timestamptz
);

create index if not exists finance_import_batches_user_id_idx
  on public.finance_import_batches (user_id);

alter table public.finance_import_batches enable row level security;

revoke all on public.finance_import_batches from anon, authenticated;
grant select, insert, update, delete on public.finance_import_batches to service_role;

comment on table public.finance_import_batches is
  'Task 45c, ADR-0017: short-lived staging for a bank-import batch''s locked, already-decided row set between preview and commit. Written and read only by the Worker (service_role) -- not user-facing, no RLS policy grants authenticated access. Rows are not actively vacuumed by this migration; expires_at/consumed_at let a future scheduled cleanup identify stale rows, and loadImportBatch already treats both as terminal regardless of physical deletion.';
