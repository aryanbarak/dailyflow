import { beforeEach, describe, expect, it, vi } from "vitest";

const calendarServiceMock = vi.hoisted(() => ({
  update: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock("@/features/calendar/calendarService", () => ({ calendarService: calendarServiceMock }));

import { calendarUpdateEventHandler } from "./calendarUpdateEventHandler";

describe("calendarUpdateEventHandler", () => {
  beforeEach(() => {
    calendarServiceMock.update.mockReset();
    calendarServiceMock.getAll.mockReset();
  });

  it("validates input and requires at least one update field", () => {
    expect(calendarUpdateEventHandler.validateInput({ userId: "u", eventId: "e", title: "New" }, []).valid).toBe(true);
    expect(calendarUpdateEventHandler.validateInput({ userId: "u", eventId: "e" }, []).valid).toBe(false);
  });

  describe("BLOCKER A: no agentToolExecutionClient => fail closed, never a direct write", () => {
    it("returns a bounded failure and performs no calendarService mutation", async () => {
      const result = await calendarUpdateEventHandler.execute({ userId: "user-1", eventId: "event-1", title: "New title" }, {});

      expect(result.status).toBe("failed");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(calendarServiceMock.update).not.toHaveBeenCalled();
      expect(calendarServiceMock.getAll).not.toHaveBeenCalled();
    });
  });

  describe("BLOCKER 1: approveExecution requires a pre-existing pendingAgentExecutionId", () => {
    it("fails closed when agentToolExecutionClient is present but no pre-approval request ever completed", async () => {
      const approveExecution = vi.fn();
      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution } },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("AGENT_EXECUTION_NOT_REQUESTED");
      expect(approveExecution).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient.approveExecution(pendingAgentExecutionId) instead of calendarService.update when present", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "updated", title: "New title", dateTimeStart: "2026-09-01T08:30:00.000Z" });

      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(approveExecution).toHaveBeenCalledWith("exec-1");
      expect(calendarServiceMock.update).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ eventId: "event-1", title: "New title", verified: true });
    });

    // BLOCKER 3: result data comes from the Worker's AUTHORITATIVE response,
    // never an echo of what was requested.
    it("builds result data from the Worker's authoritative title/dateTimeStart, not the locally-echoed request", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "updated", title: "Server-confirmed title", dateTimeStart: "2026-09-03T14:00:00.000Z" });

      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", notes: "just notes, no title in the request" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.data).toMatchObject({ title: "Server-confirmed title", dateTimeStart: "2026-09-03T14:00:00.000Z" });
    });

    it("a failed execution is reported as a failure, not a fabricated success", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "not found", errorCode: "TARGET_NOT_FOUND" });

      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("TARGET_NOT_FOUND");
    });

    it("an 'uncertain' outcome is reported as a failure, never a fabricated success", async () => {
      const approveExecution = vi.fn().mockResolvedValueOnce({ status: "uncertain", reply: "We could not confirm this completed.", errorCode: "EXECUTION_OUTCOME_UNKNOWN" });

      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", title: "New title" },
        { agentToolExecutionClient: { requestExecution: vi.fn(), approveExecution }, pendingAgentExecutionId: "exec-1" },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("EXECUTION_OUTCOME_UNKNOWN");
    });
  });
});
