// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepApprovalDialog } from "./StepApprovalDialog";
import { approvalFailureMessage } from "./stepApprovalMessages";
import { getToolById } from "@/features/agent/toolRegistry";
import { translations } from "@/i18n";
import { approveWorkspaceStep } from "@/features/agent/approvalInteraction";
import type { ApprovalInteractionResult } from "@/features/agent/approvalInteraction";
import type {
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspaceTypes";

vi.mock("@/features/agent/approvalInteraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/agent/approvalInteraction")>();
  return {
    ...actual,
    approveWorkspaceStep: vi.fn(),
  };
});

function step(overrides: Partial<WorkspacePlanStep> = {}): WorkspacePlanStep {
  return {
    id: "step-1",
    order: 1,
    title: "Create task",
    description: "Create a new task from the plan.",
    domain: "tasks",
    estimatedMinutes: 10,
    status: "proposed",
    actionType: "create",
    reason: "Task load is high.",
    requiresApproval: true,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function approval(
  overrides: Partial<WorkspaceStepApproval> = {},
): WorkspaceStepApproval {
  return {
    stepId: "step-1",
    status: "pending",
    requiresApproval: true,
    approvalReason: "Future execution could modify user data.",
    riskLevel: "medium",
    reversible: true,
    externalEffect: true,
    dataDomains: ["tasks"],
    approvalScope: "single_step",
    ...overrides,
  };
}

describe("StepApprovalDialog", () => {
  beforeEach(() => {
    vi.mocked(approveWorkspaceStep).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders approval-required step details and accessible controls", () => {
    const html = renderToString(
      <StepApprovalDialog
        open
        step={step()}
        stepApproval={approval()}
        tool={getToolById("tasks.create")}
        onClose={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Review this action");
    expect(html).toContain("Create task");
    expect(html).toContain("tasks.create");
    expect(html).toContain("single_step");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Cancel");
  });

  it("does not emit approval merely by rendering", () => {
    const onDecision = vi.fn();

    renderToString(
      <StepApprovalDialog
        open
        step={step()}
        stepApproval={approval()}
        tool={getToolById("tasks.create")}
        onClose={vi.fn()}
        onDecision={onDecision}
      />,
    );

    expect(onDecision).not.toHaveBeenCalled();
  });

  it("keeps control order stable and includes Farsi approval translations", () => {
    const html = renderToString(
      <StepApprovalDialog
        open
        step={step()}
        stepApproval={approval()}
        tool={getToolById("tasks.create")}
        onClose={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(html).toContain("Approve");
    expect(html.lastIndexOf("Cancel")).toBeLessThan(html.lastIndexOf("Approve"));
    expect(translations.fa.approval_approve).toBeTruthy();
    expect(translations.fa.approval_reject).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    const html = renderToString(
      <StepApprovalDialog
        open={false}
        step={step()}
        stepApproval={approval()}
        tool={getToolById("tasks.create")}
        onClose={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(html).toBe("");
  });

  it("maps missing authentication to a visible safe approval failure", () => {
    expect(approvalFailureMessage({
      ok: false,
      decision: "failed",
      errorCode: "POLICY_DENIED",
      reason: "Approval requires an authenticated actor.",
      decidedAt: "2026-07-10T09:00:00.000Z",
      interactionVersion: "approval-interaction-v1",
    })).toContain("Authentication is required");
  });

  it("maps invalid action requests without exposing policy internals", () => {
    expect(approvalFailureMessage({
      ok: false,
      decision: "failed",
      errorCode: "TARGET_MISMATCH",
      reason: "Approval must match the exact step target.",
      decidedAt: "2026-07-10T09:00:00.000Z",
      interactionVersion: "approval-interaction-v1",
    })).toContain("action request is no longer valid");
  });

  it("keeps approval failure visible and does not close as approved", async () => {
    const onClose = vi.fn();
    const onDecision = vi.fn();
    vi.mocked(approveWorkspaceStep).mockResolvedValue({
      ok: false,
      decision: "failed",
      errorCode: "POLICY_DENIED",
      reason: "Execution policy denied approval for this intent.",
      decidedAt: "2026-07-10T09:00:00.000Z",
      interactionVersion: "approval-interaction-v1",
    });

    render(
      <StepApprovalDialog
        open
        step={step({ actionType: "complete", targetId: "task-1" })}
        stepApproval={approval({ targetId: "task-1", toolId: "tasks.complete" })}
        tool={getToolById("tasks.complete")}
        onClose={onClose}
        onDecision={onDecision}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Approval is not permitted for this action.");
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("retries after failure and closes after a later successful approval", async () => {
    const onClose = vi.fn();
    const onDecision = vi.fn();
    const success: ApprovalInteractionResult = {
      ok: true,
      decision: "approved",
      approval: approval({ status: "approved", executionIntentApprovalId: "approval:ok" }),
      decidedAt: "2026-07-10T09:00:01.000Z",
      interactionVersion: "approval-interaction-v1",
    };
    vi.mocked(approveWorkspaceStep)
      .mockResolvedValueOnce({
        ok: false,
        decision: "failed",
        errorCode: "POLICY_DENIED",
        reason: "Approval requires an authenticated actor.",
        decidedAt: "2026-07-10T09:00:00.000Z",
        interactionVersion: "approval-interaction-v1",
      })
      .mockResolvedValueOnce(success);

    render(
      <StepApprovalDialog
        open
        step={step({ actionType: "complete", targetId: "task-1" })}
        stepApproval={approval({ targetId: "task-1", toolId: "tasks.complete" })}
        tool={getToolById("tasks.complete")}
        onClose={onClose}
        onDecision={onDecision}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication is required");

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDecision).toHaveBeenCalledTimes(2);
  });

  it("sends one approval request for rapid double-click and disables while pending", async () => {
    const onDecision = vi.fn();
    let resolveApproval!: (result: ApprovalInteractionResult) => void;
    vi.mocked(approveWorkspaceStep).mockImplementation(() => new Promise((resolve) => {
      resolveApproval = resolve;
    }));

    render(
      <StepApprovalDialog
        open
        step={step({ actionType: "complete", targetId: "task-1" })}
        stepApproval={approval({ targetId: "task-1", toolId: "tasks.complete" })}
        tool={getToolById("tasks.complete")}
        onClose={vi.fn()}
        onDecision={onDecision}
      />,
    );

    const approveButton = screen.getByRole("button", { name: /approve/i });
    await userEvent.dblClick(approveButton);

    expect(approveWorkspaceStep).toHaveBeenCalledTimes(1);
    expect(approveButton).toBeDisabled();

    resolveApproval({
      ok: true,
      decision: "approved",
      approval: approval({ status: "approved", executionIntentApprovalId: "approval:ok" }),
      decidedAt: "2026-07-10T09:00:00.000Z",
      interactionVersion: "approval-interaction-v1",
    });

    await waitFor(() => expect(onDecision).toHaveBeenCalledTimes(1));
  });
});
