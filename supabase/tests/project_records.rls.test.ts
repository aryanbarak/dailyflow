import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Live local Supabase RLS proof for ProjectRecord ownership isolation.
// Gated exactly like supabase/tests/github_read_only_connections.rls.test.ts:
// skipped by default, only runs against a local Supabase instance with
// SMARTFLOW_RUN_LOCAL_SUPABASE=1 set.

const RUN_LOCAL = process.env.SMARTFLOW_RUN_LOCAL_SUPABASE === "1";
const API_URL = process.env.SMARTFLOW_LOCAL_SUPABASE_URL ?? "";
const ANON_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "SmartFlow-local-RLS-2026!";

interface LocalUser {
  id: string;
  accessToken: string;
  client: SupabaseClient;
}

function localClient(key: string) {
  return createClient(API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createLocalUser(admin: SupabaseClient, label: string): Promise<LocalUser> {
  const email = `project-records-rls-${label}-${crypto.randomUUID()}@smartflow.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Local test user was not created.");

  const client = localClient(ANON_KEY);
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error || !signIn.data.session) {
    throw signIn.error ?? new Error("Local test user did not receive a session.");
  }
  return { id: data.user.id, accessToken: signIn.data.session.access_token, client };
}

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("ProjectRecord live local Supabase RLS", () => {
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
    await admin.from("project_records").delete().in("user_id", [userA.id, userB.id]);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project_records").delete().in("user_id", [userA?.id, userB?.id].filter(Boolean));
    if (userA?.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB?.id) await admin.auth.admin.deleteUser(userB.id);
  });

  it("isolates reads: each user sees only their own project records", async () => {
    const inserted = await admin.from("project_records").insert([
      { user_id: userA.id, project_type: "software_project", name: "A's project" },
      { user_id: userB.id, project_type: "software_project", name: "B's project" },
    ]);
    expect(inserted.error).toBeNull();

    const ownRead = await userA.client.from("project_records").select("name");
    expect(ownRead.error).toBeNull();
    expect(ownRead.data).toEqual([{ name: "A's project" }]);

    const crossRead = await userB.client.from("project_records").select("name").eq("user_id", userA.id);
    expect(crossRead.error).toBeNull();
    expect(crossRead.data).toEqual([]);
  });

  it("denies inserting a record with another user's owner id", async () => {
    const spoofed = await userA.client
      .from("project_records")
      .insert({ user_id: userB.id, project_type: "software_project", name: "Spoofed" });
    expect(spoofed.error).not.toBeNull();
  });

  it("denies updating another user's record", async () => {
    const inserted = await admin
      .from("project_records")
      .insert({ user_id: userA.id, project_type: "software_project", name: "A's project" })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const crossUpdate = await userB.client
      .from("project_records")
      .update({ name: "Hijacked" })
      .eq("id", inserted.data!.id);
    expect(crossUpdate.error).toBeNull(); // RLS silently matches zero rows rather than erroring
    expect(crossUpdate.count ?? 0).toBe(0);

    const stillOwnedByA = await admin.from("project_records").select("name").eq("id", inserted.data!.id).single();
    expect(stillOwnedByA.data?.name).toBe("A's project");
  });

  it("denies client-side hard delete", async () => {
    const inserted = await admin
      .from("project_records")
      .insert({ user_id: userA.id, project_type: "software_project", name: "A's project" })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const deleteAttempt = await userA.client.from("project_records").delete().eq("id", inserted.data!.id);
    expect(deleteAttempt.error).not.toBeNull();

    const stillExists = await admin.from("project_records").select("id").eq("id", inserted.data!.id).maybeSingle();
    expect(stillExists.data).not.toBeNull();
  });

  it("enforces one active binding per repository per owner", async () => {
    const binding = { repo_provider: "github", repo_owner: "aryanbarak", repo_name: "smartflow" };
    const first = await userA.client
      .from("project_records")
      .insert({ user_id: userA.id, project_type: "software_project", name: "First", ...binding });
    expect(first.error).toBeNull();

    const second = await userA.client
      .from("project_records")
      .insert({ user_id: userA.id, project_type: "software_project", name: "Second", ...binding });
    expect(second.error).not.toBeNull();
  });
});
