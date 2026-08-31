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
      expect(result.error?.code).toBe("AGENT_EXECUTION_CLIENT_UNAVAILABLE");
      expect(calendarServiceMock.update).not.toHaveBeenCalled();
      expect(calendarServiceMock.getAll).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient instead of calendarService.update when present", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "updated" });

      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", title: "New title" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(requestAndExecute).toHaveBeenCalledWith(expect.objectContaining({
        toolId: "calendar.update_event",
        targetId: "event-1",
        arguments: expect.objectContaining({ title: "New title" }),
      }));
      expect(calendarServiceMock.update).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ eventId: "event-1", title: "New title", verified: true });
    });

    it("a failed execution is reported as a failure, not a fabricated success", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "not found", errorCode: "TARGET_NOT_FOUND" });

      const result = await calendarUpdateEventHandler.execute(
        { userId: "user-1", eventId: "event-1", title: "New title" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("TARGET_NOT_FOUND");
    });
  });
});
