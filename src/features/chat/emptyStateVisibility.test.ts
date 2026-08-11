import { describe, expect, it } from "vitest";
import { isChatEmptyState } from "./emptyStateVisibility";

describe("isChatEmptyState (task 17b)", () => {
  it("is true for a brand-new conversation: no active session, no messages, not sending", () => {
    expect(isChatEmptyState({ hasActiveSession: false, messageCount: 0, isSending: false })).toBe(true);
  });

  it("is false once a session has been created (first message sent)", () => {
    expect(isChatEmptyState({ hasActiveSession: true, messageCount: 0, isSending: false })).toBe(false);
  });

  it("is false once any messages exist", () => {
    expect(isChatEmptyState({ hasActiveSession: false, messageCount: 1, isSending: false })).toBe(false);
  });

  it("is false while the first message is in flight (sending), even before the session/messages state updates", () => {
    expect(isChatEmptyState({ hasActiveSession: false, messageCount: 0, isSending: true })).toBe(false);
  });

  it("stays false for an existing conversation with history", () => {
    expect(isChatEmptyState({ hasActiveSession: true, messageCount: 12, isSending: false })).toBe(false);
  });
});
