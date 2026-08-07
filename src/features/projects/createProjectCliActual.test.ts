import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

function runCli(args: readonly string[], env: Record<string, string | undefined> = {}) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const commandArgs =
    process.platform === "win32"
      ? ["/c", "npm", "--silent", "run", "smartflow:create-project", "--", ...args, "--json"]
      : ["--silent", "run", "smartflow:create-project", "--", ...args, "--json"];
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
  return JSON.parse(trimmed) as {
    ok: boolean;
    code?: string;
    message?: string;
    result?: unknown;
    target?: { host: string };
  };
}

describe("create-project actual CLI JSON contract", () => {
  it("missing --name emits exactly one parseable JSON object and exit code 2", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("an unknown flag emits exactly one parseable JSON object and exit code 2", () => {
    const result = runCli(["--name", "SmartFlow", "--bogus-flag", "value"]);
    expect(result.status).toBe(2);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
    expect(json.message).toMatch(/--bogus-flag/);
  });

  it("--repo-owner without --repo-name emits INVALID_ARGUMENTS and exit code 2", () => {
    const result = runCli(["--name", "SmartFlow", "--repo-owner", "acme"]);
    expect(result.status).toBe(2);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
  });

  it("a duplicated --name flag is accepted deterministically (last-value-wins), not rejected as ambiguous", () => {
    // Documents the intentional contract: duplicate flags are last-wins,
    // exactly like scripts/smartflow-refresh-project.ts's own parseArgs.
    // Proven here by confirming argument parsing succeeds (no
    // INVALID_ARGUMENTS) and the failure that does occur is the expected
    // downstream one; the gated live test below proves which value wins.
    const result = runCli(["--name", "First Name", "--name", "Second Name"], {
      SMARTFLOW_SUPABASE_URL: "",
      SMARTFLOW_LOCAL_SUPABASE_URL: "",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).toBe(3);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "AUTH_CONFIGURATION_REQUIRED" });
  });

  it("missing auth configuration maps to AUTH_CONFIGURATION_REQUIRED and exit code 3, with no target host resolvable", () => {
    const result = runCli(["--name", "SmartFlow"], {
      SMARTFLOW_SUPABASE_URL: "",
      SMARTFLOW_LOCAL_SUPABASE_URL: "",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).toBe(3);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "AUTH_CONFIGURATION_REQUIRED" });
    expect(json.target).toBeUndefined();
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase|https?:\/\//);
  });

  it("a resolvable URL with a still-missing anon key reports the target host alongside AUTH_CONFIGURATION_REQUIRED", () => {
    const result = runCli(["--name", "SmartFlow"], {
      SMARTFLOW_SUPABASE_URL: "http://127.0.0.1:54321",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).toBe(3);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "AUTH_CONFIGURATION_REQUIRED", target: { host: "127.0.0.1:54321" } });
  });

  it("a malformed Supabase URL maps to INVALID_SUPABASE_URL and exit code 3, without echoing the raw value", () => {
    const result = runCli(["--name", "SmartFlow"], {
      SMARTFLOW_SUPABASE_URL: "bad-url-with-no-scheme",
      SMARTFLOW_SUPABASE_ANON_KEY: "dummy-anon",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "dummy-token",
    });
    expect(result.status).toBe(3);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "INVALID_SUPABASE_URL" });
    expect(json.target).toBeUndefined();
    expect(json.message).not.toContain("bad-url-with-no-scheme");
  });

  it("a non-local Supabase URL without --allow-production fails closed with NOT_LOCAL_TARGET and exit code 3, before any auth attempt (R-1)", () => {
    // No SMARTFLOW_SUPABASE_ANON_KEY/ACCESS_TOKEN supplied at all -- if the
    // gate did not short-circuit before those reads, this would instead fail
    // with AUTH_CONFIGURATION_REQUIRED, which this test also rules out. The
    // interactive-confirmation branch (--allow-production) is covered by
    // cliSupabaseEnvironmentGate.test.ts's unit tests with an injected
    // confirm function, not here -- driving a real stdin prompt through a
    // spawned child process is unnecessary risk (a hang if EOF timing
    // differs across platforms) for behavior already covered at the unit
    // level.
    const result = runCli(["--name", "SmartFlow"], {
      SMARTFLOW_SUPABASE_URL: "https://example.supabase.co",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).toBe(3);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "NOT_LOCAL_TARGET", target: { host: "example.supabase.co" } });
    expect(json.message).toContain("example.supabase.co");
    expect(json.message).toContain("--allow-production");
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("dummy configured invalid token returns sanitized unauthenticated JSON with the target host, exit code 3", () => {
    const result = runCli(["--name", "SmartFlow"], {
      SMARTFLOW_SUPABASE_URL: "http://127.0.0.1:54321",
      SMARTFLOW_SUPABASE_ANON_KEY: "dummy-anon",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "dummy-token",
    });
    expect(result.status).toBe(3);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "UNAUTHENTICATED", target: { host: "127.0.0.1:54321" } });
    expect(result.stdout).not.toMatch(/dummy-token|dummy-anon/);
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|\[Supabase\]|supabase\.co|dummy-token|dummy-anon/);
  });

  it("every spawned failure path terminates without a libuv/native crash on stderr", () => {
    const scenarios = [
      runCli([]),
      runCli(["--name", "SmartFlow", "--bogus-flag", "value"]),
      runCli(["--name", "SmartFlow", "--repo-owner", "acme"]),
      runCli(["--name", "SmartFlow"], {
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

// Live local Supabase proof that a real authenticated call creates exactly
// one ProjectRecord with the evidence source kinds the Local Project Refresh
// CLI requires, that the target host is reported on a real success, and
// that re-running with the same repository binding is rejected as a
// duplicate rather than silently creating a second project. Gated exactly
// like supabase/tests/*.rls.test.ts and localProjectRefreshCliActual.test.ts:
// skipped by default, only runs with SMARTFLOW_RUN_LOCAL_SUPABASE=1 set.
const RUN_LOCAL = process.env.SMARTFLOW_RUN_LOCAL_SUPABASE === "1";
const LOCAL_URL = process.env.SMARTFLOW_LOCAL_SUPABASE_URL ?? "";
const LOCAL_ANON_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_ANON_KEY ?? "";
const LOCAL_SERVICE_ROLE_KEY = process.env.SMARTFLOW_LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "SmartFlow-local-CLI-create-2026!";

const localDescribe = RUN_LOCAL ? describe.sequential : describe.skip;

localDescribe("create-project actual CLI against a live project", () => {
  let admin: SupabaseClient;
  let userId: string;
  let accessToken: string;

  beforeAll(async () => {
    if (!LOCAL_URL || !LOCAL_ANON_KEY || !LOCAL_SERVICE_ROLE_KEY) {
      throw new Error("Local Supabase test environment is incomplete.");
    }
    admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `cli-create-project-${crypto.randomUUID()}@smartflow.local`;
    const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("Local test user was not created.");
    userId = created.data.user.id;

    const anon = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    if (signIn.error || !signIn.data.session) throw signIn.error ?? new Error("Local test user did not receive a session.");
    accessToken = signIn.data.session.access_token;
  });

  afterAll(async () => {
    if (!admin) return;
    if (userId) {
      await admin.from("project_records").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });

  afterEach(async () => {
    if (!admin || !userId) return;
    await admin.from("project_records").delete().eq("user_id", userId);
  });

  it("creates exactly one ProjectRecord with exactly the evidence sources the refresh CLI requires, and reports the target host", () => {
    const result = runCli(["--name", "SmartFlow", "--repo-owner", "smartflow-org", "--repo-name", "smartflow"], {
      SMARTFLOW_SUPABASE_URL: LOCAL_URL,
      SMARTFLOW_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    const json = parseSingleJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.target).toEqual({ host: new URL(LOCAL_URL).host });
    const record = json.result as {
      id: string;
      name: string;
      status: string;
      enabledEvidenceSourceKinds: readonly string[];
      repository?: { provider: string; owner: string; name: string };
    };
    expect(record.name).toBe("SmartFlow");
    expect(record.status).toBe("active");
    expect([...record.enabledEvidenceSourceKinds].sort()).toEqual(
      [
        "repository_document",
        "architecture_document",
        "adr",
        "roadmap_document",
        "product_direction_document",
        "project_status_document",
      ].sort(),
    );
    expect(record.repository).toEqual({ provider: "github", owner: "smartflow-org", name: "smartflow" });
    expect(result.stdout).not.toContain(accessToken);
    expect(result.stdout).not.toContain(LOCAL_ANON_KEY);
  });

  it("a duplicated --name flag creates the project under the last-supplied name", () => {
    const result = runCli(["--name", "First Draft Name", "--name", "SmartFlow"], {
      SMARTFLOW_SUPABASE_URL: LOCAL_URL,
      SMARTFLOW_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(result.status).toBe(0);
    const json = parseSingleJson(result.stdout);
    const record = json.result as { name: string };
    expect(record.name).toBe("SmartFlow");
  });

  it("rejects a second project with the same repository binding for the same owner", () => {
    const first = runCli(["--name", "SmartFlow", "--repo-owner", "smartflow-org", "--repo-name", "smartflow"], {
      SMARTFLOW_SUPABASE_URL: LOCAL_URL,
      SMARTFLOW_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(first.status).toBe(0);

    const second = runCli(["--name", "SmartFlow Duplicate", "--repo-owner", "smartflow-org", "--repo-name", "smartflow"], {
      SMARTFLOW_SUPABASE_URL: LOCAL_URL,
      SMARTFLOW_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(second.status).toBe(4);
    const json = parseSingleJson(second.stdout);
    expect(json).toMatchObject({ ok: false, code: "DUPLICATE_REPOSITORY_BINDING" });
    expect(json.target).toEqual({ host: new URL(LOCAL_URL).host });
  });
});
