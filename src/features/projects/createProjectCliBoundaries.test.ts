import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_LOCAL_REFRESH_SOURCE_KINDS } from "./localProjectRefreshService";

const script = readFileSync(path.resolve(process.cwd(), "scripts/smartflow-create-project.ts"), "utf8");

describe("create-project CLI boundaries", () => {
  it("does not accept caller-supplied owner identity", () => {
    expect(script).toContain("--name");
    expect(script).not.toContain("--owner-id");
    expect(script).not.toContain("userId");
  });

  it("resolves ownership from the authenticated session, not a hard-coded id", () => {
    expect(script).toContain("resolveOwnerId");
    expect(script).toContain("auth.getUser(accessToken)");
  });

  it("goes through the existing ProjectRecord service and validation, not a raw insert", () => {
    expect(script).toContain("createProjectRecordService");
    expect(script).toContain("createSupabaseProjectRecordRepository");
    expect(script).not.toMatch(/\.from\(["']project_records["']\)/);
  });

  it("does not run a refresh, rebuild context, or assemble a brief", () => {
    expect(script).not.toContain("refreshLocalProject(");
    expect(script).not.toMatch(/contextRebuildService|buildProjectBrief|ProjectWorkspacePage/);
  });

  it("does not create ProjectEvidence", () => {
    expect(script).not.toMatch(/projectEvidenceService|createProjectEvidenceService|projectEvidenceRepository/i);
  });

  it("sources its default evidence source kinds from the exported Local Project Refresh constant, not a duplicated literal", () => {
    expect(script).toContain("REQUIRED_LOCAL_REFRESH_SOURCE_KINDS");
    expect(script).toContain('import("../src/features/projects/localProjectRefreshService")');
    // Regression guard: the six required kinds must not be re-declared as a
    // second, independently-maintained string-literal array in this script.
    expect(script).not.toMatch(
      /"repository_document"[\s\S]{0,40}"architecture_document"[\s\S]{0,40}"adr"[\s\S]{0,40}"roadmap_document"[\s\S]{0,40}"product_direction_document"[\s\S]{0,40}"project_status_document"/,
    );
  });

  it("the shared required-source-kind constant is exported and matches Local Project Refresh's exact requirement", () => {
    // Genuine (non-static) proof that the shared contract itself has the
    // six values the CLI depends on, in the order Local Project Refresh
    // expects -- not just that the script textually references the name.
    expect(REQUIRED_LOCAL_REFRESH_SOURCE_KINDS).toEqual([
      "repository_document",
      "architecture_document",
      "adr",
      "roadmap_document",
      "product_direction_document",
      "project_status_document",
    ]);
  });

  it("does not run shell, git, provider, LLM, or browser automation", () => {
    expect(script).not.toMatch(/child_process|execSync|spawn|exec\(/);
    expect(script).not.toMatch(/\bgit\b|GitHub|openai|gemini|llm|localStorage\.getItem/);
  });

  it("uses an access token environment variable instead of service-role identity", () => {
    expect(script).toContain("SMARTFLOW_SUPABASE_ACCESS_TOKEN");
    expect(script).not.toContain("SERVICE_ROLE");
    expect(script).not.toContain("service_role");
  });

  it("derives only a host from the resolved Supabase URL, never logging the full URL, query string, or a connection string", () => {
    expect(script).toContain("new URL(supabaseUrl).host");
    expect(script).not.toMatch(/console\.(log|error)\([^)]*supabaseUrl[^)]*\)/);
    expect(script).not.toMatch(/console\.(log|error)\([^)]*anonKey[^)]*\)/);
    expect(script).not.toMatch(/console\.(log|error)\([^)]*accessToken[^)]*\)/);
  });

  it("reports the resolved target host in every output path", () => {
    expect(script).toContain("Target: ${targetHost}");
    expect(script).toContain("target: { host: targetHost }");
  });
});
