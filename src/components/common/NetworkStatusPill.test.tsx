// @vitest-environment jsdom
//
// CORE-W1 (2026-09-06): the connectivity pill renders nothing while
// online, an offline notice while offline, and a short confirmation on
// reconnect -- announced politely (role="status" aria-live="polite").
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NetworkStatusPill } from "./NetworkStatusPill";
import { RECONNECTED_HOLD_MS } from "@/hooks/useNetworkStatus";

describe("NetworkStatusPill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing while online", () => {
    const { container } = render(<NetworkStatusPill />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the offline notice as a polite status region while offline", () => {
    render(<NetworkStatusPill />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("You're offline — changes sync when you reconnect");
  });

  it("shows 'Back online' on reconnect, then disappears after the hold", () => {
    render(<NetworkStatusPill />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Back online");
    act(() => {
      vi.advanceTimersByTime(RECONNECTED_HOLD_MS);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
