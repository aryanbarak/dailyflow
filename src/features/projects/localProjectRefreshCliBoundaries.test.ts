import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(path.resolve(process.cwd(), "scripts/smartflow-refresh-project.ts"), "utf8");

describe("local project refresh CLI boundaries", () => {
  it("does not accept caller-supplied owner identity", () => {
    expect(script).toContain("--project-id");
    expect(script).toContain("--repo-root");
    expect(script).not.toContain("--owner-id");
    expect(script).not.toContain("userId");
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
});
