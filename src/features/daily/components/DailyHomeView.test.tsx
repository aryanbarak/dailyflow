// @vitest-environment jsdom
//
// CORE audit item 1-3 -- DailyHomeView wiring: initial date window,
// prepend/append/cap behavior, and the ResizeObserver lock/unlock
// re-snap. Policy correctness (exact counts, dateKey/DST math, the 800px
// threshold) is covered at the pure-module level (dateWindow.test.ts,
// dailyScrollDecision.test.ts) -- this file only checks the wiring.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DailyHomeView } from "./DailyHomeView";
import { dateKey, INITIAL_AFTER_DAYS, LOAD_MORE_DAYS, MAX_MOUNTED_DAYS } from "../dateWindow";

const mockUseAuth = vi.fn();
vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseTasks = vi.fn();
vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => mockUseTasks(),
}));

// DaySection pulls in JournalEditor/JournalCompanion (and transitively
// Supabase) -- irrelevant to this file's wiring concerns, stubbed to a
// marker exposing the date key it was given.
vi.mock("./DaySection", () => ({
  DaySection: ({ date }: { date: Date }) => <div data-testid="day-section">{date.toISOString().split("T")[0]}</div>,
}));

interface StubResizeObserverInstance {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let roInstances: StubResizeObserverInstance[] = [];

function setScrollMetrics(el: HTMLElement, metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: metrics.scrollTop });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: metrics.clientHeight });
}

beforeEach(() => {
  roInstances = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        roInstances.push(this);
      }
    },
  );
  mockUseAuth.mockReturnValue({ user: { id: "user-1" } });
  mockUseTasks.mockReturnValue({ tasks: [], addTask: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("DailyHomeView", () => {
  it("renders today plus INITIAL_AFTER_DAYS days ahead on first mount, calling useTasks() exactly once", () => {
    render(<DailyHomeView />);
    const sections = screen.getAllByTestId("day-section");
    expect(sections).toHaveLength(INITIAL_AFTER_DAYS + 1);
    expect(sections[0]).toHaveTextContent(dateKey(new Date()));
    expect(mockUseTasks).toHaveBeenCalledTimes(1);
  });

  it("silently prepends LOAD_MORE_DAYS older days after the initial idle delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<DailyHomeView />);
    const container = screen.getByTestId("daily-scroll-container");
    setScrollMetrics(container, { scrollTop: 500, scrollHeight: 2000, clientHeight: 800 });

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getAllByTestId("day-section")).toHaveLength(INITIAL_AFTER_DAYS + 1 + LOAD_MORE_DAYS);
  });

  it("appends newer days near the bottom edge, capping the mounted window at MAX_MOUNTED_DAYS", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // keep the initial auto-prepend from firing mid-test
    render(<DailyHomeView />);
    const container = screen.getByTestId("daily-scroll-container");

    for (let i = 0; i < 5; i++) {
      setScrollMetrics(container, { scrollTop: 5000, scrollHeight: 5100, clientHeight: 800 });
      fireEvent.scroll(container);
    }

    expect(screen.getAllByTestId("day-section")).toHaveLength(MAX_MOUNTED_DAYS);
  });

  it("re-snaps scrollTop to today while locked, and stops once unlocked by the first wheel interaction", () => {
    render(<DailyHomeView />);
    const container = screen.getByTestId("daily-scroll-container");
    Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: 500 });

    const ro = roInstances[roInstances.length - 1];
    act(() => {
      ro.callback([], ro as unknown as ResizeObserver);
    });
    // Locked: snapToToday ran, forcing scrollTop to today's (offsetTop - offset) -- 0 in jsdom.
    expect(container.scrollTop).toBe(0);

    Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: 500 });
    fireEvent.wheel(container);
    act(() => {
      ro.callback([], ro as unknown as ResizeObserver);
    });
    // Unlocked: no re-snap -- with no entries the delta branch computes 0, so scrollTop is untouched.
    expect(container.scrollTop).toBe(500);
  });

  it("does not throw when ResizeObserver is unavailable in the environment", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    expect(() => render(<DailyHomeView />)).not.toThrow();
  });

  it("renders nothing when there is no signed-in user", () => {
    mockUseAuth.mockReturnValue({ user: null });
    const { container } = render(<DailyHomeView />);
    expect(container).toBeEmptyDOMElement();
  });
});
