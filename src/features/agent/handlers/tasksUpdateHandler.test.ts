import { beforeEach, describe, expect, it, vi } from "vitest";

const taskServiceMock = vi.hoisted(() => ({
  updateTask: vi.fn(),
  getTaskForUser: vi.fn(),
}));

vi.mock("@/features/tasks/tasksService", () => ({ tasksService: taskServiceMock }));

import { tasksUpdateHandler } from "./tasksUpdateHandler";

describe("tasksUpdateHandler", () => {
  beforeEach(() => {
    taskServiceMock.updateTask.mockReset();
    taskServiceMock.getTaskForUser.mockReset();
  });

  it("validates input and requires at least one update field", () => {
    expect(tasksUpdateHandler.validateInput({ userId: "u", taskId: "t", title: "New" }, []).valid).toBe(true);
    expect(tasksUpdateHandler.validateInput({ userId: "u", taskId: "t" }, []).valid).toBe(false);
  });

  describe("BLOCKER A: no agentToolExecutionClient => fail closed, never a direct write", () => {
    it("returns a bounded failure and performs no tasksService mutation", async () => {
      const result = await tasksUpdateHandler.execute({ userId: "user-1", taskId: "task-1", title: "New title" }, {});

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(taskServiceMock.updateTask).not.toHaveBeenCalled();
      expect(taskServiceMock.getTaskForUser).not.toHaveBeenCalled();
    });
  });

  describe("BLOCKER 1: approveExecution requires a pre-existing pendingAgentExecutionId", () => {
    it("fails closed when agentToolExecutionClient is present but no pre-approval request ever completed", async () => {
      const approveExecution = vi.fn();
      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution } },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(approveExecution).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient.approveExecution(pendingAgentExecutionId) instead of tasksService.updateTask when present", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "updated", title: "New title", dueDate: null });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(approveExecution).toHaveBeenCalledWith("exec-1");
      expect(taskServiceMock.updateTask).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ taskId: "task-1", title: "New title", verified: true });
    });

    // BLOCKER 3: result data comes from the Worker's AUTHORITATIVE response,
    // never an echo of what was requested -- a title the handler was never
    // told back about must not appear in the result.
    it("builds result data from the Worker's authoritative title/dueDate, not the locally-echoed request", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "updated", title: "Server-confirmed title", dueDate: "2026-10-01" });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", notes: "just notes, no title in the request" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.data).toMatchObject({ title: "Server-confirmed title", dueDate: "2026-10-01" });
    });

    it("a failed execution is reported as a failure, not a fabricated success", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "not found", errorCode: "TARGET_NOT_FOUND" });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("TARGET_NOT_FOUND");
    });

    it("an 'uncertain' outcome is reported as a failure, never a fabricated success", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "uncertain", reply: "We could not confirm this completed.", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("EXECUTION_OUTCOME_UNKNOWN");
    });

    it("a thrown client error is normalized, not left to propagate raw", async () => {
      const approveExecution = vi.fn().mockRejectedValueOnce({ code: "POLICY_DENIED", message: "Denied." });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("POLICY_DENIED");
    });
  });
});
