// SmartFlow -- Chat Experience v2 (task 17a): compact-mode class
// application on ChatBubble/ReasoningProposalCard, kept in its OWN file
// (not ChatPage.test.tsx, which must pass unmodified per the task) so
// this task's additions are clearly separated from the pipeline/UX-
// boundary suite that already existed. Uses the same renderToString
// pattern and fixture builders style as ChatPage.test.tsx for consistency.

import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    from: vi.fn(),
  },
}));

import { ChatBubble, ReasoningProposalCard } from "./ChatPage";
import { getToolById } from "@/features/agent";
import type { AgentReasoningResult, ToolResolutionResult } from "@/features/agent";
import type { WorkspacePlanStep } from "@/features/workspace";

const now = "2026-08-11T08:00:00.000Z";

function reasoningResult(): AgentReasoningResult {
  return {
    proposal: {
      id: "intent-1",
      type: "inspect_tasks",
      confidence: "high",
      userMessage: "Show my open tasks.",
      requestedDomain: "tasks",
      toolId: "tasks.list",
      requiresTool: true,
      requiresApproval: false,
      reasons: ["Validated."],
      language: "en",
      generatedAt: now,
      schemaVersion: 1,
    },
    responseLanguage: "en",
    validationReasons: ["validated"],
    toolId: "tasks.list",
    promptPreview: { containsTaskNotes: false, containsRawMemory: false, containsAuditPolicy: false, containsUserId: false },
  };
}

function step(): WorkspacePlanStep {
  return {
    id: "reasoning-step:intent-1",
    order: 1,
    title: "Inspect tasks",
    description: "Run tasks.list.",
    domain: "tasks",
    estimatedMinutes: 5,
    status: "proposed",
    actionType: "review",
    reason: "Validated.",
    requiresApproval: false,
    dependencies: [],
    optional: false,
  };
}

function resolution(): ToolResolutionResult {
  return {
    status: "resolved",
    resolved: true,
    stepId: "reasoning-step:intent-1",
    toolId: "tasks.list",
    tool: getToolById("tasks.list"),
    confidence: "high",
    reasons: ["resolved"],
    candidates: [],
    requiredInput: [],
    generatedAt: now,
    resolverVersion: "tool-resolver-v1",
  };
}

describe("ChatBubble compact mode", () => {
  it("defaults to comfortable spacing when compact is omitted", () => {
    const html = renderToString(<ChatBubble role="user" content="Hello" />);
    expect(html).toContain("px-4");
    expect(html).toContain("py-2.5");
    expect(html).not.toContain("px-3 py-1.5");
  });

  it("applies reduced padding/font-size classes when compact=true", () => {
    const html = renderToString(<ChatBubble role="user" content="Hello" compact />);
    expect(html).toContain("px-3");
    expect(html).toContain("py-1.5");
    expect(html).toContain("text-[13px]");
  });

  it("compact mode does not remove the dir=auto bidi handling (task 11e unaffected)", () => {
    const html = renderToString(<ChatBubble role="assistant" content="Hello" compact />);
    expect(html).toContain('dir="auto"');
  });
});

describe("ReasoningProposalCard compact mode", () => {
  it("defaults to comfortable padding when compact is omitted", () => {
    const html = renderToString(
      <ReasoningProposalCard
        proposal={{ result: reasoningResult(), step: step(), resolution: resolution(), approval: null, runStatus: "idle" }}
        onRunReadOnly={vi.fn()}
        onReviewApproval={vi.fn()}
        onRunWrite={vi.fn()}
      />,
    );
    expect(html).toContain("p-3");
  });

  it("applies reduced padding when compact=true, without changing any button text/labels", () => {
    const html = renderToString(
      <ReasoningProposalCard
        proposal={{ result: reasoningResult(), step: step(), resolution: resolution(), approval: null, runStatus: "idle" }}
        onRunReadOnly={vi.fn()}
        onReviewApproval={vi.fn()}
        onRunWrite={vi.fn()}
        compact
      />,
    );
    expect(html).toContain("p-2.5");
    expect(html).toContain("Run tasks.list");
  });
});
