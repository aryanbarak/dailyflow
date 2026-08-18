// @vitest-environment jsdom
//
// ADR-0014 §5, MB-02 slice 1: while a Micro Break is active, the pointer
// follower must be FULLY suspended -- no rAF loop, no window listeners --
// mirroring smartflow-pointer-follower.test.tsx's own fresh-module +
// MemoryStorage pattern (appearanceStore's persist middleware resolves
// `localStorage` at STORE-CREATION time, too late for a plain beforeEach
// stub on a statically-imported module).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { useAppearance as UseAppearance } from "@/features/settings/appearanceStore";
import type { useMicroBreaksStore as UseMicroBreaksStore } from "@/features/micro-breaks/store/microBreaksStore";
import type { SmartflowPointerFollower as SmartflowPointerFollowerComponent } from "./smartflow-pointer-follower";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function stubFinePointerNoReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

async function freshModules() {
  vi.resetModules();
  const [appearanceMod, microBreaksMod, followerMod] = await Promise.all([
    import("@/features/settings/appearanceStore"),
    import("@/features/micro-breaks/store/microBreaksStore"),
    import("./smartflow-pointer-follower"),
  ]);
  return {
    useAppearance: appearanceMod.useAppearance as typeof UseAppearance,
    useMicroBreaksStore: microBreaksMod.useMicroBreaksStore as typeof UseMicroBreaksStore,
    SmartflowPointerFollower: followerMod.SmartflowPointerFollower as typeof SmartflowPointerFollowerComponent,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  stubFinePointerNoReducedMotion();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SmartflowPointerFollower gameActive suspension (ADR-0014 §5)", () => {
  it("gameActive: true -> renders nothing at all, exactly like orbEnabled: false", async () => {
    const { useMicroBreaksStore, SmartflowPointerFollower } = await freshModules();
    useMicroBreaksStore.getState().startBreak();
    const { container } = render(<SmartflowPointerFollower />);
    expect(container.firstChild).toBeNull();
  });

  it("gameActive: true -> attaches no pointermove listener and schedules no rAF (fully suspended, not just visually hidden)", async () => {
    const { useMicroBreaksStore, SmartflowPointerFollower } = await freshModules();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    useMicroBreaksStore.getState().startBreak();
    render(<SmartflowPointerFollower />);

    expect(addEventListenerSpy).not.toHaveBeenCalledWith("pointermove", expect.any(Function), expect.anything());
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("ending the break (gameActive -> false) resumes the pointer-follow loop: listener attaches and rAF is scheduled again", async () => {
    const { useMicroBreaksStore, SmartflowPointerFollower } = await freshModules();
    useMicroBreaksStore.getState().startBreak();
    const { container, rerender } = render(<SmartflowPointerFollower />);
    expect(container.firstChild).toBeNull();

    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    useMicroBreaksStore.getState().endBreak();
    rerender(<SmartflowPointerFollower />);

    expect(addEventListenerSpy).toHaveBeenCalledWith("pointermove", expect.any(Function), expect.anything());
    expect(rafSpy).toHaveBeenCalled();
  });

  it("gameActive: false, orbEnabled: true (defaults) -> renders normally, unaffected by the micro-breaks store existing", async () => {
    const { SmartflowPointerFollower } = await freshModules();
    const { container } = render(<SmartflowPointerFollower />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
