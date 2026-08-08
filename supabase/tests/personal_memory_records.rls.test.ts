import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Live local Supabase RLS/RPC proof for PersonalMemoryRecord
// (ADR-0010: docs/decisions/adr/ADR-0010-personal-memory-layer.md).
// Gated exactly like supabase/tests/inferred_project_context_fields.rls.test.ts:
// skipped by default, only runs against a local Supabase instance with
// SMARTFLOW_RUN_LOCAL_SUPABASE=1 set. Written from the start (task 5b), not
// added after a review finding.
//
// Direct client `.insert()`/`.update()`/`.delete()` into
// personal_memory_records is not a supported path (the migration revokes
// it) -- every write in this file goes through create_personal_memory_record /
// resolve_personal_memory_record / delete_personal_memory_record, exactly as
// personalMemoryRecordRepository.ts does in production.
// `personal_memory_extraction_runs` DOES support a direct owner-scoped
// insert/update (no SECURITY DEFINER needed for that table), exactly as
// personalMemoryRecordRepository.ts's createRun/completeRun do.

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
  const email = `personal-memory-rls-${label}-${crypto.randomUUID()}@smartflow.local`;
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

function recordRpcArgs(runId: string, refIds: readonly string[], overrides: Record<string, unknown> = {}) {
  return {
    p_run_id: runId,
    p_kind: "preference",
    p_content: { summary: "Prefers async written updates" },
    p_provenance_source_kind: "chat_turn",
    p_provenance_source_ref_ids: refIds,
    p_model_identity: "gemini-test",
    p_derivation_version: "personal-memory-extraction-v1",
    p_confidence: "medium",
    p_content_fingerprint: fingerprint(),
    ...overrides,
  };
}

async function callCreateRecord(client: SupabaseClient, runId: string, refIds: readonly string[], overrides: Record<string, unknown> = {}) {
  return client.rpc("create_personal_memory_record", recordRpcArgs(runId, refIds, overrides));
}

function resolveRpcArgs(recordId: string, action: string, overrides: Record<string, unknown> = {}) {
  return {
    p_record_id: recordId,
    p_action: action,
    p_corrected_content: null,
    p_corrected_content_fingerprint: null,
    ...overrides,
  };
}

async function callResolveRecord(client: SupabaseClient, recordId: string, action: string, overrides: Record<string, unknown> = {}) {
  return client.rpc("resolve_personal_memory_record", resolveRpcArgs(recordId, action, overrides));
}

async function callDeleteRecord(client: SupabaseClient, recordId: string) {
  return client.rpc("delete_personal_memory_record", { p_record_id: recordId });
}

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("PersonalMemoryRecord live local Supabase RLS/RPC", () => {
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
    await admin.from("personal_memory_records").delete().in("user_id", ids);
    await admin.from("personal_memory_extraction_runs").delete().in("user_id", ids);
    await admin.from("agent_chat_messages").delete().in("user_id", ids);
  });

  afterAll(async () => {
    if (!admin) return;
    const ids = [userA?.id, userB?.id].filter(Boolean);
    await admin.from("personal_memory_records").delete().in("user_id", ids);
    await admin.from("personal_memory_extraction_runs").delete().in("user_id", ids);
    await admin.from("agent_chat_messages").delete().in("user_id", ids);
    if (userA?.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB?.id) await admin.auth.admin.deleteUser(userB.id);
  });

  async function seedChatMessage(owner: LocalUser): Promise<string> {
    const inserted = await owner.client
      .from("agent_chat_messages")
      .insert({ user_id: owner.id, role: "user", content: "I prefer async written updates over calls." })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    return inserted.data!.id as string;
  }

  async function seedRun(owner: LocalUser): Promise<string> {
    const inserted = await owner.client
      .from("personal_memory_extraction_runs")
      .insert({ model_identity: "gemini-test", derivation_version: "personal-memory-extraction-v1", started_at: new Date().toISOString() })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    return inserted.data!.id as string;
  }

  describe("happy path", () => {
    it("creates a proposed, model-authored record and returns it", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);

      const result = await callCreateRecord(userA.client, runId, [chatId]);
      expect(result.error).toBeNull();
      const payload = result.data as { outcome: string; field: { id: string; status: string; source: string } };
      expect(payload.outcome).toBe("created");
      expect(payload.field.status).toBe("proposed");
      expect(payload.field.source).toBe("model");

      const row = await admin.from("personal_memory_records").select("id").eq("id", payload.field.id).maybeSingle();
      expect(row.data).not.toBeNull();
    });
  });

  describe("duplicate suppression (ADR-0010 citing ADR-0009 Q1/Q5)", () => {
    it("returns duplicate_suppressed, not a second row, for an exact resubmission from a different run", async () => {
      const chatId = await seedChatMessage(userA);
      const runId1 = await seedRun(userA);
      const runId2 = await seedRun(userA);
      const sharedFingerprint = fingerprint();

      const first = await callCreateRecord(userA.client, runId1, [chatId], { p_content_fingerprint: sharedFingerprint });
      expect(first.error).toBeNull();
      expect((first.data as { outcome: string }).outcome).toBe("created");

      const second = await callCreateRecord(userA.client, runId2, [chatId], { p_content_fingerprint: sharedFingerprint });
      expect(second.error).toBeNull();
      expect((second.data as { outcome: string }).outcome).toBe("duplicate_suppressed");
      expect((second.data as { field: { id: string } }).field.id).toBe((first.data as { field: { id: string } }).field.id);

      const rows = await admin.from("personal_memory_records").select("id").eq("user_id", userA.id);
      expect(rows.data).toHaveLength(1);
    });

    it("still suppresses a duplicate even when the existing row was already user_rejected", async () => {
      const chatId = await seedChatMessage(userA);
      const runId1 = await seedRun(userA);
      const runId2 = await seedRun(userA);
      const sharedFingerprint = fingerprint();

      const first = await callCreateRecord(userA.client, runId1, [chatId], { p_content_fingerprint: sharedFingerprint });
      expect(first.error).toBeNull();
      const recordId = (first.data as { field: { id: string } }).field.id;

      const rejected = await callResolveRecord(userA.client, recordId, "reject");
      expect(rejected.error).toBeNull();

      const second = await callCreateRecord(userA.client, runId2, [chatId], { p_content_fingerprint: sharedFingerprint });
      expect(second.error).toBeNull();
      expect((second.data as { outcome: string }).outcome).toBe("duplicate_suppressed");
    });

    it("does NOT suppress a duplicate once the original row has been hard-deleted -- ADR-0010 Q1: forget means forget", async () => {
      const chatId = await seedChatMessage(userA);
      const runId1 = await seedRun(userA);
      const runId2 = await seedRun(userA);
      const sharedFingerprint = fingerprint();

      const first = await callCreateRecord(userA.client, runId1, [chatId], { p_content_fingerprint: sharedFingerprint });
      expect(first.error).toBeNull();
      const recordId = (first.data as { field: { id: string } }).field.id;

      const deleted = await callDeleteRecord(userA.client, recordId);
      expect(deleted.error).toBeNull();
      expect((deleted.data as { outcome: string }).outcome).toBe("deleted");

      const second = await callCreateRecord(userA.client, runId2, [chatId], { p_content_fingerprint: sharedFingerprint });
      expect(second.error).toBeNull();
      expect((second.data as { outcome: string }).outcome).toBe("created");
      expect((second.data as { field: { id: string } }).field.id).not.toBe(recordId);
    });

    it("two concurrent creates with the identical fingerprint never both succeed and never fail with an unhandled error -- exactly one created, one duplicate_suppressed", async () => {
      const chatId = await seedChatMessage(userA);
      const runId1 = await seedRun(userA);
      const runId2 = await seedRun(userA);
      const sharedFingerprint = fingerprint();

      const [first, second] = await Promise.all([
        callCreateRecord(userA.client, runId1, [chatId], { p_content_fingerprint: sharedFingerprint }),
        callCreateRecord(userA.client, runId2, [chatId], { p_content_fingerprint: sharedFingerprint }),
      ]);
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      const outcomes = [(first.data as { outcome: string }).outcome, (second.data as { outcome: string }).outcome].sort();
      expect(outcomes).toEqual(["created", "duplicate_suppressed"]);

      const rows = await admin.from("personal_memory_records").select("id").eq("user_id", userA.id);
      expect(rows.data).toHaveLength(1);
    });
  });

  describe("provenance reference linkage (ADR-0010: invalid by construction)", () => {
    it("rejects an empty provenance_source_ref_ids array", async () => {
      const runId = await seedRun(userA);
      const result = await callCreateRecord(userA.client, runId, []);
      expect(result.error).not.toBeNull();
    });

    it("rejects a ref id that does not exist or belongs to another owner", async () => {
      const chatInB = await seedChatMessage(userB);
      const runId = await seedRun(userA);

      const result = await callCreateRecord(userA.client, runId, [chatInB]);
      expect(result.error).not.toBeNull();
    });

    it("rejects explicit_user_statement (no capture surface implemented in this task)", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const result = await callCreateRecord(userA.client, runId, [chatId], { p_provenance_source_kind: "explicit_user_statement" });
      expect(result.error).not.toBeNull();
    });
  });

  describe("no automatic supersession for any kind (ADR-0010 Implementation Notes)", () => {
    it("leaves two proposed goals from different runs both proposed -- neither is superseded", async () => {
      const chatId = await seedChatMessage(userA);
      const runId1 = await seedRun(userA);
      const runId2 = await seedRun(userA);

      const first = await callCreateRecord(userA.client, runId1, [chatId], {
        p_kind: "goal",
        p_content: { summary: "Ship v1" },
      });
      expect(first.error).toBeNull();
      const firstId = (first.data as { field: { id: string } }).field.id;

      const second = await callCreateRecord(userA.client, runId2, [chatId], {
        p_kind: "goal",
        p_content: { summary: "Ship v2" },
      });
      expect(second.error).toBeNull();
      expect((second.data as { field: { supersedes_id: string | null } }).field.supersedes_id).toBeNull();

      const firstRow = await admin.from("personal_memory_records").select("status").eq("id", firstId).single();
      expect(firstRow.data?.status).toBe("proposed");
    });
  });

  describe("resolve transitions", () => {
    async function seedProposedRecord(owner: LocalUser, chatId: string, runId: string) {
      const result = await callCreateRecord(owner.client, runId, [chatId]);
      expect(result.error).toBeNull();
      return (result.data as { field: { id: string } }).field.id;
    }

    it("confirm: sets status to user_confirmed, content unchanged", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const recordId = await seedProposedRecord(userA, chatId, runId);

      const result = await callResolveRecord(userA.client, recordId, "confirm");
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("user_confirmed");

      const row = await admin.from("personal_memory_records").select("status,content").eq("id", recordId).single();
      expect(row.data?.status).toBe("user_confirmed");
      expect(row.data?.content).toEqual({ summary: "Prefers async written updates" });
    });

    it("reject: sets status to user_rejected, no new row", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const recordId = await seedProposedRecord(userA, chatId, runId);

      const result = await callResolveRecord(userA.client, recordId, "reject");
      expect(result.error).toBeNull();
      expect((result.data as { outcome: string }).outcome).toBe("user_rejected");

      const rows = await admin.from("personal_memory_records").select("id").eq("user_id", userA.id);
      expect(rows.data).toHaveLength(1);
    });

    it("correct: original row becomes user_corrected (content never mutated), a NEW source=user row is inserted inheriting provenance", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const recordId = await seedProposedRecord(userA, chatId, runId);
      const correctedContent = { summary: "Prefers async written updates, strongly" };

      const result = await callResolveRecord(userA.client, recordId, "correct", {
        p_corrected_content: correctedContent,
        p_corrected_content_fingerprint: fingerprint(),
      });
      expect(result.error).toBeNull();
      const payload = result.data as {
        outcome: string;
        field: { id: string; source: string; status: string; supersedes_id: string; content: unknown; provenance_source_ref_ids: string[]; model_identity: string; derivation_version: string; confidence: string };
      };
      expect(payload.outcome).toBe("user_corrected");
      expect(payload.field.id).not.toBe(recordId);
      expect(payload.field.source).toBe("user");
      expect(payload.field.status).toBe("user_confirmed");
      expect(payload.field.supersedes_id).toBe(recordId);
      expect(payload.field.content).toEqual(correctedContent);
      expect(payload.field.provenance_source_ref_ids).toEqual([chatId]);
      expect(payload.field.model_identity).toBe("user");
      expect(payload.field.derivation_version).toBe("user-correction-v1");
      expect(payload.field.confidence).toBe("high");

      const originalRow = await admin.from("personal_memory_records").select("status,content").eq("id", recordId).single();
      expect(originalRow.data?.status).toBe("user_corrected");
      expect(originalRow.data?.content).toEqual({ summary: "Prefers async written updates" });

      const rows = await admin.from("personal_memory_records").select("id").eq("user_id", userA.id);
      expect(rows.data).toHaveLength(2);
    });

    it("a record already resolved cannot be resolved again", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const recordId = await seedProposedRecord(userA, chatId, runId);

      const first = await callResolveRecord(userA.client, recordId, "confirm");
      expect(first.error).toBeNull();

      const second = await callResolveRecord(userA.client, recordId, "reject");
      expect(second.error).not.toBeNull();
    });
  });

  describe("hard delete (ADR-0010 Q1: any status, no exceptions)", () => {
    async function seedProposedRecord(owner: LocalUser, chatId: string, runId: string) {
      const result = await callCreateRecord(owner.client, runId, [chatId]);
      expect(result.error).toBeNull();
      return (result.data as { field: { id: string } }).field.id;
    }

    it.each(["proposed", "user_confirmed", "user_rejected"])("deletes a record at status=%s", async (targetStatus) => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const recordId = await seedProposedRecord(userA, chatId, runId);

      if (targetStatus === "user_confirmed") await callResolveRecord(userA.client, recordId, "confirm");
      if (targetStatus === "user_rejected") await callResolveRecord(userA.client, recordId, "reject");

      const result = await callDeleteRecord(userA.client, recordId);
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ outcome: "deleted", id: recordId });

      const row = await admin.from("personal_memory_records").select("id").eq("id", recordId).maybeSingle();
      expect(row.data).toBeNull();
    });

    it("deletes a user_corrected (superseded-by-correction) original row without being blocked by the correction's supersedes_id reference", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const recordId = await seedProposedRecord(userA, chatId, runId);

      const corrected = await callResolveRecord(userA.client, recordId, "correct", {
        p_corrected_content: { summary: "Updated" },
        p_corrected_content_fingerprint: fingerprint(),
      });
      expect(corrected.error).toBeNull();
      const correctionId = (corrected.data as { field: { id: string } }).field.id;

      const deleted = await callDeleteRecord(userA.client, recordId);
      expect(deleted.error).toBeNull();

      const correctionRow = await admin.from("personal_memory_records").select("supersedes_id").eq("id", correctionId).single();
      expect(correctionRow.data?.supersedes_id).toBeNull();
    });

    it("denies deleting a record owned by another user, without disclosure", async () => {
      const chatInB = await seedChatMessage(userB);
      const runInB = await seedRun(userB);
      const created = await callCreateRecord(userB.client, runInB, [chatInB]);
      expect(created.error).toBeNull();
      const recordId = (created.data as { field: { id: string } }).field.id;

      const result = await callDeleteRecord(userA.client, recordId);
      expect(result.error).not.toBeNull();

      const row = await admin.from("personal_memory_records").select("id").eq("id", recordId).maybeSingle();
      expect(row.data).not.toBeNull();
    });
  });

  describe("cross-owner isolation", () => {
    it("denies resolve against a record owned by another user, without disclosure", async () => {
      const chatInB = await seedChatMessage(userB);
      const runInB = await seedRun(userB);
      const created = await callCreateRecord(userB.client, runInB, [chatInB]);
      expect(created.error).toBeNull();
      const recordId = (created.data as { field: { id: string } }).field.id;

      const result = await callResolveRecord(userA.client, recordId, "confirm");
      expect(result.error).not.toBeNull();
    });

    it("isolates reads: each user sees only their own personal memory records (RLS)", async () => {
      const chatInA = await seedChatMessage(userA);
      const chatInB = await seedChatMessage(userB);
      const runInA = await seedRun(userA);
      const runInB = await seedRun(userB);
      await callCreateRecord(userA.client, runInA, [chatInA]);
      await callCreateRecord(userB.client, runInB, [chatInB]);

      const ownRead = await userA.client.from("personal_memory_records").select("id");
      expect(ownRead.error).toBeNull();
      expect(ownRead.data).toHaveLength(1);

      const crossRead = await userB.client.from("personal_memory_records").select("id").eq("user_id", userA.id);
      expect(crossRead.error).toBeNull();
      expect(crossRead.data).toEqual([]);
    });

    it("denies a direct client insert into personal_memory_records -- the RPCs are the only write path", async () => {
      const direct = await userA.client.from("personal_memory_records").insert({
        user_id: userA.id,
        kind: "preference",
        content: { summary: "Direct insert attempt" },
        provenance_source_kind: "chat_turn",
        provenance_source_ref_ids: [],
        model_identity: "attacker",
        derivation_version: "v1",
        confidence: "low",
        source: "model",
        content_fingerprint: fingerprint(),
      });
      expect(direct.error).not.toBeNull();
    });

    it("denies client-side update on personal_memory_records: there is no update policy at all", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const created = await callCreateRecord(userA.client, runId, [chatId]);
      expect(created.error).toBeNull();
      const recordId = (created.data as { field: { id: string } }).field.id;

      const update = await userA.client.from("personal_memory_records").update({ status: "user_confirmed" }).eq("id", recordId);
      expect(update.error).not.toBeNull();
    });

    it("denies a direct client delete on personal_memory_records: only delete_personal_memory_record may delete", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const created = await callCreateRecord(userA.client, runId, [chatId]);
      expect(created.error).toBeNull();
      const recordId = (created.data as { field: { id: string } }).field.id;

      const directDelete = await userA.client.from("personal_memory_records").delete().eq("id", recordId);
      expect(directDelete.error).not.toBeNull();

      const row = await admin.from("personal_memory_records").select("id").eq("id", recordId).maybeSingle();
      expect(row.data).not.toBeNull();
    });
  });

  describe("unauthenticated rejection", () => {
    it("rejects unauthenticated (anonymous) create, resolve, and delete", async () => {
      const chatId = await seedChatMessage(userA);
      const runId = await seedRun(userA);
      const anon = localClient(ANON_KEY);

      const createResult = await callCreateRecord(anon, runId, [chatId]);
      expect(createResult.error).not.toBeNull();

      const created = await callCreateRecord(userA.client, runId, [chatId]);
      expect(created.error).toBeNull();
      const recordId = (created.data as { field: { id: string } }).field.id;

      const resolveResult = await callResolveRecord(anon, recordId, "confirm");
      expect(resolveResult.error).not.toBeNull();

      const deleteResult = await callDeleteRecord(anon, recordId);
      expect(deleteResult.error).not.toBeNull();
    });
  });
});
