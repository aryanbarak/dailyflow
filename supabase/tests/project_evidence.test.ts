import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(new URL("../migrations/20260802000000_project_evidence.sql", import.meta.url), "utf8");
const migration = migrationSource.toLowerCase();
/** Column/constraint definitions only, with `--` line comments and `comment on table` documentation strings stripped -- the migration's own prose legitimately names excluded concepts (e.g. "no approval field") to explain the boundary, which is not itself evidence of a real column. */
const migrationDdlOnly = migrationSource
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/comment on table[\s\S]*?;/gi, "")
  .toLowerCase();
const generatedTypes = readFileSync(new URL("../../src/integrations/supabase/types.ts", import.meta.url), "utf8");

describe("ProjectEvidence migration", () => {
  it("enables RLS and exposes owner-scoped select/insert policies only", () => {
    expect(migration).toContain("alter table public.project_evidence enable row level security");
    expect(migration).toContain("using (auth.uid() = user_id)");
    expect(migration).toContain("for select");
    expect(migration).toContain("for insert");
    expect(migration).not.toMatch(/for update/);
    expect(migration).not.toMatch(/for delete/);
    expect(migration).toContain("revoke update, delete on public.project_evidence from authenticated, anon");
    expect(migration).toContain("grant select, insert on public.project_evidence to authenticated");
  });

  it("binds the insert policy's WITH CHECK to both the row owner and the referenced project's owner", () => {
    expect(migration).toMatch(/with check\s*\(\s*auth\.uid\(\) = user_id/);
    expect(migration).toContain("select 1 from public.project_records pr");
    expect(migration).toContain("pr.id = project_id and pr.user_id = auth.uid()");
  });

  it("binds the insert policy's WITH CHECK to a null-or-same-owner-and-project supersedes_id", () => {
    expect(migration).toContain("supersedes_id is null");
    expect(migration).toContain("from public.project_evidence pe");
    expect(migration).toContain("pe.user_id = auth.uid()");
    // Both comparisons must be qualified with the bare table name, not the
    // `pe` alias, so they compare the *inserted* row's supersedes_id/
    // project_id, not `pe`'s own columns -- see the migration's own comment
    // for why the unqualified form of either is unsafe: `pe.id =
    // supersedes_id` would resolve to `pe.id = pe.supersedes_id` (denies
    // every legitimate supersession) and `pe.project_id = project_id` would
    // resolve to `pe.project_id = pe.project_id` (always true).
    expect(migration).toContain("pe.id = project_evidence.supersedes_id");
    expect(migration).toContain("pe.project_id = project_evidence.project_id");
    // Reject the previously-broken unqualified form outright: it must not
    // reappear as a bare, standalone comparison anywhere in the policy.
    expect(migration).not.toMatch(/pe\.id\s*=\s*supersedes_id\b/);
  });

  it("whitelists a closed set of source kinds matching ProjectSourceKind", () => {
    expect(migration).toContain("source_kind in (");
    expect(migration).toContain("'verified_repository_state'");
    expect(migration).toContain("'verified_integration_evidence'");
  });

  it("whitelists a closed, non-ordinal classification set", () => {
    expect(migration).toContain("classification in (");
    expect(migration).toContain("'observed'");
    expect(migration).toContain("'explicit_user_statement'");
    expect(migration).toContain("'imported'");
    expect(migration).toContain("'verified_provider_observation'");
    expect(migration).toContain("'canonical_document_observation'");
  });

  it("never accepts derived, llm_inferred, generated, rejected, or accepted_execution_result as classification values", () => {
    expect(migration).not.toMatch(/'derived'/);
    expect(migration).not.toMatch(/'llm_inferred'/);
    expect(migration).not.toMatch(/'generated'/);
    expect(migration).not.toMatch(/'rejected'/);
    expect(migration).not.toMatch(/'accepted_execution_result'/);
  });

  it("binds every evidence row to exactly one project via a foreign key", () => {
    expect(migration).toContain("project_id uuid not null references public.project_records(id) on delete cascade");
  });

  it("bounds confidence to [0, 1] when present", () => {
    expect(migration).toContain("confidence >= 0 and confidence <= 1");
  });

  it("models supersession as an explicit, nullable self-reference that never cascades a delete onto the superseding row", () => {
    expect(migration).toContain("supersedes_id uuid references public.project_evidence(id) on delete set null");
  });

  it("enforces a stable candidate fingerprint uniqueness constraint scoped per project", () => {
    expect(migration).toContain("project_evidence_candidate_fingerprint_key");
    expect(migration).toContain("on public.project_evidence (project_id, candidate_fingerprint)");
  });

  it("contains no ProjectContext-derived, approval, execution, or credential field", () => {
    expect(migrationDdlOnly).not.toMatch(
      /current_objective|milestone|accepted_decision|candidate_action|approval|execution_intent|runtime_result|access_token|installation_token|private_key|client_secret/,
    );
  });

  it("has no update trigger and no mutable freshness or trust-tier column", () => {
    // DDL only: the migration's own doc comments legitimately explain *why*
    // there is no freshness/trust-tier column, which would otherwise trip a
    // naive whole-text search -- the same class of false positive
    // project_records.test.ts already guards against for its own prose.
    expect(migrationDdlOnly).not.toMatch(/update_project_evidence_updated_at/);
    expect(migrationDdlOnly).not.toMatch(/updated_at/);
    expect(migrationDdlOnly).not.toMatch(/freshness/);
    expect(migrationDdlOnly).not.toMatch(/trust_tier/);
  });

  it("is represented in the canonical generated Supabase types", () => {
    expect(generatedTypes).toContain("project_evidence: {");
    expect(generatedTypes).toContain("candidate_fingerprint: string");
    expect(generatedTypes).toContain("supersedes_id: string | null");
    expect(generatedTypes).not.toContain("access_token");
  });
});
