// @vitest-environment jsdom
//
// CORE-W1 (2026-09-06): three-phase network status. The pre-existing
// boolean contract (isOnline) is pinned alongside the new phase machine
// so MicroBreakOverlay's consumption cannot regress.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { RECONNECTED_HOLD_MS, useNetworkStatus } from "./useNetworkStatus";

function goOffline() {
  window.dispatchEvent(new Event("offline"));
}

function goOnline() {
  window.dispatchEvent(new Event("online"));
}

describe("useNetworkStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts online with status 'online' (never 'reconnected')", () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.status).toBe("online");
  });

  it("moves to 'offline' on the browser offline event", () => {
    const { result } = renderHook(() => useNetworkStatus());
    act(goOffline);
    expect(result.current.isOnline).toBe(false);
    expect(result.current.status).toBe("offline");
  });

  it("flashes 'reconnected' after an offline period, then settles to 'online'", () => {
    const { result } = renderHook(() => useNetworkStatus());
    act(goOffline);
    act(goOnline);
    expect(result.current.isOnline).toBe(true);
    expect(result.current.status).toBe("reconnected");
    act(() => {
      vi.advanceTimersByTime(RECONNECTED_HOLD_MS);
    });
    expect(result.current.status).toBe("online");
  });

  it("an online event without a preceding offline period stays 'online'", () => {
    const { result } = renderHook(() => useNetworkStatus());
    act(goOnline);
    expect(result.current.status).toBe("online");
  });

  it("going offline during the 'reconnected' hold returns to 'offline' without a late flip", () => {
    const { result } = renderHook(() => useNetworkStatus());
    act(goOffline);
    act(goOnline);
    expect(result.current.status).toBe("reconnected");
    act(goOffline);
    expect(result.current.status).toBe("offline");
    // The cancelled hold timer must not fire and flip us to 'online'.
    act(() => {
      vi.advanceTimersByTime(RECONNECTED_HOLD_MS * 2);
    });
    expect(result.current.status).toBe("offline");
  });
});
