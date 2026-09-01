import { beforeEach, describe, expect, it, vi } from "vitest";

const calendarServiceMock = vi.hoisted(() => ({
  create: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock("@/features/calendar/calendarService", () => ({ calendarService: calendarServiceMock }));

import { calendarCreateEventHandler } from "./calendarCreateEventHandler";

describe("calendarCreateEventHandler", () => {
  beforeEach(() => {
    calendarServiceMock.create.mockReset();
    calendarServiceMock.getAll.mockReset();
  });

  it("validates a required, well-formed dateTimeStart", () => {
    expect(calendarCreateEventHandler.validateInput({ userId: "u", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" }, []).valid).toBe(true);
    expect(calendarCreateEventHandler.validateInput({ userId: "u", title: "Standup", dateTimeStart: "not-a-date" }, []).valid).toBe(false);
  });

  describe("BLOCKER A: no agentToolExecutionClient => fail closed, never a direct write", () => {
    it("returns a bounded failure and performs no calendarService mutation", async () => {
      const result = await calendarCreateEventHandler.execute({ userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" }, {});

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(calendarServiceMock.create).not.toHaveBeenCalled();
      expect(calendarServiceMock.getAll).not.toHaveBeenCalled();
    });
  });

  describe("BLOCKER 1: approveExecution requires a pre-existing pendingAgentExecutionId", () => {
    it("fails closed when agentToolExecutionClient is present but no pre-approval request ever completed", async () => {
      const approveExecution = vi.fn();
      const result = await calendarCreateEventHandler.execute(
        { userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution } },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(approveExecution).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient.approveExecution(pendingAgentExecutionId) instead of calendarService.create when present", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "created", targetId: "event-42" });

      const result = await calendarCreateEventHandler.execute(
        { userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(approveExecution).toHaveBeenCalledWith("exec-1");
      expect(calendarServiceMock.create).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ eventId: "event-42", verified: true });
    });

    it("a failed execution never fabricates a success result", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "Unable to create.", errorCode: "EXECUTION_FAILED" });
      const result = await calendarCreateEventHandler.execute(
        { userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("EXECUTION_FAILED");
    });

    it("an 'uncertain' outcome never fabricates a success result", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "uncertain", reply: "We could not confirm this completed.", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });
      const result = await calendarCreateEventHandler.execute(
        { userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("EXECUTION_OUTCOME_UNKNOWN");
    });
  });
});
