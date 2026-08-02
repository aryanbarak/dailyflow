import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Live local Supabase RLS proof for ProjectEvidence ownership and project-
// binding isolation. Gated exactly like
// supabase/tests/project_records.rls.test.ts: skipped by default, only runs
// against a local Supabase instance with SMARTFLOW_RUN_LOCAL_SUPABASE=1 set.

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

function evidencePayload(overrides: Record<string, unknown> = {}) {
  return {
    source_kind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collected_at: "2026-08-02T00:00:00.000Z",
    adapter_identity: "repository-document-adapter",
    adapter_version: "1.0.0",
    verification_method: "deterministic file read",
    candidate_fingerprint: crypto.randomUUID().replace(/-/g, "").repeat(2).slice(0, 64),
    ...overrides,
  };
}

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("ProjectEvidence live local Supabase RLS", () => {
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
    await admin.from("project_evidence").delete().in("user_id", [userA.id, userB.id]);
    await admin.from("project_records").delete().in("user_id", [userA.id, userB.id]);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project_evidence").delete().in("user_id", [userA?.id, userB?.id].filter(Boolean));
    await admin.from("project_records").delete().in("user_id", [userA?.id, userB?.id].filter(Boolean));
    if (userA?.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB?.id) await admin.auth.admin.deleteUser(userB.id);
  });

  async function seedProject(owner: LocalUser, name: string) {
    const inserted = await admin
      .from("project_records")
      .insert({ user_id: owner.id, project_type: "software_project", name })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    return inserted.data!.id as string;
  }

  it("isolates reads: each user sees only their own project evidence", async () => {
    const projectA = await seedProject(userA, "A's project");
    const projectB = await seedProject(userB, "B's project");
    const inserted = await admin.from("project_evidence").insert([
      { user_id: userA.id, project_id: projectA, ...evidencePayload({ title: "A's evidence" }) },
      { user_id: userB.id, project_id: projectB, ...evidencePayload({ title: "B's evidence" }) },
    ]);
    expect(inserted.error).toBeNull();

    const ownRead = await userA.client.from("project_evidence").select("title");
    expect(ownRead.error).toBeNull();
    expect(ownRead.data).toEqual([{ title: "A's evidence" }]);

    const crossRead = await userB.client.from("project_evidence").select("title").eq("user_id", userA.id);
    expect(crossRead.error).toBeNull();
    expect(crossRead.data).toEqual([]);
  });

  it("denies inserting evidence with another user's owner id", async () => {
    const projectA = await seedProject(userA, "A's project");
    const spoofed = await userA.client
      .from("project_evidence")
      .insert({ user_id: userB.id, project_id: projectA, ...evidencePayload() });
    expect(spoofed.error).not.toBeNull();
  });

  it("denies inserting evidence bound to a project owned by another user, even with a matching user_id", async () => {
    const projectB = await seedProject(userB, "B's project");
    const spoofed = await userA.client
      .from("project_evidence")
      .insert({ user_id: userA.id, project_id: projectB, ...evidencePayload() });
    expect(spoofed.error).not.toBeNull();
  });

  it("denies client-side update: there is no update policy at all", async () => {
    const projectA = await seedProject(userA, "A's project");
    const inserted = await admin
      .from("project_evidence")
      .insert({ user_id: userA.id, project_id: projectA, ...evidencePayload() })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const updateAttempt = await userA.client
      .from("project_evidence")
      .update({ title: "Hijacked" })
      .eq("id", inserted.data!.id);
    expect(updateAttempt.error).not.toBeNull();

    const stillOriginal = await admin.from("project_evidence").select("title").eq("id", inserted.data!.id).single();
    expect(stillOriginal.data?.title).toBe("Project Domain");
  });

  it("denies client-side hard delete: there is no delete policy at all", async () => {
    const projectA = await seedProject(userA, "A's project");
    const inserted = await admin
      .from("project_evidence")
      .insert({ user_id: userA.id, project_id: projectA, ...evidencePayload() })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const deleteAttempt = await userA.client.from("project_evidence").delete().eq("id", inserted.data!.id);
    expect(deleteAttempt.error).not.toBeNull();

    const stillExists = await admin.from("project_evidence").select("id").eq("id", inserted.data!.id).maybeSingle();
    expect(stillExists.data).not.toBeNull();
  });

  it("allows supersession of an existing evidence row in the same project owned by the same user", async () => {
    const projectA = await seedProject(userA, "A's project");
    const original = await admin
      .from("project_evidence")
      .insert({ user_id: userA.id, project_id: projectA, ...evidencePayload() })
      .select("id")
      .single();
    expect(original.error).toBeNull();

    const superseding = await userA.client
      .from("project_evidence")
      .insert({
        user_id: userA.id,
        project_id: projectA,
        supersedes_id: original.data!.id,
        ...evidencePayload({ collected_at: "2026-08-03T00:00:00.000Z" }),
      });
    expect(superseding.error).toBeNull();
  });

  it("denies supersession referencing evidence from a different project owned by the same user", async () => {
    const projectA = await seedProject(userA, "A's project");
    const projectA2 = await seedProject(userA, "A's second project");
    const evidenceInA2 = await admin
      .from("project_evidence")
      .insert({ user_id: userA.id, project_id: projectA2, ...evidencePayload() })
      .select("id")
      .single();
    expect(evidenceInA2.error).toBeNull();

    const crossProjectSupersession = await userA.client
      .from("project_evidence")
      .insert({
        user_id: userA.id,
        project_id: projectA,
        supersedes_id: evidenceInA2.data!.id,
        ...evidencePayload({ collected_at: "2026-08-03T00:00:00.000Z" }),
      });
    expect(crossProjectSupersession.error).not.toBeNull();
  });

  it("denies supersession referencing evidence owned by a different user", async () => {
    const projectA = await seedProject(userA, "A's project");
    const projectB = await seedProject(userB, "B's project");
    const evidenceInB = await admin
      .from("project_evidence")
      .insert({ user_id: userB.id, project_id: projectB, ...evidencePayload() })
      .select("id")
      .single();
    expect(evidenceInB.error).toBeNull();

    const crossOwnerSupersession = await userA.client
      .from("project_evidence")
      .insert({
        user_id: userA.id,
        project_id: projectA,
        supersedes_id: evidenceInB.data!.id,
        ...evidencePayload({ collected_at: "2026-08-03T00:00:00.000Z" }),
      });
    expect(crossOwnerSupersession.error).not.toBeNull();
  });

  it("still allows an ordinary insert with no supersedes_id (null remains allowed)", async () => {
    const projectA = await seedProject(userA, "A's project");
    const inserted = await userA.client
      .from("project_evidence")
      .insert({ user_id: userA.id, project_id: projectA, ...evidencePayload() });
    expect(inserted.error).toBeNull();
  });

  it("enforces the candidate-fingerprint uniqueness constraint per project", async () => {
    const projectA = await seedProject(userA, "A's project");
    const payload = evidencePayload();
    const first = await userA.client.from("project_evidence").insert({ user_id: userA.id, project_id: projectA, ...payload });
    expect(first.error).toBeNull();

    const duplicate = await userA.client.from("project_evidence").insert({ user_id: userA.id, project_id: projectA, ...payload });
    expect(duplicate.error).not.toBeNull();
  });
});
