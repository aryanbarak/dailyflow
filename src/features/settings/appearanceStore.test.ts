// @vitest-environment jsdom
//
// Task 17h: coverage for appearanceStore's new orb* fields (the
// SmartflowPointerFollower settings) -- enabled/colour/size/opacity,
// their persistence, and rehydration across a simulated reload. Mirrors
// chatDisplayPreferencesStore.test.ts's own MemoryStorage shim/freshStore
// pattern (documented there: this environment's real `localStorage`
// global is non-functional, so zustand's persist middleware -- which
// resolves `localStorage` at store-creation time, not lazily -- needs a
// working stub in place BEFORE each fresh module import).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useAppearance as UseAppearance } from "./appearanceStore";

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

async function freshStore() {
  vi.resetModules();
  return import("./appearanceStore");
}

describe("useAppearance orb* preferences (task 17h)", () => {
  let mod: Awaited<ReturnType<typeof freshStore>>;
  let store: typeof UseAppearance;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    mod = await freshStore();
    store = mod.useAppearance;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults reproduce the pointer follower's ORIGINAL hardcoded look exactly (enabled, primary, medium/144px, 0.72 opacity)", () => {
    const state = store.getState();
    expect(state.orbEnabled).toBe(true);
    expect(state.orbColor).toBe("primary");
    expect(state.orbSize).toBe("medium");
    expect(mod.ORB_SIZE_PX[state.orbSize]).toBe(144);
    expect(state.orbOpacity).toBe(0.72);
  });

  it("ORB_COLOR_VAR only exposes existing --flow-* tokens (primary/blue/cyan + the six quick-action accents) -- no free colour picker", () => {
    expect(mod.ORB_COLOR_VAR).toEqual({
      primary: "--flow-primary",
      blue: "--flow-blue",
      cyan: "--flow-cyan",
      study: "--flow-study",
      plan: "--flow-plan",
      analyze: "--flow-analyze",
      review: "--flow-review",
      report: "--flow-report",
      career: "--flow-career",
    });
  });

  it("ORB_SIZE_PX defines 4 discrete steps, medium = 144 (today's value)", () => {
    expect(Object.keys(mod.ORB_SIZE_PX)).toHaveLength(4);
    expect(mod.ORB_SIZE_PX).toEqual({ small: 96, medium: 144, large: 192, xl: 240 });
  });

  it("ORB_OPACITY_STEPS defines 4-5 discrete steps including today's 0.72 default", () => {
    expect(mod.ORB_OPACITY_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(mod.ORB_OPACITY_STEPS.length).toBeLessThanOrEqual(5);
    expect(mod.ORB_OPACITY_STEPS).toContain(0.72);
  });

  it("setOrbEnabled/setOrbColor/setOrbSize/setOrbOpacity each set an explicit value", () => {
    store.getState().setOrbEnabled(false);
    expect(store.getState().orbEnabled).toBe(false);
    store.getState().setOrbColor("cyan");
    expect(store.getState().orbColor).toBe("cyan");
    store.getState().setOrbSize("xl");
    expect(store.getState().orbSize).toBe("xl");
    store.getState().setOrbOpacity(0.3);
    expect(store.getState().orbOpacity).toBe(0.3);
  });

  it("persists orb preferences to localStorage under the SAME existing 'smartflow:appearance' key -- no new storage key introduced", () => {
    store.getState().setOrbEnabled(false);
    store.getState().setOrbColor("study");
    store.getState().setOrbSize("large");
    store.getState().setOrbOpacity(0.9);
    const stored = JSON.parse(localStorage.getItem("smartflow:appearance") ?? "{}");
    expect(stored.state).toMatchObject({
      orbEnabled: false,
      orbColor: "study",
      orbSize: "large",
      orbOpacity: 0.9,
    });
  });

  it("restores previously persisted orb preferences across a simulated reload (rehydration)", async () => {
    store.getState().setOrbEnabled(false);
    store.getState().setOrbColor("review");
    store.getState().setOrbSize("small");
    store.getState().setOrbOpacity(0.5);
    const persistedRaw = localStorage.getItem("smartflow:appearance");
    expect(persistedRaw).toBeTruthy();

    const reloaded = await freshStore();
    const rehydrated = reloaded.useAppearance.getState();
    expect(rehydrated.orbEnabled).toBe(false);
    expect(rehydrated.orbColor).toBe("review");
    expect(rehydrated.orbSize).toBe("small");
    expect(rehydrated.orbOpacity).toBe(0.5);
  });
});
