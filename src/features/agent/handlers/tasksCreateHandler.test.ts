import { beforeEach, describe, expect, it, vi } from "vitest";

const taskServiceMock = vi.hoisted(() => ({
  createTask: vi.fn(),
  getTaskForUser: vi.fn(),
}));

vi.mock("@/features/tasks/tasksService", () => ({ tasksService: taskServiceMock }));

import { tasksCreateHandler } from "./tasksCreateHandler";

describe("tasksCreateHandler", () => {
  beforeEach(() => {
    taskServiceMock.createTask.mockReset();
    taskServiceMock.getTaskForUser.mockReset();
  });

  it("validates input and rejects unknown fields", () => {
    expect(tasksCreateHandler.validateInput({ userId: "u", title: "Call Ahmad" }, []).valid).toBe(true);
    expect(tasksCreateHandler.validateInput({ userId: "u" }, []).valid).toBe(false);
  });

  describe("BLOCKER A: no agentToolExecutionClient => fail closed, never a direct write", () => {
    it("returns a bounded failure and performs no tasksService mutation", async () => {
      const result = await tasksCreateHandler.execute({ userId: "user-1", title: "Call Ahmad" }, {});

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(taskServiceMock.createTask).not.toHaveBeenCalled();
      expect(taskServiceMock.getTaskForUser).not.toHaveBeenCalled();
    });
  });

  // Chat V2 Slice 2A, BLOCKER 1 CORRECTION: the client/handler contract
  // split requestAndExecute() into requestExecution() (called BEFORE
  // approval, by writeRuntime.ts's requestWriteExecution) and
  // approveExecution() (called here, by this handler, at approval time,
  // with nothing but the already-existing executionId). This handler no
  // longer builds or sends arguments at all -- they were already durably
  // recorded by the earlier request call.
  describe("BLOCKER 1: approveExecution requires a pre-existing pendingAgentExecutionId", () => {
    it("fails closed when agentToolExecutionClient is present but no pre-approval request ever completed", async () => {
      const approveExecution = vi.fn();
      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution } },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(approveExecution).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient.approveExecution(pendingAgentExecutionId) instead of tasksService.createTask when present", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "created", targetId: "task-99" });

      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad", dueDate: "2026-09-01" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(approveExecution).toHaveBeenCalledWith("exec-1");
      expect(taskServiceMock.createTask).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ taskId: "task-99", title: "Call Ahmad", verified: true });
    });

    it("a failed execution (e.g. clarification needed) is reported as a failure, not a fabricated success", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "What should the task be called?", errorCode: "CLARIFICATION_NEEDED" });

      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CLARIFICATION_NEEDED");
    });

    it("an 'uncertain' outcome is reported as a failure, never a fabricated success", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "uncertain", reply: "We could not confirm this completed.", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });

      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("EXECUTION_OUTCOME_UNKNOWN");
    });

    it("a succeeded outcome missing a target id is treated as a failure -- never fabricates a task id", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "created" });
      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );
      expect(result.status).toBe("failed");
    });
  });
});
