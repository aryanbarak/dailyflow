import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Live local Supabase RLS/RPC proof for ProjectEvidence + ProjectEvidenceObservation
// (ADR-0007: docs/decisions/adr/ADR-0007-projectevidence-observation-model.md).
// Gated exactly like supabase/tests/project_records.rls.test.ts: skipped by
// default, only runs against a local Supabase instance with
// SMARTFLOW_RUN_LOCAL_SUPABASE=1 set.
//
// Direct client `.insert()` into either `project_evidence` or
// `project_evidence_observations` is no longer a supported path (the
// migration revokes it) -- every create in this file goes through the
// `create_project_evidence_with_observation` RPC, exactly as
// projectEvidenceRepository.ts does in production.

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
  const email = `project-evidence-rls-${label}-${crypto.randomUUID()}@smartflow.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Local test user was not created.");

  const client = localClient(ANON_KEY);
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error("Local test user did not receive a session.");
  }
  return { id: data.user.id, client };
}

function rpcArgs(projectId: string, overrides: Record<string, unknown> = {}) {
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
    p_candidate_fingerprint: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
    p_text_content: "# Project Domain\n",
    p_mime_type: "text/markdown",
    p_byte_length: Buffer.byteLength("# Project Domain\n"),
    p_content_hash: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
    ...overrides,
  };
}

async function callCreate(client: SupabaseClient, projectId: string, overrides: Record<string, unknown> = {}) {
  return client.rpc("create_project_evidence_with_observation", rpcArgs(projectId, overrides));
}

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("ProjectEvidence + ProjectEvidenceObservation live local Supabase RLS/RPC", () => {
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
    await admin.from("project_evidence_observations").delete().in("user_id", [userA.id, userB.id]);
    await admin.from("project_evidence").delete().in("user_id", [userA.id, userB.id]);
    await admin.from("project_records").delete().in("user_id", [userA.id, userB.id]);
  });

  afterAll(async () => {
    if (!admin) return;
    const ids = [userA?.id, userB?.id].filter(Boolean);
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

  describe("atomic create via RPC", () => {
    it("creates a paired ProjectEvidence + ProjectEvidenceObservation row and returns both", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const result = await callCreate(userA.client, projectA);
      expect(result.error).toBeNull();
      const payload = result.data as { outcome: string; evidence: { id: string }; observation: { id: string; text_content: string } };
      expect(payload.outcome).toBe("created");
      expect(payload.evidence.id).toBeTruthy();
      expect(payload.observation.id).toBeTruthy();
      expect(payload.observation.text_content).toBe("# Project Domain\n");

      const evidenceRow = await admin.from("project_evidence").select("id").eq("id", payload.evidence.id).maybeSingle();
      expect(evidenceRow.data).not.toBeNull();
      const observationRow = await admin
        .from("project_evidence_observations")
        .select("evidence_id")
        .eq("id", payload.observation.id)
        .maybeSingle();
      expect(observationRow.data?.evidence_id).toBe(payload.evidence.id);
    });

    it("rejects creation for a project owned by another user, without disclosure", async () => {
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const result = await callCreate(userA.client, projectB);
      expect(result.error).not.toBeNull();
    });

    it("rejects creation for an archived project", async () => {
      const projectA = await seedProject(userA, "A's project", {
        status: "archived",
        enabled_evidence_source_kinds: ["architecture_document"],
      });
      const result = await callCreate(userA.client, projectA);
      expect(result.error).not.toBeNull();
    });

    it("rejects creation for a source kind not enabled on the project", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["adr"] });
      const result = await callCreate(userA.client, projectA);
      expect(result.error).not.toBeNull();
    });

    it("rejects unauthenticated (anonymous) creation", async () => {
      const anon = localClient(ANON_KEY);
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const result = await callCreate(anon, projectA);
      expect(result.error).not.toBeNull();
    });
  });

  describe("supersession via RPC", () => {
    it("allows supersession of an existing evidence row in the same project owned by the same user", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const original = await callCreate(userA.client, projectA);
      expect(original.error).toBeNull();
      const originalId = (original.data as { evidence: { id: string } }).evidence.id;

      const superseding = await callCreate(userA.client, projectA, {
        p_supersedes_id: originalId,
        p_candidate_fingerprint: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
        p_content_hash: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
        p_text_content: "# Project Domain (updated)\n",
        p_byte_length: Buffer.byteLength("# Project Domain (updated)\n"),
      });
      expect(superseding.error).toBeNull();
      expect((superseding.data as { outcome: string }).outcome).toBe("created");
    });

    it("denies supersession referencing evidence from a different project owned by the same user", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const projectA2 = await seedProject(userA, "A's second project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceInA2 = await callCreate(userA.client, projectA2);
      expect(evidenceInA2.error).toBeNull();

      const crossProjectSupersession = await callCreate(userA.client, projectA, {
        p_supersedes_id: (evidenceInA2.data as { evidence: { id: string } }).evidence.id,
        p_candidate_fingerprint: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
      });
      expect(crossProjectSupersession.error).not.toBeNull();
    });

    it("denies supersession referencing evidence owned by a different user", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const evidenceInB = await callCreate(userB.client, projectB);
      expect(evidenceInB.error).toBeNull();

      const crossOwnerSupersession = await callCreate(userA.client, projectA, {
        p_supersedes_id: (evidenceInB.data as { evidence: { id: string } }).evidence.id,
        p_candidate_fingerprint: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
      });
      expect(crossOwnerSupersession.error).not.toBeNull();
    });

    it("still allows an ordinary create with no supersedes_id (null remains allowed)", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const result = await callCreate(userA.client, projectA);
      expect(result.error).toBeNull();
    });
  });

  describe("content-hash-based duplicate identity (ADR-0007)", () => {
    it("returns an 'unchanged' outcome, not an error, for an exact resubmission -- and creates no second pair", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const fingerprint = crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64);
      const first = await callCreate(userA.client, projectA, { p_candidate_fingerprint: fingerprint });
      expect(first.error).toBeNull();
      expect((first.data as { outcome: string }).outcome).toBe("created");

      const second = await callCreate(userA.client, projectA, { p_candidate_fingerprint: fingerprint });
      expect(second.error).toBeNull();
      expect((second.data as { outcome: string }).outcome).toBe("unchanged");
      expect((second.data as { evidence: { id: string } }).evidence.id).toBe(
        (first.data as { evidence: { id: string } }).evidence.id,
      );

      const allEvidence = await admin.from("project_evidence").select("id").eq("project_id", projectA);
      expect(allEvidence.data).toHaveLength(1);
    });

    it("permits only one canonical pair when two concurrent creates use the identical content-identity fingerprint", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const fingerprint = crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64);

      const [first, second] = await Promise.all([
        callCreate(userA.client, projectA, { p_candidate_fingerprint: fingerprint }),
        callCreate(userA.client, projectA, { p_candidate_fingerprint: fingerprint }),
      ]);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      const outcomes = [
        (first.data as { outcome: string }).outcome,
        (second.data as { outcome: string }).outcome,
      ].sort();
      expect(outcomes).toEqual(["created", "unchanged"]);

      const allEvidence = await admin.from("project_evidence").select("id").eq("project_id", projectA);
      expect(allEvidence.data).toHaveLength(1);
    });
  });

  describe("read isolation and no alternate write path", () => {
    it("isolates reads: each user sees only their own evidence and observations", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const projectB = await seedProject(userB, "B's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      await callCreate(userA.client, projectA);
      await callCreate(userB.client, projectB);

      const ownRead = await userA.client.from("project_evidence").select("title");
      expect(ownRead.error).toBeNull();
      expect(ownRead.data).toEqual([{ title: "Project Domain" }]);

      const crossRead = await userB.client.from("project_evidence").select("title").eq("user_id", userA.id);
      expect(crossRead.error).toBeNull();
      expect(crossRead.data).toEqual([]);

      const ownObservationRead = await userA.client.from("project_evidence_observations").select("id");
      expect(ownObservationRead.error).toBeNull();
      expect(ownObservationRead.data).toHaveLength(1);

      const crossObservationRead = await userB.client
        .from("project_evidence_observations")
        .select("id")
        .eq("user_id", userA.id);
      expect(crossObservationRead.error).toBeNull();
      expect(crossObservationRead.data).toEqual([]);
    });

    it("denies a direct client insert into project_evidence -- the RPC is the only write path", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const direct = await userA.client.from("project_evidence").insert({
        user_id: userA.id,
        project_id: projectA,
        source_kind: "architecture_document",
        classification: "canonical_document_observation",
        title: "Direct insert attempt",
        reference: "docs/architecture/project-domain.md",
        collected_at: "2026-08-02T00:00:00.000Z",
        adapter_identity: "repository-document-adapter",
        adapter_version: "1.0.0",
        verification_method: "deterministic file read",
        candidate_fingerprint: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
      });
      expect(direct.error).not.toBeNull();
    });

    it("denies a direct client insert into project_evidence_observations, even referencing a real evidence row", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const created = await callCreate(userA.client, projectA);
      expect(created.error).toBeNull();
      const evidenceId = (created.data as { evidence: { id: string } }).evidence.id;

      const direct = await userA.client.from("project_evidence_observations").insert({
        evidence_id: evidenceId,
        user_id: userA.id,
        project_id: projectA,
        payload_kind: "text",
        text_content: "hijacked content",
        mime_type: "text/markdown",
        byte_length: Buffer.byteLength("hijacked content"),
        content_hash: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
      });
      expect(direct.error).not.toBeNull();
    });

    it("denies client-side update on either table: there is no update policy at all", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const created = await callCreate(userA.client, projectA);
      expect(created.error).toBeNull();
      const { evidence, observation } = created.data as { evidence: { id: string }; observation: { id: string } };

      const evidenceUpdate = await userA.client.from("project_evidence").update({ title: "Hijacked" }).eq("id", evidence.id);
      expect(evidenceUpdate.error).not.toBeNull();

      const observationUpdate = await userA.client
        .from("project_evidence_observations")
        .update({ text_content: "Hijacked" })
        .eq("id", observation.id);
      expect(observationUpdate.error).not.toBeNull();
    });

    it("denies client-side hard delete on either table: there is no delete policy at all", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      const created = await callCreate(userA.client, projectA);
      expect(created.error).toBeNull();
      const { evidence, observation } = created.data as { evidence: { id: string }; observation: { id: string } };

      const evidenceDelete = await userA.client.from("project_evidence").delete().eq("id", evidence.id);
      expect(evidenceDelete.error).not.toBeNull();

      const observationDelete = await userA.client.from("project_evidence_observations").delete().eq("id", observation.id);
      expect(observationDelete.error).not.toBeNull();

      const stillExists = await admin.from("project_evidence").select("id").eq("id", evidence.id).maybeSingle();
      expect(stillExists.data).not.toBeNull();
    });

    it("denies anonymous reads of either table", async () => {
      const projectA = await seedProject(userA, "A's project", { enabled_evidence_source_kinds: ["architecture_document"] });
      await callCreate(userA.client, projectA);

      const anon = localClient(ANON_KEY);
      const evidenceRead = await anon.from("project_evidence").select("id");
      expect(evidenceRead.data).toEqual([]);
      const observationRead = await anon.from("project_evidence_observations").select("id");
      expect(observationRead.data).toEqual([]);
    });
  });
});
