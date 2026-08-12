// Task 18, B3: source-verification for the authored-not-applied
// supersession migration. Mirrors documentTypeMigration.test.ts's own
// pattern (task 18, A1) -- a live replay against a real Postgres shadow DB
// was ALSO performed manually for this migration (see the task 18 report,
// section D), including a full functional smoke test of both RPCs; this
// test guards the SQL text itself against silent drift in CI, where a
// live Supabase/Docker stack is not available.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  path.resolve(process.cwd(), "supabase", "migrations", "20260813000000_personal_memory_supersession.sql"),
  "utf-8",
);

describe("20260813000000_personal_memory_supersession.sql (task 18, B3)", () => {
  it("is explicitly marked NOT applied, pending PO authorization", () => {
    expect(migrationSource).toMatch(/NOT applied by this task/);
  });

  it("adds the three supersession columns, all idempotently (IF NOT EXISTS)", () => {
    expect(migrationSource).toMatch(/add column if not exists possible_update_of_id uuid references public\.personal_memory_records\(id\) on delete set null;/);
    expect(migrationSource).toMatch(/add column if not exists superseded_by_id uuid references public\.personal_memory_records\(id\) on delete set null;/);
    expect(migrationSource).toMatch(/add column if not exists superseded_at timestamptz;/);
  });

  it("ties status='superseded' to superseded_at ONLY (never superseded_by_id, which can legitimately become null via ON DELETE SET NULL)", () => {
    expect(migrationSource).toMatch(/check \(\(status = 'superseded'\) = \(superseded_at is not null\)\)/);
    expect(migrationSource).not.toMatch(/check \([^)]*superseded_by_id is not null[^)]*status/);
  });

  it("create_personal_memory_record is extended with a 10th parameter (p_possible_update_of_id), and the old 9-arg signature is dropped", () => {
    expect(migrationSource).toMatch(/p_possible_update_of_id uuid default null\s*\)/);
    expect(migrationSource).toMatch(
      /drop function if exists public\.create_personal_memory_record\(\s*uuid, text, jsonb, text, uuid\[\], text, text, text, text\s*\);/,
    );
  });

  it("confirm_personal_memory_record_update exists, is SECURITY DEFINER, and is granted to authenticated only", () => {
    expect(migrationSource).toMatch(/create or replace function public\.confirm_personal_memory_record_update\(/);
    expect(migrationSource).toMatch(/security definer/);
    expect(migrationSource).toMatch(/grant execute on function public\.confirm_personal_memory_record_update\(uuid, uuid\) to authenticated;/);
    expect(migrationSource).toMatch(/revoke all on function public\.confirm_personal_memory_record_update\(uuid, uuid\) from public;/);
  });

  it("confirm_personal_memory_record_update guards against double-supersession and kind mismatch", () => {
    expect(migrationSource).toMatch(/RECORD_ALREADY_SUPERSEDED/);
    expect(migrationSource).toMatch(/KIND_MISMATCH/);
  });

  it("confirm_personal_memory_record_update atomically sets BOTH rows in one function body (single transaction)", () => {
    const fnStart = migrationSource.indexOf("create or replace function public.confirm_personal_memory_record_update");
    const fnBody = migrationSource.slice(fnStart, migrationSource.indexOf("$$;", fnStart + 200));
    expect(fnBody).toMatch(/status = 'user_confirmed', supersedes_id = p_superseded_record_id/);
    expect(fnBody).toMatch(/status = 'superseded', superseded_by_id = p_candidate_record_id, superseded_at = v_now/);
  });

  it("reuses supersedes_id (not a new column) on the candidate row -- the UI's existing 'previous version' affordance works for both correction and confirmed-update origins", () => {
    expect(migrationSource).toMatch(/Reuses supersedes_id \(not a new column\)/);
  });
});
