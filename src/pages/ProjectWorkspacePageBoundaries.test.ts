import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("Project Workspace browser boundaries", () => {
  it("does not import filesystem, child process, CLI, refresh service, or Supabase client from browser page modules", () => {
    const sources = [
      read("src/pages/ProjectWorkspacePage.tsx"),
      read("src/features/projects/projectWorkspaceFixture.ts"),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/node:fs|node:path|child_process|spawn|exec\(/);
      expect(source).not.toMatch(/smartflow-refresh-project|localProjectRefreshService/);
      expect(source).not.toMatch(/integrations\/supabase\/client|createClient/);
    }
  });

  it("does not introduce semantic memory, vector, RAG, LLM, automation, approval, commit, or push behavior", () => {
    const source = read("src/pages/ProjectWorkspacePage.tsx");

    expect(source).not.toMatch(/embedding|vector|runReadOnlyTool|runWriteTool|ExecutionIntent|approveWorkspaceStep/);
    expect(source).not.toMatch(/git commit|git push|Smart Automation|background refresh/);
    expect(source).not.toMatch(/createLlmReasoningCaller|reasonAboutUserMessage|fetch\(/);
  });

  it("does not expose CLI secrets or local absolute paths in the fixture command", () => {
    const source = read("src/features/projects/projectWorkspaceFixture.ts");

    expect(source).toContain("<trusted-local-repo-path>");
    expect(source).not.toMatch(/SMARTFLOW_SUPABASE_ACCESS_TOKEN|SERVICE_ROLE|service_role/);
    expect(source).not.toMatch(/[A-Z]:\\\\/);
  });
});
