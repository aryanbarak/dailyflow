import { beforeEach, describe, expect, it, vi } from "vitest";

const { taskServiceMock, MockTaskServiceError } = vi.hoisted(() => {
  class HoistedTaskServiceError extends Error {
    readonly code: string;
    readonly retryable: boolean;

    constructor(code: string, message: string, retryable = false) {
      super(message);
      this.name = "TaskServiceError";
      this.code = code;
      this.retryable = retryable;
    }
  }

  return {
    taskServiceMock: {
      getTaskForUser: vi.fn(),
      completeTask: vi.fn(),
    },
    MockTaskServiceError: HoistedTaskServiceError,
  };
});

vi.mock("@/features/tasks/tasksService", () => ({
  TaskServiceError: MockTaskServiceError,
  tasksService: taskServiceMock,
}));

import { tasksCompleteHandler } from "./tasksCompleteHandler";

const completedAt = "2026-07-10T09:00:00.000Z";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Sensitive task title",
    notes: "Sensitive task notes",
    dueDate: null,
    completed: false,
    completedAt: null,
    createdAt: "2026-07-09T09:00:00.000Z",
    updatedAt: "2026-07-09T09:00:00.000Z",
    ...overrides,
  };
}

describe("tasksCompleteHandler", () => {
  beforeEach(() => {
    taskServiceMock.getTaskForUser.mockReset();
    taskServiceMock.completeTask.mockReset();
  });

  it("describes a write handler without weakening the read-only handler contract", () => {
    expect(tasksCompleteHandler).toMatchObject({
      toolId: "tasks.complete",
      mode: "write",
      readOnly: false,
      externalEffect: true,
      reversible: true,
      requiresVerification: true,
      timeoutMs: 3000,
    });
  });

  it("validates exact input and rejects arbitrary update fields", () => {
    const valid = tasksCompleteHandler.validateInput({ userId: "user-1", taskId: "task-1" }, []);
    const invalid = tasksCompleteHandler.validateInput({
      userId: "user-1",
      taskId: "task-1",
      title: "must not be accepted",
      completed_at: completedAt,
    }, []);

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain("title is not allowed for tasks.complete.");
    expect(invalid.errors).toContain("completed_at is not allowed for tasks.complete.");
  });

  it("rejects invalid input without calling the task service", async () => {
    const result = await tasksCompleteHandler.execute({ taskId: "task-1" }, {});

    expect(result.status).toBe("invalid_input");
    expect(result.success).toBe(false);
    expect(taskServiceMock.getTaskForUser).not.toHaveBeenCalled();
    expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
  });

  it("completes a task via agentToolExecutionClient, verifies output shape, and emits safe output only", async () => {
    taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
    const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "done", completedAt });

    const input = { userId: " user-1 ", taskId: " task-1 " };
    const sourceInput = { ...input };
    const result = await tasksCompleteHandler.execute(input, { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" });

    expect(input).toEqual(sourceInput);
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      taskId: "task-1",
      completed: true,
      completedAt,
      alreadyCompleted: false,
      verified: true,
    });
    expect(Object.keys(result.data as Record<string, unknown>).sort()).toEqual([
      "alreadyCompleted",
      "completed",
      "completedAt",
      "taskId",
      "verified",
    ]);
    expect(JSON.stringify(result)).not.toContain("Sensitive task title");
    expect(JSON.stringify(result)).not.toContain("Sensitive task notes");
    expect(result.auditMetadata).toEqual({
      taskId: "task-1",
      alreadyCompleted: false,
      verified: true,
      resultShape: "object",
      redacted: true,
    });
    expect(result.compensation).toEqual({
      taskId: "task-1",
      previousCompleted: false,
      previousCompletedAt: null,
    });
    expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
  });

  describe("BLOCKER A: no agentToolExecutionClient => fail closed, never a direct write", () => {
    it("returns a bounded failure and performs no tasksService.completeTask mutation", async () => {
      taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());

      const result = await tasksCompleteHandler.execute({ userId: "user-1", taskId: "task-1" }, {});

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
    });
  });

  describe("BLOCKER 1: approveExecution requires a pre-existing pendingAgentExecutionId", () => {
    it("fails closed when agentToolExecutionClient is present but no pre-approval request ever completed", async () => {
      taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
      const approveExecution = vi.fn();

      const result = await tasksCompleteHandler.execute(
        { userId: "user-1", taskId: "task-1" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution } },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(approveExecution).not.toHaveBeenCalled();
    });
  });

  it("treats an already-completed exact task as a verified no-op", async () => {
    taskServiceMock.getTaskForUser.mockResolvedValueOnce(task({ completed: true, completedAt }));

    const result = await tasksCompleteHandler.execute({ userId: "user-1", taskId: "task-1" }, {});

    expect(result.status).toBe("success");
    expect(result.data).toMatchObject({
      alreadyCompleted: true,
      completedAt,
      verified: true,
    });
    expect(result.compensation).toEqual({
      taskId: "task-1",
      previousCompleted: true,
      previousCompletedAt: completedAt,
    });
    expect(taskServiceMock.getTaskForUser).toHaveBeenCalledTimes(1);
    expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
  });

  it("returns verification_failed when a succeeded outcome is missing completedAt -- never fabricates it", async () => {
    taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
    const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "done" });

    const result = await tasksCompleteHandler.execute(
      { userId: "user-1", taskId: "task-1" },
      { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
    );

    expect(result.status).toBe("verification_failed");
    expect(result.success).toBe(false);
    expect(result.auditMetadata).toMatchObject({
      taskId: "task-1",
      verified: false,
      redacted: true,
    });
    expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
  });

  it("an 'uncertain' outcome is reported as a failure, never a fabricated success", async () => {
    taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
    const approveExecution = vi.fn().mockResolvedValueOnce({ status: "uncertain", reply: "We could not confirm this completed.", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });

    const result = await tasksCompleteHandler.execute(
      { userId: "user-1", taskId: "task-1" },
      { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("EXECUTION_OUTCOME_UNKNOWN");
  });

  it("fails closed when an already-completed record lacks verifiable completion metadata", async () => {
    taskServiceMock.getTaskForUser.mockResolvedValueOnce(task({ completed: true, completedAt: null }));

    const result = await tasksCompleteHandler.execute({ userId: "user-1", taskId: "task-1" }, {});

    expect(result.status).toBe("verification_failed");
    expect(result.success).toBe(false);
    expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
  });

  it("normalizes task service errors without leaking raw payloads", async () => {
    taskServiceMock.getTaskForUser.mockRejectedValueOnce(
      new MockTaskServiceError("TASK_NOT_FOUND", "Task was not found for this user."),
    );

    const result = await tasksCompleteHandler.execute({ userId: "user-1", taskId: "task-1" }, {});

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "TASK_NOT_FOUND",
      message: "Task was not found for this user.",
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain("user-1");
  });

  it("keeps cross-user or missing targets denied by the owned-task read", async () => {
    taskServiceMock.getTaskForUser.mockRejectedValueOnce(
      new MockTaskServiceError("TASK_NOT_FOUND", "Task was not found for this user."),
    );

    const result = await tasksCompleteHandler.execute({ userId: "other-user", taskId: "task-1" }, {});

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TASK_NOT_FOUND");
    expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
  });

  // Chat V2 Slice 2A: when an agentToolExecutionClient is present in
  // context, the actual completion write routes through it instead of
  // tasksService.completeTask -- the already-completed check just above
  // (a plain read) is unaffected and stays on tasksService either way.
  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes the completion write through agentToolExecutionClient.approveExecution(pendingAgentExecutionId) instead of tasksService.completeTask", async () => {
      taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "done", completedAt });

      const result = await tasksCompleteHandler.execute(
        { userId: "user-1", taskId: "task-1" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(approveExecution).toHaveBeenCalledWith("exec-1");
      expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ taskId: "task-1", completed: true, completedAt, alreadyCompleted: false, verified: true });
    });

    it("a failed Worker execution is reported as a failure, never silently treated as success", async () => {
      taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "not found", errorCode: "TARGET_NOT_FOUND" });

      const result = await tasksCompleteHandler.execute(
        { userId: "user-1", taskId: "task-1" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("TARGET_NOT_FOUND");
      expect(taskServiceMock.completeTask).not.toHaveBeenCalled();
    });

    it("a thrown client error (e.g. server-side denial) is normalized, not left to propagate raw", async () => {
      taskServiceMock.getTaskForUser.mockResolvedValueOnce(task());
      const approveExecution = vi.fn().mockRejectedValueOnce({ code: "POLICY_DENIED", message: "Denied." });

      const result = await tasksCompleteHandler.execute(
        { userId: "user-1", taskId: "task-1" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("POLICY_DENIED");
    });

    it("the already-completed no-op path never calls the Worker at all -- it is a read, not a write", async () => {
      taskServiceMock.getTaskForUser.mockResolvedValueOnce(task({ completed: true, completedAt }));
      const approveExecution = vi.fn();

      const result = await tasksCompleteHandler.execute(
        { userId: "user-1", taskId: "task-1" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("success");
      expect(approveExecution).not.toHaveBeenCalled();
    });
  });
});
