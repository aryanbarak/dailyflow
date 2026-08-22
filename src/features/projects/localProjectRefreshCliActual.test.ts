import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseProjectRecordRepository } from "./projectRecordRepository";

// CI-01b: see __fixtures__/mockUnauthenticatedFetchPreload.mjs's own header
// comment for why a Node `--import` preload, not a vitest mock, is the
// correct tool for injecting a fetch response into the REAL spawned CLI
// process below.
const MOCK_UNAUTHENTICATED_FETCH_PRELOAD_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "mockUnauthenticatedFetchPreload.mjs"),
).href;

function runCli(args: readonly string[], env: Record<string, string | undefined> = {}) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const commandArgs =
    process.platform === "win32"
      ? ["/c", "npm", "--silent", "run", "smartflow:refresh-project", "--", ...args, "--json"]
      : ["--silent", "run", "smartflow:refresh-project", "--", ...args, "--json"];
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return result;
}

function parseSingleJson(stdout: string) {
  const trimmed = stdout.trim();
  expect(trimmed.startsWith("{")).toBe(true);
  expect(trimmed.endsWith("}")).toBe(true);
  return JSON.parse(trimmed) as { ok: boolean; code?: string; message?: string; result?: unknown };
}

describe("local project refresh actual CLI JSON contract", () => {
  it("missing arguments emit exactly one parseable JSON object and exit code 2", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("malformed UUID emits exactly one parseable JSON object and exit code 2", () => {
    const result = runCli(["--project-id", "not-a-uuid", "--repo-root", process.cwd()]);
    expect(result.status).toBe(2);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("missing auth configuration maps to AUTH_CONFIGURATION_REQUIRED and exit code 3", () => {
    const result = runCli(["--project-id", "11111111-1111-4111-8111-111111111111", "--repo-root", process.cwd()], {
      SMARTFLOW_SUPABASE_URL: "",
      SMARTFLOW_LOCAL_SUPABASE_URL: "",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).toBe(3);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "AUTH_CONFIGURATION_REQUIRED" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase|https?:\/\//);
  });

  it("a non-local Supabase URL without --allow-production fails closed with NOT_LOCAL_TARGET and exit code 3, before any auth attempt (R-1)", () => {
    // No SMARTFLOW_SUPABASE_ANON_KEY/ACCESS_TOKEN supplied -- if the gate did
    // not short-circuit before those reads, this would instead fail with
    // AUTH_CONFIGURATION_REQUIRED, which this test also rules out. The
    // interactive-confirmation branch (--allow-production) is covered by
    // cliSupabaseEnvironmentGate.test.ts's unit tests with an injected
    // confirm function, not here -- driving a real stdin prompt through a
    // spawned child process is unnecessary risk for behavior already
    // covered at the unit level.
    const result = runCli(["--project-id", "11111111-1111-4111-8111-111111111111", "--repo-root", process.cwd()], {
      SMARTFLOW_SUPABASE_URL: "https://example.supabase.co",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).toBe(3);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "NOT_LOCAL_TARGET" });
    expect(json.message).toContain("example.supabase.co");
    expect(json.message).toContain("--allow-production");
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("dummy configured invalid token returns sanitized unauthenticated JSON without browser singleton logs, exit code 3", () => {
    // CI-01b: fetch is intercepted inside the spawned process (see
    // MOCK_UNAUTHENTICATED_FETCH_PRELOAD_URL's own comment) and always
    // answers the auth /user request with a real 401 -- no real network
    // reaches SMARTFLOW_SUPABASE_URL at all, so its exact value is
    // arbitrary as long as it's a syntactically loopback URL (required to
    // pass the earlier NOT_LOCAL_TARGET gate).
    const result = runCli(["--project-id", "11111111-1111-4111-8111-111111111111", "--repo-root", process.cwd()], {
      NODE_OPTIONS: `--import ${MOCK_UNAUTHENTICATED_FETCH_PRELOAD_URL}`,
      SMARTFLOW_SUPABASE_URL: "http://127.0.0.1:54321",
      SMARTFLOW_SUPABASE_ANON_KEY: "dummy-anon",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "dummy-token",
    });
    expect(result.status).toBe(3);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|\[Supabase\]|supabase\.co|dummy-token|dummy-anon/);
  });

  it("every spawned failure path terminates without a libuv/native crash on stderr", () => {
    const scenarios = [
      runCli([]),
      runCli(["--project-id", "not-a-uuid", "--repo-root", process.cwd()]),
      runCli(["--project-id", "11111111-1111-4111-8111-111111111111", "--repo-root", process.cwd()], {
        SMARTFLOW_SUPABASE_URL: "",
        SMARTFLOW_LOCAL_SUPABASE_URL: "",
        SMARTFLOW_SUPABASE_ANON_KEY: "",
        SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
        SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
      }),
    ];
    for (const result of scenarios) {
      expect(result.signal).toBeNull();
      expect(result.stderr).not.toMatch(/Assertion failed|UV_HANDLE_CLOSING/);
    }
  });
});

// Live local Supabase proof that the two remaining documented exit codes
// (PROJECT_ARCHIVED, EVIDENCE_SOURCE_DISABLED -- both exit code 4) are
// reachable only through the full script against a real project, and that
// process.exitCode (not process.exit) lets the process terminate with that
// exact code instead of the Windows/libuv assertion crash observed during
// Sprint 1 live verification. Gated exactly like supabase/tests/*.rls.test.ts:
// skipped by default, only runs with SMARTFLOW_RUN_LOCAL_SUPABASE=1 set.
const RUN_LOCAL = process.env.SMARTFLOW_RUN_LOCAL_SUPABASE === "1";
const LOCAL_URL = process.env.SMARTFLOW_LOCAL_SUPABASE_URL ?? "";
const LOCAL_ANON_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_ANON_KEY ?? "";
const LOCAL_SERVICE_ROLE_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "SmartFlow-local-CLI-exit-2026!";

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("local project refresh actual CLI exit codes against a live project", () => {
  let admin: SupabaseClient;
  let userId: string;
  let accessToken: string;
  let archivedProjectId: string;
  let disabledSourceProjectId: string;

  beforeAll(async () => {
    if (!LOCAL_URL || !LOCAL_ANON_KEY || !LOCAL_SERVICE_ROLE_KEY) {
      throw new Error("Local Supabase test environment is incomplete.");
    }
    admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `cli-exit-codes-${crypto.randomUUID()}@smartflow.local`;
    const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("Local test user was not created.");
    userId = created.data.user.id;

    const anon = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("Local test user did not receive a session.");
    accessToken = signIn.data.session.access_token;

    const repository = createSupabaseProjectRecordRepository(anon);
    const archived = await repository.insert(userId, {
      type: "software_project",
      name: "CLI exit code archived project (test-only)",
      enabledEvidenceSourceKinds: [
        "repository_document",
        "architecture_document",
        "adr",
        "roadmap_document",
        "product_direction_document",
        "project_status_document",
      ],
    });
    archivedProjectId = archived.id;
    await repository.archiveActive(userId, archived.id);

    const disabledSource = await repository.insert(userId, {
      type: "software_project",
      name: "CLI exit code disabled source project (test-only)",
      enabledEvidenceSourceKinds: ["project_status_document"],
    });
    disabledSourceProjectId = disabledSource.id;
  });

  afterAll(async () => {
    if (!admin) return;
    if (userId) {
      await admin.from("project_records").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("archived project maps to PROJECT_ARCHIVED and exit code 4, without a native crash", () => {
    const result = runCli(["--project-id", archivedProjectId, "--repo-root", process.cwd()], {
      SMARTFLOW_SUPABASE_URL: LOCAL_URL,
      SMARTFLOW_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(result.status).toBe(4);
    expect(result.signal).toBeNull();
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "PROJECT_ARCHIVED" });
    expect(result.stderr).not.toMatch(/Assertion failed|UV_HANDLE_CLOSING/);
  });

  it("disabled evidence source maps to EVIDENCE_SOURCE_DISABLED and exit code 4, without a native crash", () => {
    const result = runCli(["--project-id", disabledSourceProjectId, "--repo-root", process.cwd()], {
      SMARTFLOW_SUPABASE_URL: LOCAL_URL,
      SMARTFLOW_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(result.status).toBe(4);
    expect(result.signal).toBeNull();
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "EVIDENCE_SOURCE_DISABLED" });
    expect(result.stderr).not.toMatch(/Assertion failed|UV_HANDLE_CLOSING/);
  });
});
