import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../migrations/20260801000000_project_records.sql", import.meta.url),
  "utf8",
);
const migration = migrationSource.toLowerCase();
/** Column/constraint definitions only, with `--` line comments and `comment on table` documentation strings stripped -- the migration's own prose legitimately names excluded concepts (e.g. "no approval field") to explain the boundary, which is not itself evidence of a real column. */
const migrationDdlOnly = migrationSource
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/comment on table[\s\S]*?;/gi, "")
  .toLowerCase();
const generatedTypes = readFileSync(
  new URL("../../src/integrations/supabase/types.ts", import.meta.url),
  "utf8",
);

describe("ProjectRecord migration", () => {
  it("enables RLS and exposes owner-scoped select/insert/update policies only", () => {
    expect(migration).toContain("alter table public.project_records enable row level security");
    expect(migration).toContain("using (auth.uid() = user_id)");
    expect(migration).toContain("with check (auth.uid() = user_id)");
    expect(migration).toContain("for select");
    expect(migration).toContain("for insert");
    expect(migration).toContain("for update");
    expect(migration).not.toMatch(/for delete/);
    expect(migration).toContain("revoke delete on public.project_records from authenticated, anon");
  });

  it("enforces a closed lifecycle and a single supported project type", () => {
    expect(migration).toContain("check (status in ('active', 'archived'))");
    expect(migration).toContain("check (project_type = 'software_project')");
  });

  it("keeps repository binding as all-or-none configuration, never a connection-status or credential field", () => {
    expect(migration).toContain("project_records_repo_binding_all_or_none");
    expect(migration).not.toMatch(/connection_status|access_token|installation_token|private_key|client_secret/);
  });

  it("whitelists evidence source kinds and stores them as configuration only", () => {
    expect(migration).toContain("project_records_evidence_source_kinds_known");
    expect(migration).toContain("verified_repository_state");
  });

  it("has optimistic concurrency via a version column and enforces it via update conditions in application code", () => {
    expect(migration).toContain("version integer not null default 1");
  });

  it("contains no ProjectContext-derived, approval, or execution field", () => {
    expect(migrationDdlOnly).not.toMatch(
      /current_objective|milestone|accepted_decision|candidate_action|approval|execution_intent|runtime_result/,
    );
  });

  it("prevents duplicate active repository bindings per owner", () => {
    expect(migration).toContain("project_records_active_repo_binding_key");
    expect(migration).toContain("where status = 'active' and repo_provider is not null");
  });

  it("is represented in the canonical generated Supabase types", () => {
    expect(generatedTypes).toContain("project_records: {");
    expect(generatedTypes).toContain("enabled_evidence_source_kinds: string[]");
    expect(generatedTypes).toContain("repo_provider: string | null");
    expect(generatedTypes).not.toContain("access_token");
  });
});
