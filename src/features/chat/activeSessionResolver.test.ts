// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SESSION_STORAGE_KEY,
  persistActiveSessionId,
  readPersistedActiveSessionId,
  resolveActiveSessionOnMount,
} from "./activeSessionResolver";

describe("resolveActiveSessionOnMount (task 17f, C1b)", () => {
  const sessions = [{ id: "s-recent" }, { id: "s-older" }, { id: "s-oldest" }];

  it("persisted -> resume: a persisted session id that still exists in the session list resumes that exact session, even if it is not the most recent one", () => {
    const result = resolveActiveSessionOnMount({
      persistedSessionId: "s-older",
      sessions,
      explicitNewChat: false,
    });
    expect(result).toEqual({ kind: "resume", sessionId: "s-older" });
  });

  it("missing -> most recent: a persisted session id that no longer exists (deleted elsewhere) falls back to the most recent session, not empty", () => {
    const result = resolveActiveSessionOnMount({
      persistedSessionId: "s-deleted",
      sessions,
      explicitNewChat: false,
    });
    expect(result).toEqual({ kind: "resume", sessionId: "s-recent" });
  });

  it("no persisted id at all (first-ever load on this device) also falls back to the most recent session", () => {
    const result = resolveActiveSessionOnMount({
      persistedSessionId: null,
      sessions,
      explicitNewChat: false,
    });
    expect(result).toEqual({ kind: "resume", sessionId: "s-recent" });
  });

  it("none -> empty: no sessions exist at all (persisted or not) resolves to the empty state", () => {
    const result = resolveActiveSessionOnMount({
      persistedSessionId: "s-anything",
      sessions: [],
      explicitNewChat: false,
    });
    expect(result).toEqual({ kind: "empty" });
  });

  it("New -> empty: explicitNewChat always resolves to empty, even with a valid persisted session and other sessions available", () => {
    const result = resolveActiveSessionOnMount({
      persistedSessionId: "s-older",
      sessions,
      explicitNewChat: true,
    });
    expect(result).toEqual({ kind: "empty" });
  });
});

// Same MemoryStorage shim ChatPageHeader.test.tsx already uses for
// localStorage-backed tests in this codebase -- the environment's own
// `window.localStorage` here is a bare stub without `.clear()`.
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

describe("persistActiveSessionId / readPersistedActiveSessionId", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("round-trips a session id through localStorage under the documented key", () => {
    persistActiveSessionId("s-123");
    expect(window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBe("s-123");
    expect(readPersistedActiveSessionId()).toBe("s-123");
  });

  it("persisting null clears any previously persisted value (New Chat's own outcome)", () => {
    persistActiveSessionId("s-123");
    persistActiveSessionId(null);
    expect(readPersistedActiveSessionId()).toBeNull();
  });

  it("readPersistedActiveSessionId returns null, never throws, when localStorage access fails (private browsing/quota)", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => readPersistedActiveSessionId()).not.toThrow();
    expect(readPersistedActiveSessionId()).toBeNull();
  });

  it("persistActiveSessionId never throws when localStorage access fails", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => persistActiveSessionId("s-123")).not.toThrow();
  });
});
