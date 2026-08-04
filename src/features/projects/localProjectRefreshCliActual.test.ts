import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

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
  it("missing arguments emit exactly one parseable JSON object", () => {
    const result = runCli([]);
    expect(result.status).not.toBe(0);
    const json = parseSingleJson(result.stdout);
    expect(json).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("malformed UUID emits exactly one parseable JSON object", () => {
    const result = runCli(["--project-id", "not-a-uuid", "--repo-root", process.cwd()]);
    expect(result.status).not.toBe(0);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "INVALID_ARGUMENTS" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase/);
  });

  it("missing auth configuration maps to AUTH_CONFIGURATION_REQUIRED", () => {
    const result = runCli(["--project-id", "11111111-1111-4111-8111-111111111111", "--repo-root", process.cwd()], {
      SMARTFLOW_SUPABASE_URL: "",
      SMARTFLOW_LOCAL_SUPABASE_URL: "",
      SMARTFLOW_SUPABASE_ANON_KEY: "",
      SMARTFLOW_LOCAL_SUPABASE_ANON_KEY: "",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "",
    });
    expect(result.status).not.toBe(0);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "AUTH_CONFIGURATION_REQUIRED" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|Supabase|https?:\/\//);
  });

  it("dummy configured invalid token returns sanitized unauthenticated JSON without browser singleton logs", () => {
    const result = runCli(["--project-id", "11111111-1111-4111-8111-111111111111", "--repo-root", process.cwd()], {
      SMARTFLOW_SUPABASE_URL: "http://127.0.0.1:54321",
      SMARTFLOW_SUPABASE_ANON_KEY: "dummy-anon",
      SMARTFLOW_SUPABASE_ACCESS_TOKEN: "dummy-token",
    });
    expect(result.status).not.toBe(0);
    expect(parseSingleJson(result.stdout)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(result.stderr).not.toMatch(/at .*\.ts|storage\.getItem|\[Supabase\]|supabase\.co|dummy-token|dummy-anon/);
  });
});
