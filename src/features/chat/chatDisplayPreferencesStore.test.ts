// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useChatDisplayPreferences as UseChatDisplayPreferences } from "./chatDisplayPreferencesStore";

// Mirrors src/features/workspace/interactionTracker.test.ts's own
// MemoryStorage shim -- this test environment's real `localStorage`
// global is non-functional (Node's experimental webstorage global
// shadows jsdom's working implementation here without a valid
// --localstorage-file path; every method throws "is not a function"),
// a known, already-worked-around environment quirk in this codebase, not
// something specific to this store.
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

// zustand's persist middleware resolves `localStorage` when the store is
// CREATED (module evaluation), not lazily per call -- so the stub must be
// in place BEFORE the module is imported. vi.resetModules() + a dynamic
// import per test (rather than one static top-level import) is what makes
// that possible.
async function freshStore() {
  vi.resetModules();
  return import("./chatDisplayPreferencesStore");
}

describe("useChatDisplayPreferences", () => {
  let mod: Awaited<ReturnType<typeof freshStore>>;
  let store: typeof UseChatDisplayPreferences;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    mod = await freshStore();
    store = mod.useChatDisplayPreferences;
    store.setState({ theme: "dark", density: "comfortable" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggleTheme flips between light and dark", () => {
    store.setState({ theme: "dark" });
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe("light");
    store.getState().toggleTheme();
    expect(store.getState().theme).toBe("dark");
  });

  it("toggleDensity flips between comfortable and compact", () => {
    store.setState({ density: "comfortable" });
    store.getState().toggleDensity();
    expect(store.getState().density).toBe("compact");
    store.getState().toggleDensity();
    expect(store.getState().density).toBe("comfortable");
  });

  it("setTheme/setDensity set an explicit value regardless of the current one", () => {
    store.getState().setTheme("light");
    expect(store.getState().theme).toBe("light");
    store.getState().setDensity("compact");
    expect(store.getState().density).toBe("compact");
  });

  it("is configured to persist under its own dedicated chat-scoped key, distinct from appearanceStore's global key", () => {
    expect(store.persist.getOptions().name).toBe(mod.CHAT_DISPLAY_PREFERENCES_STORAGE_KEY);
    expect(mod.CHAT_DISPLAY_PREFERENCES_STORAGE_KEY).not.toBe("smartflow:appearance");
  });

  it("persists theme + density to localStorage under that key on every change", () => {
    store.getState().setTheme("light");
    store.getState().setDensity("compact");
    const stored = JSON.parse(localStorage.getItem(mod.CHAT_DISPLAY_PREFERENCES_STORAGE_KEY) ?? "{}");
    expect(stored.state).toMatchObject({ theme: "light", density: "compact" });
  });

  it("restores a previously persisted preference across a simulated reload (rehydration)", async () => {
    store.getState().setTheme("light");
    store.getState().setDensity("compact");
    const persistedRaw = localStorage.getItem(mod.CHAT_DISPLAY_PREFERENCES_STORAGE_KEY);
    expect(persistedRaw).toBeTruthy();

    // Simulate a real reload: fresh module graph, SAME (stubbed)
    // localStorage content already present -- persist rehydrates from it
    // during store creation.
    const reloaded = await freshStore();
    expect(reloaded.useChatDisplayPreferences.getState().theme).toBe("light");
    expect(reloaded.useChatDisplayPreferences.getState().density).toBe("compact");
  });
});

describe("systemPrefersDarkChatTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reflects prefers-color-scheme: dark when matchMedia reports it", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const mod = await freshStore();
    expect(mod.systemPrefersDarkChatTheme()).toBe(true);
  });

  it("reflects prefers-color-scheme: light when matchMedia reports no dark match", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    const mod = await freshStore();
    expect(mod.systemPrefersDarkChatTheme()).toBe(false);
  });

  it("defaults to dark (defensive fallback) when matchMedia is unavailable, never throwing", async () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("localStorage", new MemoryStorage());
    const mod = await freshStore();
    expect(() => mod.systemPrefersDarkChatTheme()).not.toThrow();
    expect(mod.systemPrefersDarkChatTheme()).toBe(true);
  });

  it("a first-ever load (no persisted value) defaults theme to the system preference", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false })); // light
    vi.stubGlobal("localStorage", new MemoryStorage());
    const mod = await freshStore();
    expect(mod.useChatDisplayPreferences.getState().theme).toBe("light");
  });
});
