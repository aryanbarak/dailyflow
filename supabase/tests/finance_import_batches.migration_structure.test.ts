import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Task 45c PART B follow-up (PO review item 1): no committed test verified
// this migration's own SQL structure -- same gap
// inferred_project_context_fields.migration_structure.test.ts's own header
// comment describes for that table. This is NOT a live-database test (see
// project_records.rls.test.ts for that pattern, gated behind
// SMARTFLOW_RUN_LOCAL_SUPABASE=1) -- it is a cheap, always-runs, static
// regression guard: it reads the migration file as text and asserts the
// load-bearing structural pieces are still present.
//
// Why a static test, not a live-Supabase RLS test like project_records.rls-
// .test.ts: that pattern proves per-user OWNERSHIP isolation (user A can't
// read/write user B's row) for tables `authenticated` can reach at all.
// finance_import_batches grants `authenticated` and `anon` NOTHING --
// RLS is enabled with zero policies for either role, and the grant is
// explicitly revoked on top as defense in depth (service_role bypasses RLS
// entirely, so no policy is needed for the Worker to operate). There is no
// "does user A see only their own batch" scenario to prove live, because no
// authenticated user can see ANY row via PostgREST -- the property to prove
// is "authenticated/anon have zero grants", which this test asserts
// directly against the migration text instead.
//
// This same gap (no committed structural or live test) also exists for the
// sibling finance_import_rows table (prior migration,
// 20260822000001_finance_import_rows.sql) -- flagged here, not fixed here;
// out of this specific review item's scope.

const MIGRATION_PATH = join(
  __dirname,
  "..",
  "migrations",
  "20260822000002_finance_import_batches.sql",
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("finance_import_batches migration structure (Ruling 3 batch-locking table)", () => {
  it("defines the table", () => {
    expect(sql).toMatch(/create table if not exists public\.finance_import_batches/);
  });

  it("declares every required column", () => {
    for (const column of [
      "id uuid primary key default gen_random_uuid()",
      "user_id uuid not null references auth.users(id) on delete cascade",
      "rows jsonb not null",
      "created_at timestamptz not null default now()",
      "expires_at timestamptz not null",
      "consumed_at timestamptz",
    ]) {
      expect(sql, `expected column definition: ${column}`).toContain(column);
    }
  });

  it("indexes user_id", () => {
    expect(sql).toContain("create index if not exists finance_import_batches_user_id_idx");
    expect(sql).toMatch(/on public\.finance_import_batches \(user_id\)/);
  });

  it("enables RLS and grants ONLY service_role -- authenticated/anon are fully revoked, no policy exists for either", () => {
    expect(sql).toContain("alter table public.finance_import_batches enable row level security");
    expect(sql).toContain("revoke all on public.finance_import_batches from anon, authenticated");
    expect(sql).toContain("grant select, insert, update, delete on public.finance_import_batches to service_role");
    // No CREATE POLICY statement at all for this table -- RLS is enabled
    // with zero policies for anon/authenticated (default-deny), and
    // service_role bypasses RLS entirely so it needs none either. A future
    // edit adding a policy here would be a deliberate, reviewable change to
    // this table's trust model, not something this test should pass through
    // unnoticed -- so it asserts the CURRENT zero-policy state directly.
    expect(sql).not.toMatch(/create policy/i);
  });

  it("documents the table's purpose and trust model in a COMMENT ON TABLE", () => {
    expect(sql).toContain("comment on table public.finance_import_batches is");
  });
});
