-- Task 45c, ADR-0017: duplicate-detection bookkeeping for the bank-statement
-- batch importer. Records which parsed-row hashes have already been
-- imported, so re-uploading the same statement (or an overlapping date
-- range) never double-imports a transaction. Authored only. Do not apply to
-- production without PO authorization.
--
-- row_hash is computed by shared/bankStatementParser.ts's
-- computeBankRowHash (user_id | booking date | signed amount |
-- Verwendungszweck | counterparty IBAN) -- a fast, non-cryptographic,
-- deterministic hash. It is NOT a security boundary; it exists purely to
-- detect an exact-duplicate transaction row, so no cryptographic guarantee
-- is required or implied by this schema.
--
-- unique(user_id, row_hash) is a DB-level backstop, not just an application-
-- level check: agent/worker/flow-write-policy.ts's checkDuplicateRows
-- already excludes known duplicates before either
-- /finance/import-batch/preview or /finance/import-batch/commit acts on a
-- row, but a rare race between two concurrent imports of the same
-- statement is caught here too, rather than silently double-inserting.
--
-- This table is internal governance bookkeeping, not user-facing data --
-- unlike finance_transactions, no UI ever reads it directly, so RLS grants
-- service_role only (the Worker), matching agent_write_log/agent_proposal_
-- outcomes' own "written and read only by the Worker" trust model, not
-- finance_transactions' "user reads/writes their own rows via RLS" model.
create table if not exists public.finance_import_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  row_hash text not null check (char_length(row_hash) between 1 and 64),
  transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  -- Opaque grouping label for the commit call that produced this row --
  -- diagnostic only, never queried by row_hash lookups (checkDuplicateRows
  -- filters by user_id + row_hash alone).
  batch_id text not null check (char_length(batch_id) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, row_hash)
);

create index if not exists finance_import_rows_transaction_id_idx
  on public.finance_import_rows (transaction_id);

alter table public.finance_import_rows enable row level security;

revoke all on public.finance_import_rows from anon, authenticated;
grant select, insert, update, delete on public.finance_import_rows to service_role;

comment on table public.finance_import_rows is
  'Task 45c, ADR-0017: duplicate-detection bookkeeping for bank-statement batch imports. One row per successfully imported statement row, keyed by (user_id, row_hash) unique. Written and read only by the Worker (service_role) -- not user-facing, no RLS policy grants authenticated access. Deleted alongside its finance_transactions row when a batch import is undone (agent/worker/flow-write-policy.ts undoAutoWrite).';
