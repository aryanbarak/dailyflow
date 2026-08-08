import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Review finding F5/MINOR (docs/reviews/2026-08-inferred-context-layer-review.md,
// section B6): no committed test verified this migration's own SQL structure
// (columns, CHECK constraints, indexes, RLS posture) -- the only prior
// verification was a one-time, disposable-Postgres session that no longer
// exists. This is not a live-database test (see
// inferred_project_context_fields.rls.test.ts for that) -- it is a cheap,
// always-runs, static regression guard: it reads the migration file as text
// and asserts the load-bearing structural pieces are still present, so an
// editor removing or renaming a constraint/index/function signature by
// accident fails CI immediately rather than only being caught the next time
// someone happens to run a live Supabase verification.

const MIGRATION_PATH = join(
  __dirname,
  "..",
  "migrations",
  "20260807000000_inferred_project_context_fields.sql",
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("inferred_project_context_fields migration structure (review finding F5/B6)", () => {
  it("defines both tables", () => {
    expect(sql).toMatch(/create table if not exists public\.inferred_context_derivation_runs/);
    expect(sql).toMatch(/create table if not exists public\.inferred_project_context_fields/);
  });

  it("declares every required column on inferred_project_context_fields", () => {
    for (const column of [
      "id uuid primary key",
      "user_id uuid not null references auth.users(id)",
      "project_id uuid not null references public.project_records(id)",
      "run_id uuid references public.inferred_context_derivation_runs(id)",
      "kind text not null check",
      "content jsonb not null check",
      "source_evidence_ids uuid[] not null check",
      "model_identity text not null check",
      "derivation_version text not null check",
      "confidence text not null check",
      "status text not null default 'proposed'",
      "source text not null check",
      "supersedes_id uuid references public.inferred_project_context_fields(id)",
      "content_fingerprint text not null check",
    ]) {
      expect(sql, `expected column definition: ${column}`).toContain(column);
    }
  });

  it("closes the kind enum to exactly the six ProjectContext field kinds", () => {
    expect(sql).toMatch(
      /kind in \('objective', 'milestone', 'decision', 'risk', 'capability', 'candidate_action'\)/,
    );
  });

  it("closes the status state machine to exactly the five ADR-0009 states", () => {
    expect(sql).toMatch(
      /status in \('proposed', 'user_confirmed', 'user_corrected', 'user_rejected', 'superseded'\)/,
    );
  });

  it("enforces the run_id/source pairing constraint (model rows require a run, user rows never have one)", () => {
    expect(sql).toContain("constraint inferred_project_context_fields_run_id_matches_source");
    expect(sql).toMatch(/check \(\(source = 'model' and run_id is not null\) or \(source = 'user' and run_id is null\)\)/);
  });

  it("requires non-empty, bounded evidence linkage (ADR-0009: invalid by construction)", () => {
    expect(sql).toMatch(/cardinality\(source_evidence_ids\) >= 1 and cardinality\(source_evidence_ids\) <= 20/);
  });

  it("defines the partial unique index scoped to exclude only superseded rows (ADR-0009 Q1/Q5)", () => {
    expect(sql).toContain("create unique index if not exists inferred_project_context_fields_fingerprint_key");
    expect(sql).toMatch(/on public\.inferred_project_context_fields \(project_id, kind, content_fingerprint\)\s*\n\s*where status <> 'superseded'/);
  });

  it("enables RLS on both tables and revokes direct write access to inferred_project_context_fields", () => {
    expect(sql).toContain("alter table public.inferred_context_derivation_runs enable row level security");
    expect(sql).toContain("alter table public.inferred_project_context_fields enable row level security");
    expect(sql).toContain("revoke insert, update, delete on public.inferred_project_context_fields from authenticated, anon");
    expect(sql).toContain("grant select on public.inferred_project_context_fields to authenticated");
  });

  it("defines both SECURITY DEFINER functions with search_path pinned", () => {
    expect(sql).toMatch(/create or replace function public\.create_inferred_context_field\(/);
    expect(sql).toMatch(/create or replace function public\.resolve_inferred_context_field\(/);
    const definerCount = sql.match(/security definer/g)?.length ?? 0;
    const searchPathCount = sql.match(/set search_path = public, pg_temp/g)?.length ?? 0;
    expect(definerCount).toBe(2);
    expect(searchPathCount).toBe(2);
  });

  it("resolves ownership from auth.uid() inside both functions, never from a parameter", () => {
    const definerFunctionBodies = sql.split(/create or replace function public\.(?:create|resolve)_inferred_context_field/).slice(1);
    expect(definerFunctionBodies).toHaveLength(2);
    for (const body of definerFunctionBodies) {
      expect(body).toContain("v_owner_id := auth.uid();");
    }
  });

  it("revokes public execute and grants only to authenticated on both functions", () => {
    expect(sql).toMatch(/revoke all on function public\.create_inferred_context_field\(/);
    expect(sql).toMatch(/grant execute on function public\.create_inferred_context_field\(/);
    expect(sql).toMatch(/revoke all on function public\.resolve_inferred_context_field\(/);
    expect(sql).toMatch(/grant execute on function public\.resolve_inferred_context_field\(/);
  });

  it("review finding F3: create_inferred_context_field's INSERT is wrapped in a unique_violation handler that checks the actual constraint name via diagnostics", () => {
    const [, createBody] = sql.split("create or replace function public.create_inferred_context_field");
    expect(createBody).toBeDefined();
    expect(createBody).toContain("exception\n    when unique_violation then");
    expect(createBody).toContain("get stacked diagnostics v_constraint_name = constraint_name;");
    expect(createBody).toContain("if v_constraint_name <> 'inferred_project_context_fields_fingerprint_key' then");
    expect(createBody).toContain("raise exception 'DUPLICATE_LOOKUP_FAILED';");
  });

  it("narrows automatic supersession to objective/milestone kinds only, and only against still-proposed rows", () => {
    expect(sql).toContain("if p_kind in ('objective', 'milestone') then");
    expect(sql).toMatch(/where project_id = p_project_id and kind = p_kind and status = 'proposed' and run_id <> p_run_id/);
  });

  it("resolve_inferred_context_field's correct action inserts a new row rather than mutating the original", () => {
    const [, resolveBody] = sql.split("create or replace function public.resolve_inferred_context_field");
    expect(resolveBody).toBeDefined();
    expect(resolveBody).toContain("update public.inferred_project_context_fields set status = 'user_corrected' where id = p_field_id;");
    expect(resolveBody).toMatch(/insert into public\.inferred_project_context_fields \(/);
    expect(resolveBody).not.toMatch(/update public\.inferred_project_context_fields set content/);
  });
});
