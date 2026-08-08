import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Live local Supabase RLS/RPC proof for InferredProjectContextField
// (ADR-0009: docs/decisions/adr/ADR-0009-inferred-project-context-layer.md).
// Gated exactly like supabase/tests/project_evidence.rls.test.ts and
// supabase/tests/project_records.rls.test.ts: skipped by default, only runs
// against a local Supabase instance with SMARTFLOW_RUN_LOCAL_SUPABASE=1 set.
//
// Added by review finding F1/MAJOR #1
// (docs/reviews/2026-08-inferred-context-layer-review.md): task 3b's own
// verification of create_inferred_context_field/resolve_inferred_context_field
// ran once against a disposable, non-Supabase Postgres container, then that
// container was destroyed -- leaving zero committed, repeatable regression
// protection for this table's SECURITY DEFINER functions and RLS, unlike
// every other RLS-backed table in this codebase. This file closes that gap,
// following project_evidence.rls.test.ts's exact convention.
//
// Direct client `.insert()`/`.update()` into `inferred_project_context_fields`
// is not a supported path (the migration revokes it) -- every write in this
// file goes through create_inferred_context_field / resolve_inferred_context_field,
// exactly as inferredProjectContextFieldRepository.ts does in production.
// `inferred_context_derivation_runs` DOES support a direct owner-scoped
// insert/update (no SECURITY DEFINER needed for that table -- see the
// migration's own comment), exactly as inferredProjectContextFieldRepository.ts's
// createRun/completeRun do.

const RUN_LOCAL = process.env.SMARTFLOW_RUN_LOCAL_SUPABASE === "1";
const API_URL = process.env.SMARTFLOW_LOCAL_SUPABASE_URL ?? "";
const ANON_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "SmartFlow-local-RLS-2026!";

interface LocalUser {
  id: string;
  client: SupabaseClient;
}

function localClient(key: string) {
  return createClient(API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createLocalUser(admin: SupabaseClient, label: string): Promise<LocalUser> {
  const email = `inferred-context-rls-${label}-${crypto.randomUUID()}@smartflow.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Local test user was not created.");

  const client = localClient(ANON_KEY);
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error("Local test user did not receive a session.");
  }
  return { id: data.user.id, client };
}

function fingerprint(): string {
  return crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64);
}

function evidenceRpcArgs(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    p_project_id: projectId,
    p_source_kind: "architecture_document",
    p_classification: "canonical_document_observation",
    p_title: "Project Domain",
    p_reference: "docs/architecture/project-domain.md",
    p_collected_at: "2026-08-02T00:00:00.000Z",
    p_adapter_identity: "repository-document-adapter",
    p_adapter_version: "1.0.0",
    p_verification_method: "deterministic file read",
    p_candidate_fingerprint: fingerprint(),
    p_text_content: "# Project Domain\n",
    p_mime_type: "text/markdown",
    p_byte_length: Buffer.byteLength("# Project Domain\n"),
    p_content_hash: fingerprint(),
    ...overrides,
  };
}

async function callCreateEvidence(client: SupabaseClient, projectId: string, overrides: Record<string, unknown> = {}) {
  return client.rpc("create_project_evidence_with_observation", evidenceRpcArgs(projectId, overrides));
}

function fieldRpcArgs(projectId: string, runId: string, evidenceIds: readonly string[], overrides: Record<string, unknown> = {}) {
  return {
    p_project_id: projectId,
    p_run_id: runId,
    p_kind: "risk",
    p_content: { summary: "Data loss risk", severity: "high" },
    p_source_evidence_ids: evidenceIds,
    p_model_identity: "gemini-test",
    p_derivation_version: "context-derivation-v1",
    p_confidence: "medium",
    p_content_fingerprint: fingerprint(),
    ...overrides,
  };
}

async function callCreateField(
  client: SupabaseClient,
  projectId: string,
  runId: string,
  evidenceIds: readonly string[],
  overrides: Record<string, unknown> = {},
) {
  return client.rpc("create_inferred_context_field", fieldRpcArgs(projectId, runId, evidenceIds, overrides));
}

function resolveRpcArgs(fieldId: string, action: string, overrides: Record<string, unknown> = {}) {
  return {
    p_field_id: fieldId,
    p_action: action,
    p_corrected_content: null,
    p_corrected_content_fingerprint: null,
    ...overrides,
  };
}

async function callResolveField(client: SupabaseClient, fieldId: string, action: string, overrides: Record<string, unknown> = {}) {
  return client.rpc("resolve_inferred_context_field", resolveRpcArgs(fieldId, action, overrides));
}

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("InferredProjectContextField live local Supabase RLS/RPC", () => {
  let admin: SupabaseClient;
  let userA: LocalUser;
  let userB: LocalUser;

  beforeAll(async () => {
    if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error("Local Supabase test environment is incomplete.");
    }
    admin = localClient(SERVICE_ROLE_KEY);
    userA = await createLocalUser(admin, "a");
    userB = await createLocalUser(admin, "b");
  });

  beforeEach(async () => {
    const ids = [userA.id, userB.id];
    await admin.from("inferred_project_context_fields").delete().in("user_id", ids);
    await admin.from("inferred_context_derivation_runs").delete().in("user_id", ids);
    await admin.from("project_evidence_observations").delete().in("user_id", ids);
    await admin.from("project_evidence").delete().in("user_id", ids);
    await admin.from("project_records").delete().in("user_id", ids);
  });

  afterAll(async () => {
    if (!admin) return;
    const ids = [userA?.id, userB?.id].filter(Boolean);
    await admin.from("inferred_project_context_fields").delete().in("user_id", ids);
    await admin.from("inferred_context_derivation_runs").delete().in("user_id", ids);
    await admin.from("project_evidence_observations").delete().in("user_id", ids);
    await admin.from("project_evidence").delete().in("user_id", ids);
    await admin.from("project_records").delete().in("user_id", ids);
    if (userA?.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB?.id) await admin.auth.admin.deleteUser(userB.id);
  });

  async function seedProject(owner: LocalUser, name: string, overrides: Record<string, unknown> = {}) {
    const inserted = await admin
      .from("project_records")
      .insert({ user_id: owner.id, project_type: "software_project", name, ...overrides })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    return inserted.data!.id as string;
  }

  async function seedEvidence(owner: LocalUser, projectId: string): Promise<string> {
    const result = await callCreateEvidence(owner.client, projectId);
    expect(result.error).toBeNull();
    return (result.data as { evidence: { id: string } }).evidence.id;
  }

  async function seedRun(owner: LocalUser, projectId: string): Promise<string> {
    const inserted = await owner.client
      .from("inferred_context_derivation_runs")
      .insert({ project_id: projectId, model_identity: "gemini-test", derivation_version: "context-derivation-v1", started_at: new Date().toISOString() })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    return inserted.data!.id as string;
  }

  describe("happy path", () => {
    it("creates a proposed, model-authored field and returns it", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);

      const result = await callCreateField(userA.client, projectA, runId, [evidenceId]);
      expect(result.error).toBeNull();
      const payload = result.data as { outcome: string; field: { id: string; status: string; source: string } };
      expect(payload.outcome).toBe("created");
      expect(payload.field.status).toBe("proposed");
      expect(payload.field.source).toBe("model");

      const row = await admin.from("inferred_project_context_fields").select("id").eq("id", payload.field.id).maybeSingle();
      expect(row.data).not.toBeNull();
    });
  });

  describe("duplicate suppression (ADR-0009 Q1/Q5)", () => {
    it("returns duplicate_suppressed, not a second row, for an exact resubmission from a different run", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId1 = await seedRun(userA, projectA);
      const runId2 = await seedRun(userA, projectA);
      const sharedFingerprint = fingerprint();

      const first = await callCreateField(userA.client, projectA, runId1, [evidenceId], { p_content_fingerprint: sharedFingerprint });
      expect(first.error).toBeNull();
      expect((first.data as { outcome: string }).outcome).toBe("created");

      const second = await callCreateField(userA.client, projectA, runId2, [evidenceId], { p_content_fingerprint: sharedFingerprint });
      expect(second.error).toBeNull();
      expect((second.data as { outcome: string }).outcome).toBe("duplicate_suppressed");
      expect((second.data as { field: { id: string } }).field.id).toBe((first.data as { field: { id: string } }).field.id);

      const rows = await admin.from("inferred_project_context_fields").select("id").eq("project_id", projectA);
      expect(rows.data).toHaveLength(1);
    });

    it("still suppresses a duplicate even when the existing row was already user_rejected", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId1 = await seedRun(userA, projectA);
      const runId2 = await seedRun(userA, projectA);
      const sharedFingerprint = fingerprint();

      const first = await callCreateField(userA.client, projectA, runId1, [evidenceId], { p_content_fingerprint: sharedFingerprint });
      expect(first.error).toBeNull();
      const fieldId = (first.data as { field: { id: string } }).field.id;

      const rejected = await callResolveField(userA.client, fieldId, "reject");
      expect(rejected.error).toBeNull();
      expect((rejected.data as { outcome: string }).outcome).toBe("user_rejected");

      const second = await callCreateField(userA.client, projectA, runId2, [evidenceId], { p_content_fingerprint: sharedFingerprint });
      expect(second.error).toBeNull();
      expect((second.data as { outcome: string }).outcome).toBe("duplicate_suppressed");
      expect((second.data as { field: { id: string; status: string } }).field.status).toBe("user_rejected");
    });

    it("review finding F3: two concurrent creates with the identical fingerprint never both succeed and never fail with an unhandled error -- exactly one created, one duplicate_suppressed", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId1 = await seedRun(userA, projectA);
      const runId2 = await seedRun(userA, projectA);
      const sharedFingerprint = fingerprint();

      const [first, second] = await Promise.all([
        callCreateField(userA.client, projectA, runId1, [evidenceId], { p_content_fingerprint: sharedFingerprint }),
        callCreateField(userA.client, projectA, runId2, [evidenceId], { p_content_fingerprint: sharedFingerprint }),
      ]);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      const outcomes = [(first.data as { outcome: string }).outcome, (second.data as { outcome: string }).outcome].sort();
      expect(outcomes).toEqual(["created", "duplicate_suppressed"]);

      const rows = await admin.from("inferred_project_context_fields").select("id").eq("project_id", projectA);
      expect(rows.data).toHaveLength(1);
    });
  });

  describe("evidence linkage (ADR-0009: invalid by construction)", () => {
    it("rejects an empty source_evidence_ids array", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const runId = await seedRun(userA, projectA);
      const result = await callCreateField(userA.client, projectA, runId, []);
      expect(result.error).not.toBeNull();
    });

    it("rejects a source_evidence_id that does not exist or belongs to another project/owner", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceInB = await seedEvidence(userB, projectB);
      const runId = await seedRun(userA, projectA);

      const result = await callCreateField(userA.client, projectA, runId, [evidenceInB]);
      expect(result.error).not.toBeNull();
    });
  });

  describe("narrow automatic supersession (ADR-0009 Decision section 1)", () => {
    it("supersedes an older still-proposed objective from a different run", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId1 = await seedRun(userA, projectA);
      const runId2 = await seedRun(userA, projectA);

      const older = await callCreateField(userA.client, projectA, runId1, [evidenceId], {
        p_kind: "objective",
        p_content: { summary: "Ship v1", status: "active" },
      });
      expect(older.error).toBeNull();
      const olderId = (older.data as { field: { id: string } }).field.id;

      const newer = await callCreateField(userA.client, projectA, runId2, [evidenceId], {
        p_kind: "objective",
        p_content: { summary: "Ship v2", status: "active" },
      });
      expect(newer.error).toBeNull();
      expect((newer.data as { field: { supersedes_id: string } }).field.supersedes_id).toBe(olderId);

      const olderRow = await admin.from("inferred_project_context_fields").select("status").eq("id", olderId).single();
      expect(olderRow.data?.status).toBe("superseded");
    });

    it("never supersedes a risk (no single-slot concept for this kind)", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId1 = await seedRun(userA, projectA);
      const runId2 = await seedRun(userA, projectA);

      const first = await callCreateField(userA.client, projectA, runId1, [evidenceId], {
        p_kind: "risk",
        p_content: { summary: "Data loss risk", severity: "high" },
      });
      expect(first.error).toBeNull();
      const firstId = (first.data as { field: { id: string } }).field.id;

      const second = await callCreateField(userA.client, projectA, runId2, [evidenceId], {
        p_kind: "risk",
        p_content: { summary: "Vendor lock-in risk", severity: "medium" },
      });
      expect(second.error).toBeNull();

      const firstRow = await admin.from("inferred_project_context_fields").select("status").eq("id", firstId).single();
      expect(firstRow.data?.status).toBe("proposed");
    });

    it("never supersedes a user_confirmed or user_corrected objective -- confirmed unreachable by automatic supersession", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId1 = await seedRun(userA, projectA);
      const runId2 = await seedRun(userA, projectA);

      const confirmed = await callCreateField(userA.client, projectA, runId1, [evidenceId], {
        p_kind: "objective",
        p_content: { summary: "Ship v1", status: "active" },
      });
      expect(confirmed.error).toBeNull();
      const confirmedId = (confirmed.data as { field: { id: string } }).field.id;
      const resolved = await callResolveField(userA.client, confirmedId, "confirm");
      expect(resolved.error).toBeNull();

      const newer = await callCreateField(userA.client, projectA, runId2, [evidenceId], {
        p_kind: "objective",
        p_content: { summary: "Ship v2", status: "active" },
      });
      expect(newer.error).toBeNull();

      const confirmedRow = await admin.from("inferred_project_context_fields").select("status").eq("id", confirmedId).single();
      expect(confirmedRow.data?.status).toBe("user_confirmed");
    });
  });

  describe("resolve transitions", () => {
    async function seedProposedField(owner: LocalUser, projectId: string, evidenceId: string, runId: string) {
      const result = await callCreateField(owner.client, projectId, runId, [evidenceId]);
      expect(result.error).toBeNull();
      return (result.data as { field: { id: string } }).field.id;
    }

    it("confirm: sets status to user_confirmed, content unchanged", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);
      const fieldId = await seedProposedField(userA, projectA, evidenceId, runId);

      const result = await callResolveField(userA.client, fieldId, "confirm");
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("user_confirmed");

      const row = await admin.from("inferred_project_context_fields").select("status,content").eq("id", fieldId).single();
      expect(row.data?.status).toBe("user_confirmed");
      expect(row.data?.content).toEqual({ summary: "Data loss risk", severity: "high" });
    });

    it("reject: sets status to user_rejected, no new row", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);
      const fieldId = await seedProposedField(userA, projectA, evidenceId, runId);

      const result = await callResolveField(userA.client, fieldId, "reject");
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("user_rejected");

      const rows = await admin.from("inferred_project_context_fields").select("id").eq("project_id", projectA);
      expect(rows.data).toHaveLength(1);
    });

    it("correct: original row becomes user_corrected (content never mutated), a NEW source=user row is inserted", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);
      const fieldId = await seedProposedField(userA, projectA, evidenceId, runId);
      const correctedContent = { summary: "Data loss risk (corrected)", severity: "low" };

      const result = await callResolveField(userA.client, fieldId, "correct", {
        p_corrected_content: correctedContent,
        p_corrected_content_fingerprint: fingerprint(),
      });
      expect(result.error).toBeNull();
      const payload = result.data as { outcome: string; field: { id: string; source: string; status: string; supersedes_id: string; content: unknown } };
      expect(payload.outcome).toBe("user_corrected");
      expect(payload.field.id).not.toBe(fieldId);
      expect(payload.field.source).toBe("user");
      expect(payload.field.status).toBe("user_confirmed");
      expect(payload.field.supersedes_id).toBe(fieldId);
      expect(payload.field.content).toEqual(correctedContent);

      const originalRow = await admin.from("inferred_project_context_fields").select("status,content").eq("id", fieldId).single();
      expect(originalRow.data?.status).toBe("user_corrected");
      expect(originalRow.data?.content).toEqual({ summary: "Data loss risk", severity: "high" });

      const rows = await admin.from("inferred_project_context_fields").select("id").eq("project_id", projectA);
      expect(rows.data).toHaveLength(2);
    });

    it("a field already resolved cannot be resolved again", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);
      const fieldId = await seedProposedField(userA, projectA, evidenceId, runId);

      const first = await callResolveField(userA.client, fieldId, "confirm");
      expect(first.error).toBeNull();

      const second = await callResolveField(userA.client, fieldId, "reject");
      expect(second.error).not.toBeNull();
    });
  });

  describe("cross-owner isolation", () => {
    it("denies create against a project owned by another user, without disclosure", async () => {
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceInB = await seedEvidence(userB, projectB);
      const runInB = await seedRun(userB, projectB);

      const result = await callCreateField(userA.client, projectB, runInB, [evidenceInB]);
      expect(result.error).not.toBeNull();
    });

    it("denies resolve against a field owned by another user, without disclosure", async () => {
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceInB = await seedEvidence(userB, projectB);
      const runInB = await seedRun(userB, projectB);
      const created = await callCreateField(userB.client, projectB, runInB, [evidenceInB]);
      expect(created.error).toBeNull();
      const fieldId = (created.data as { field: { id: string } }).field.id;

      const result = await callResolveField(userA.client, fieldId, "confirm");
      expect(result.error).not.toBeNull();
    });

    it("isolates reads: each user sees only their own inferred context fields (RLS)", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceInA = await seedEvidence(userA, projectA);
      const evidenceInB = await seedEvidence(userB, projectB);
      const runInA = await seedRun(userA, projectA);
      const runInB = await seedRun(userB, projectB);
      await callCreateField(userA.client, projectA, runInA, [evidenceInA]);
      await callCreateField(userB.client, projectB, runInB, [evidenceInB]);

      const ownRead = await userA.client.from("inferred_project_context_fields").select("id");
      expect(ownRead.error).toBeNull();
      expect(ownRead.data).toHaveLength(1);

      const crossRead = await userB.client.from("inferred_project_context_fields").select("id").eq("user_id", userA.id);
      expect(crossRead.error).toBeNull();
      expect(crossRead.data).toEqual([]);
    });

    it("denies a direct client insert into inferred_project_context_fields -- the RPCs are the only write path", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const direct = await userA.client.from("inferred_project_context_fields").insert({
        user_id: userA.id,
        project_id: projectA,
        kind: "risk",
        content: { summary: "Direct insert attempt", severity: "low" },
        source_evidence_ids: [],
        model_identity: "attacker",
        derivation_version: "v1",
        confidence: "low",
        source: "model",
        content_fingerprint: fingerprint(),
      });
      expect(direct.error).not.toBeNull();
    });

    it("denies client-side update on inferred_project_context_fields: there is no update policy at all", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);
      const created = await callCreateField(userA.client, projectA, runId, [evidenceId]);
      expect(created.error).toBeNull();
      const fieldId = (created.data as { field: { id: string } }).field.id;

      const update = await userA.client.from("inferred_project_context_fields").update({ status: "user_confirmed" }).eq("id", fieldId);
      expect(update.error).not.toBeNull();
    });
  });

  describe("unauthenticated and archived-project rejection", () => {
    it("rejects unauthenticated (anonymous) create and resolve", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceId = await seedEvidence(userA, projectA);
      const runId = await seedRun(userA, projectA);
      const anon = localClient(ANON_KEY);

      const createResult = await callCreateField(anon, projectA, runId, [evidenceId]);
      expect(createResult.error).not.toBeNull();

      const created = await callCreateField(userA.client, projectA, runId, [evidenceId]);
      expect(created.error).toBeNull();
      const fieldId = (created.data as { field: { id: string } }).field.id;
      const resolveResult = await callResolveField(anon, fieldId, "confirm");
      expect(resolveResult.error).not.toBeNull();
    });

    it("rejects creation for an archived project", async () => {
      const projectA = await seedProject(userA, "A's project", {
        status: "archived",
        enabled_evidence_source_kinds: ["architecture_document"],
      });
      const runId = await seedRun(userA, projectA);
      const result = await callCreateField(userA.client, projectA, runId, []);
      expect(result.error).not.toBeNull();
    });
  });
});
