import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../migrations/20260803000000_project_evidence_observations.sql", import.meta.url),
  "utf8",
);
const migration = migrationSource.toLowerCase();
/** Comment/prose-stripped DDL, matching project_evidence.test.ts's own convention -- the migration's own explanatory comments legitimately name excluded concepts to explain the boundary, which is not itself evidence of a real column or grant. */
const migrationDdlOnly = migrationSource
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/comment on table[\s\S]*?;/gi, "")
  .replace(/comment on function[\s\S]*?;/gi, "")
  .toLowerCase();

describe("ProjectEvidenceObservation migration (ADR-0007)", () => {
  it("enables RLS and exposes an owner-scoped select policy only", () => {
    expect(migration).toContain("alter table public.project_evidence_observations enable row level security");
    expect(migration).toContain("using (auth.uid() = user_id)");
    expect(migration).toContain("for select");
    expect(migrationDdlOnly).not.toMatch(/for insert/);
    expect(migrationDdlOnly).not.toMatch(/for update/);
    expect(migrationDdlOnly).not.toMatch(/for delete/);
  });

  it("revokes direct client insert/update/delete on the observations table", () => {
    expect(migration).toContain(
      "revoke insert, update, delete on public.project_evidence_observations from authenticated, anon",
    );
    expect(migration).toContain("grant select on public.project_evidence_observations to authenticated");
  });

  it("removes the old direct-INSERT policy and grant on project_evidence", () => {
    expect(migration).toContain('drop policy if exists "users can create own project evidence" on public.project_evidence');
    expect(migration).toContain("revoke insert on public.project_evidence from authenticated");
  });

  it("enforces a strict 1:1 relationship to project_evidence via a unique evidence_id and a composite foreign key pinning project/owner", () => {
    expect(migration).toContain("evidence_id uuid not null unique");
    expect(migration).toContain(
      "add constraint project_evidence_id_project_id_user_id_key unique (id, project_id, user_id)",
    );
    expect(migration).toMatch(/foreign key \(evidence_id, project_id, user_id\)\s*\n?\s*references public\.project_evidence \(id, project_id, user_id\)/);
  });

  it("closes payload_kind to exactly 'text' in this implementation", () => {
    expect(migration).toContain("payload_kind text not null check (payload_kind = 'text')");
  });

  it("bounds the MIME type to the Markdown/plain-text allowlist", () => {
    expect(migration).toContain("mime_type text not null check (mime_type in ('text/markdown', 'text/plain'))");
  });

  it("bounds byte_length and enforces it matches the actual encoded text length", () => {
    expect(migration).toContain("byte_length integer not null check (byte_length > 0 and byte_length <= 524288)");
    expect(migration).toContain("check (byte_length = octet_length(text_content))");
  });

  it("enforces a lowercase 64-character hex content hash", () => {
    expect(migration).toContain("content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$')");
  });

  it("enforces a structured, optional 40-character hex git_revision, never free text", () => {
    expect(migration).toContain("git_revision text check (git_revision is null or git_revision ~ '^[0-9a-f]{40}$')");
  });

  it("contains no structured JSON payload column, artifact reference, or object-storage path", () => {
    expect(migrationDdlOnly).not.toMatch(/structured_content|artifact_id|artifact_path|storage_path|object_storage/);
  });

  it("defines the atomic create_project_evidence_with_observation function as SECURITY DEFINER with a locked search_path", () => {
    expect(migration).toContain("create or replace function public.create_project_evidence_with_observation");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
  });

  it("grants execute on the function only to authenticated, not to anon or public", () => {
    expect(migration).toContain("grant execute on function public.create_project_evidence_with_observation");
    expect(migration).toMatch(/grant execute on function public\.create_project_evidence_with_observation\([^)]*\)\s*\n?\s*to authenticated/);
    expect(migrationDdlOnly).not.toMatch(/grant execute on function public\.create_project_evidence_with_observation\([^)]*\)\s*\n?\s*to (anon|public)\b/);
  });

  it("resolves the trusted owner from auth.uid() inside the function body, never from a parameter", () => {
    expect(migration).toContain("v_owner_id := auth.uid()");
    expect(migration).not.toMatch(/p_(owner_id|user_id)\s+uuid/);
  });

  it("re-verifies project ownership, archive status, enabled source kind, and supersession scope inside the function", () => {
    expect(migration).toContain("raise exception 'project_not_found'");
    expect(migration).toContain("raise exception 'project_archived'");
    expect(migration).toContain("raise exception 'source_kind_not_enabled'");
    expect(migration).toContain("raise exception 'superseded_evidence_not_found'");
  });

  it("resolves a content-identity fingerprint collision gracefully as unchanged, never lets it propagate as a raw error", () => {
    expect(migration).toContain("exception");
    expect(migration).toContain("when unique_violation then");
    expect(migration).toContain("'outcome', 'unchanged'");
    expect(migration).toContain("'outcome', 'created'");
  });

  // Static substring checks are supplemental only -- they prove this text is
  // present in the migration, never that Postgres actually applies
  // GET STACKED DIAGNOSTICS / RAISE / constraint-name matching correctly at
  // runtime. The real proof is the live-Postgres verification recorded in
  // this review's report (constraint-scoped unique handling and fail-closed
  // pair lookup), not these string matches.
  it("identifies the violated constraint via GET STACKED DIAGNOSTICS rather than assuming every unique_violation is the fingerprint collision", () => {
    expect(migration).toContain("get stacked diagnostics v_constraint_name = constraint_name");
  });

  it("only treats the candidate-fingerprint constraint as an unchanged collision, and re-raises every other unique violation", () => {
    expect(migration).toMatch(
      /if v_constraint_name <> 'project_evidence_candidate_fingerprint_key' then\s*\n\s*raise;\s*\n\s*end if;/,
    );
  });

  it("fails closed with a typed exception when the colliding evidence row cannot be found, rather than returning a null-filled pair", () => {
    expect(migration).toContain("if v_existing_evidence.id is null then");
    expect(migration).toContain("raise exception 'evidence_conflict_lookup_failed'");
  });

  it("fails closed with a typed exception when the colliding evidence row has no paired observation, rather than returning a null-filled observation", () => {
    expect(migration).toContain("if v_existing_observation.id is null then");
    expect(migration).toContain("raise exception 'evidence_missing_observation'");
  });

  it("scopes both the existing-evidence and existing-observation lookups to the resolved owner, not just the project", () => {
    expect(migration).toMatch(
      /where project_id = p_project_id\s*\n\s*and candidate_fingerprint = p_candidate_fingerprint\s*\n\s*and user_id = v_owner_id/,
    );
    expect(migration).toMatch(
      /where evidence_id = v_existing_evidence\.id\s*\n\s*and user_id = v_owner_id\s*\n\s*and project_id = p_project_id/,
    );
  });

  it("documents, without claiming a backfill, that a pre-migration old-formula fingerprint may allow one later duplicate-content pair", () => {
    expect(migration).toContain("a one-time miss per pre-migration row, not a");
    expect(migration).toContain("no backfill has been performed to close this");
  });

  it("is represented in the canonical generated Supabase types", () => {
    const generatedTypes = readFileSync(new URL("../../src/integrations/supabase/types.ts", import.meta.url), "utf8");
    expect(generatedTypes).toContain("project_evidence_observations: {");
    expect(generatedTypes).toContain("content_hash: string");
    expect(generatedTypes).toContain("create_project_evidence_with_observation: {");
  });
});
