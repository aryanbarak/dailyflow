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
      expect(result.error?.code).toBe("AGENT_EXECUTION_CLIENT_UNAVAILABLE");
      expect(calendarServiceMock.create).not.toHaveBeenCalled();
      expect(calendarServiceMock.getAll).not.toHaveBeenCalled();
    });
  });

  describe("Chat V2 Slice 2A: server-owned execution routing", () => {
    it("routes through agentToolExecutionClient instead of calendarService.create when present", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "succeeded", reply: "created", targetId: "event-42" });

      const result = await calendarCreateEventHandler.execute(
        { userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" },
        { agentToolExecutionClient: { requestAndExecute } },
      );

      expect(requestAndExecute).toHaveBeenCalledWith(expect.objectContaining({
        toolId: "calendar.create_event",
        arguments: expect.objectContaining({ title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" }),
      }));
      expect(calendarServiceMock.create).not.toHaveBeenCalled();
      expect(result.status).toBe("success");
      expect(result.data).toMatchObject({ eventId: "event-42", verified: true });
    });

    it("a failed execution never fabricates a success result", async () => {
      const requestAndExecute = vi.fn().mockResolvedValueOnce({ status: "failed", reply: "Unable to create.", errorCode: "EXECUTION_FAILED" });
      const result = await calendarCreateEventHandler.execute(
        { userId: "user-1", title: "Standup", dateTimeStart: "2026-09-01T08:30:00.000Z" },
        { agentToolExecutionClient: { requestAndExecute } },
      );
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("EXECUTION_FAILED");
    });
  });
});
