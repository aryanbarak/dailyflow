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
      read("src/features/projects/projectWorkspaceReadService.ts"),
      read("src/features/projects/projectWorkspaceBrowserReadService.ts"),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/node:fs|node:path|child_process|spawn|exec\(/);
      expect(source).not.toMatch(/smartflow-refresh-project|localProjectRefreshService/);
      expect(source).not.toMatch(/createClient|service_role|SERVICE_ROLE/);
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

  it("keeps live project selection on immutable route id without first-project or hard-coded UUID fallback", () => {
    const appSource = read("src/App.tsx");
    const pageSource = read("src/pages/ProjectWorkspacePage.tsx");
    const serviceSource = read("src/features/projects/projectWorkspaceReadService.ts");

    expect(appSource).toContain('path="/projects/:projectId"');
    expect(appSource).toContain('path="/projects/demo/smartflow"');
    expect(pageSource).toMatch(/useParams/);
    expect(serviceSource).toMatch(/UUID_PATTERN/);
    expect(serviceSource).not.toMatch(/listByOwner|created_at|\.list\(/);
    expect(serviceSource).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("keeps the browser composition on one authenticated Supabase client and read-only project APIs", () => {
    const source = read("src/features/projects/projectWorkspaceBrowserReadService.ts");

    expect(source).toContain("createBrowserProjectWorkspaceReadService(client");
    expect(source).toContain("createSupabaseProjectRecordRepository(client)");
    expect(source).toContain("createSupabaseProjectEvidenceRepository(client)");
    expect(source).toContain("client.auth.getUser()");
    expect(source).not.toMatch(/\.create\(|\.archive\(|\.update\(|\.insert\(/);
  });
});
