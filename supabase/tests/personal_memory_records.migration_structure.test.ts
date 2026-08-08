import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-0010: no committed test previously verified this migration's own SQL
// structure. Mirrors
// inferred_project_context_fields.migration_structure.test.ts's convention
// exactly (built in from the start this time, not added after a review
// finding): reads the migration file as text and asserts the load-bearing
// structural pieces are present, so an editor removing or renaming a
// constraint/index/function signature by accident fails CI immediately.
// Not a live-database test -- see personal_memory_records.rls.test.ts for
// that.

const MIGRATION_PATH = join(__dirname, "..", "migrations", "20260808000000_personal_memory_records.sql");
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("personal_memory_records migration structure", () => {
  it("defines both tables", () => {
    expect(sql).toMatch(/create table if not exists public\.personal_memory_extraction_runs/);
    expect(sql).toMatch(/create table if not exists public\.personal_memory_records/);
  });

  it("declares every required column on personal_memory_records, with NO project_id column anywhere", () => {
    for (const column of [
      "id uuid primary key",
      "user_id uuid not null references auth.users(id)",
      "run_id uuid references public.personal_memory_extraction_runs(id)",
      "kind text not null check",
      "content jsonb not null check",
      "provenance_source_kind text not null check",
      "provenance_source_ref_ids uuid[] not null check",
      "model_identity text not null check",
      "derivation_version text not null check",
      "confidence text not null check",
      "status text not null default 'proposed'",
      "source text not null check",
      "supersedes_id uuid references public.personal_memory_records(id) on delete set null",
      "content_fingerprint text not null check",
    ]) {
      expect(sql, `expected column definition: ${column}`).toContain(column);
    }
    // No ACTUAL project_id column declaration anywhere -- explanatory
    // comments elsewhere in this file legitimately discuss "no project
    // dimension," so this checks for a real column pattern, not a loose
    // substring.
    expect(sql).not.toMatch(/\bproject_id uuid\b/);
  });

  it("closes the kind enum to exactly the six ADR-0010 Q2-approved kinds", () => {
    expect(sql).toMatch(
      /kind in \('preference', 'goal', 'working_pattern', 'commitment', 'personal_fact', 'skill'\)/,
    );
  });

  it("closes the status state machine to exactly the five states, mirroring ADR-0009", () => {
    expect(sql).toMatch(
      /status in \('proposed', 'user_confirmed', 'user_corrected', 'user_rejected', 'superseded'\)/,
    );
  });

  it("closes the provenance source kind enum to the three ADR-0010 section 2.b values", () => {
    expect(sql).toMatch(/provenance_source_kind in \('chat_turn', 'briefing', 'explicit_user_statement'\)/);
  });

  it("enforces the run_id/source pairing constraint (model rows require a run, user rows never have one)", () => {
    expect(sql).toContain("constraint personal_memory_records_run_id_matches_source");
    expect(sql).toMatch(/check \(\(source = 'model' and run_id is not null\) or \(source = 'user' and run_id is null\)\)/);
  });

  it("requires non-empty, bounded provenance reference ids (ADR-0010: invalid by construction)", () => {
    expect(sql).toMatch(/cardinality\(provenance_source_ref_ids\) >= 1 and cardinality\(provenance_source_ref_ids\) <= 20/);
  });

  it("defines the partial unique index scoped by (user_id, kind, content_fingerprint), NOT project_id, excluding only superseded rows", () => {
    expect(sql).toContain("create unique index if not exists personal_memory_records_fingerprint_key");
    expect(sql).toMatch(/on public\.personal_memory_records \(user_id, kind, content_fingerprint\)\s*\n\s*where status <> 'superseded'/);
  });

  it("enables RLS on both tables and revokes direct write access to personal_memory_records", () => {
    expect(sql).toContain("alter table public.personal_memory_extraction_runs enable row level security");
    expect(sql).toContain("alter table public.personal_memory_records enable row level security");
    expect(sql).toContain("revoke insert, update, delete on public.personal_memory_records from authenticated, anon");
    expect(sql).toContain("grant select on public.personal_memory_records to authenticated");
  });

  it("defines all three SECURITY DEFINER functions with search_path pinned", () => {
    expect(sql).toMatch(/create or replace function public\.create_personal_memory_record\(/);
    expect(sql).toMatch(/create or replace function public\.resolve_personal_memory_record\(/);
    expect(sql).toMatch(/create or replace function public\.delete_personal_memory_record\(/);
    const definerCount = sql.match(/security definer/g)?.length ?? 0;
    const searchPathCount = sql.match(/set search_path = public, pg_temp/g)?.length ?? 0;
    expect(definerCount).toBe(3);
    expect(searchPathCount).toBe(3);
  });

  it("resolves ownership from auth.uid() inside all three SECURITY DEFINER functions, never from a parameter", () => {
    const definerFunctionBodies = sql.split(/create or replace function public\.(?:create|resolve|delete)_personal_memory_record/).slice(1);
    expect(definerFunctionBodies).toHaveLength(3);
    for (const body of definerFunctionBodies) {
      expect(body).toContain("v_owner_id := auth.uid();");
    }
  });

  it("revokes public execute and grants only to authenticated on all three functions", () => {
    for (const fn of ["create_personal_memory_record", "resolve_personal_memory_record", "delete_personal_memory_record"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(`));
    }
  });

  it("create_personal_memory_record's INSERT is wrapped in a unique_violation handler that checks the actual constraint name via diagnostics (built in from the start, not added after a review finding)", () => {
    const [, createBody] = sql.split("create or replace function public.create_personal_memory_record");
    expect(createBody).toBeDefined();
    expect(createBody).toContain("exception\n    when unique_violation then");
    expect(createBody).toContain("get stacked diagnostics v_constraint_name = constraint_name;");
    expect(createBody).toContain("if v_constraint_name <> 'personal_memory_records_fingerprint_key' then");
    expect(createBody).toContain("raise exception 'DUPLICATE_LOOKUP_FAILED';");
  });

  it("create_personal_memory_record performs NO automatic supersession for any kind (documented v1 decision)", () => {
    const [, createBody] = sql.split("create or replace function public.create_personal_memory_record");
    expect(createBody).toBeDefined();
    expect(createBody).not.toMatch(/set status = 'superseded'/);
  });

  it("create_personal_memory_record rejects explicit_user_statement (no capture surface yet) while the column still allows it", () => {
    const [, createBody] = sql.split("create or replace function public.create_personal_memory_record");
    expect(createBody).toContain("UNSUPPORTED_PROVENANCE_SOURCE_KIND");
    expect(createBody).toMatch(/if p_provenance_source_kind not in \('chat_turn', 'briefing'\) then/);
  });

  it("resolve_personal_memory_record's correct action inserts a new row rather than mutating the original, using NOT NULL sentinel model_identity/derivation_version", () => {
    const [, resolveBody] = sql.split("create or replace function public.resolve_personal_memory_record");
    expect(resolveBody).toBeDefined();
    expect(resolveBody).toContain("update public.personal_memory_records set status = 'user_corrected' where id = p_record_id;");
    expect(resolveBody).toMatch(/insert into public\.personal_memory_records \(/);
    expect(resolveBody).not.toMatch(/update public\.personal_memory_records set content/);
    expect(resolveBody).toContain("'user', 'user-correction-v1', 'high', 'user_confirmed', 'user', p_record_id");
  });

  it("delete_personal_memory_record performs a hard DELETE with no status restriction (ADR-0010 Q1: any status, no exceptions)", () => {
    const [, deleteBody] = sql.split("create or replace function public.delete_personal_memory_record");
    expect(deleteBody).toBeDefined();
    expect(deleteBody).toContain("delete from public.personal_memory_records");
    // The actual functional guard resolve_personal_memory_record uses
    // (RECORD_NOT_PROPOSED) must be absent here -- delete has no such
    // restriction. Not asserted via the loose phrase "status = 'proposed'",
    // which also appears legitimately in this function's own explanatory
    // comment describing the absence of that restriction.
    expect(deleteBody).not.toContain("RECORD_NOT_PROPOSED");
    expect(deleteBody).toContain("RECORD_NOT_FOUND");
  });

  it("supersedes_id uses ON DELETE SET NULL (required for Q1's unconditional hard delete to never be blocked by a referencing correction row)", () => {
    expect(sql).toContain("supersedes_id uuid references public.personal_memory_records(id) on delete set null");
  });
});
