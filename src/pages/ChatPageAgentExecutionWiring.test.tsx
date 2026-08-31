// @vitest-environment jsdom
//
// Chat V2 Slice 2A / BLOCKER A CORRECTION: the write handlers under
// src/features/agent/handlers/ (tasksCreateHandler.ts etc.) now fail closed
// with no direct-write fallback when context.agentToolExecutionClient is
// absent -- see this slice's own report. That makes ChatPage.tsx's own
// wiring of that client into runWriteTool's executionContext load-bearing
// in production, not cosmetic: if this wiring were ever removed or
// misplaced, every Agent task/calendar write would start failing closed in
// the real app, not just in a test harness. ChatPage.tsx is never mounted
// directly in this test suite (see ChatPageChromeCleanup.test.tsx's own
// header comment for the established reason), so this follows the same
// source-verification convention ChatPageAttachmentWiring.test.tsx already
// uses for a comparable "this wiring must not silently regress" guarantee.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(process.cwd(), "src", "pages", "ChatPage.tsx"), "utf-8");

describe("ChatPage: agentToolExecutionClient wiring (Chat V2 Slice 2A, Blocker A correction)", () => {
  it("imports createAgentToolExecutionClient from the Slice 2A client module", () => {
    expect(pageSource).toMatch(/import \{ createAgentToolExecutionClient \} from '@\/features\/agent\/agentToolExecutionClient'/);
  });

  it("there is exactly ONE runWriteTool call site, and its executionContext supplies agentToolExecutionClient", () => {
    const callSites = pageSource.match(/runWriteTool\(\{/g) ?? [];
    expect(callSites).toHaveLength(1);

    const callStart = pageSource.indexOf("const writeResult = await runWriteTool({");
    expect(callStart).toBeGreaterThan(-1);
    const callEnd = pageSource.indexOf("\n    })", callStart);
    const callBody = pageSource.slice(callStart, callEnd);

    expect(callBody).toMatch(/agentToolExecutionClient: createAgentToolExecutionClient\(\{/);
    // Same auth wiring as every other Worker client at this call site
    // (githubIssueCommentClient, engineeringTaskClient, etc.) -- a real
    // Supabase session access token, not a placeholder.
    const clientStart = callBody.indexOf("agentToolExecutionClient: createAgentToolExecutionClient({");
    const clientEnd = callBody.indexOf("}),", clientStart);
    const clientBody = callBody.slice(clientStart, clientEnd);
    expect(clientBody).toMatch(/workerBaseUrl: workerUrl/);
    expect(clientBody).toMatch(/const \{ data: \{ session \} \} = await supabase\.auth\.getSession\(\)/);
    expect(clientBody).toMatch(/return session\?\.access_token/);
  });
});
