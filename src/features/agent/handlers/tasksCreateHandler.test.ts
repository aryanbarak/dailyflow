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
      expect(result.error?.code).toBe("AGENT_EXECUTION_CLIENT_UNAVAILABLE");
      expect(taskServiceMock.createTask).not.toHaveBeenCalled();
      expect(taskServiceMock.getTaskForUser).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient instead of tasksService.createTask when present", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "created", targetId: "task-99" });

      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad", dueDate: "2026-09-01" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(requestAndExecute).toHaveBeenCalledWith(expect.objectContaining({
        toolId: "tasks.create",
        arguments: expect.objectContaining({ title: "Call Ahmad", dueDate: "2026-09-01" }),
      }));
      expect(taskServiceMock.createTask).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ taskId: "task-99", title: "Call Ahmad", verified: true });
    });

    it("a failed execution (e.g. clarification needed) is reported as a failure, not a fabricated success", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "What should the task be called?", errorCode: "CLARIFICATION_NEEDED" });

      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CLARIFICATION_NEEDED");
    });

    it("a succeeded outcome missing a target id is treated as a failure -- never fabricates a task id", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "created" });
      const result = await tasksCreateHandler.execute(
        { userId: "user-1", title: "Call Ahmad" },
        { agentToolExecutionClient: { requestAndExecute } },
      );
      expect(result.status).toBe("failed");
    });
  });
});
