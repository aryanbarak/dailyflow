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
      expect(result.error?.code).toBe("AGENT_EXECUTION_CLIENT_UNAVAILABLE");
      expect(taskServiceMock.updateTask).not.toHaveBeenCalled();
      expect(taskServiceMock.getTaskForUser).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient instead of tasksService.updateTask when present", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "updated" });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(requestAndExecute).toHaveBeenCalledWith(expect.objectContaining({
        toolId: "tasks.update",
        targetId: "task-1",
        arguments: expect.objectContaining({ title: "New title" }),
      }));
      expect(taskServiceMock.updateTask).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ taskId: "task-1", title: "New title", verified: true });
    });

    it("a failed execution is reported as a failure, not a fabricated success", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "not found", errorCode: "TARGET_NOT_FOUND" });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("TARGET_NOT_FOUND");
    });

    it("a thrown client error is normalized, not left to propagate raw", async () => {
      const requestAndExecute = vi.fn().mockRejectedValueOnce({ code: "POLICY_DENIED", message: "Denied." });

      const result = await tasksUpdateHandler.execute(
        { userId: "user-1", taskId: "task-1", title: "New title" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("POLICY_DENIED");
    });
  });
});
