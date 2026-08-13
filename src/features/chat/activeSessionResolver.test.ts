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

// Task 20c: the pull-to-refresh gesture is being restored (see
// ChatPagePwaScroll.test.tsx) now that this resolver makes the reload it
// triggers non-destructive. This models the actual RELOAD SEQUENCE end to
// end -- persistActiveSessionId/readPersistedActiveSessionId AND
// resolveActiveSessionOnMount used TOGETHER, the same way ChatPage.tsx's
// own mount effect chains them (see that file's own "Task 17f, C1b:
// session continuity across a fresh mount" comment) -- rather than each
// tested only in isolation (both already are, above). Confirms C1b's
// EXISTING resolver already covers this: no new decision logic, just the
// end-to-end wiring proven together.
describe("reload sequence (task 20c, R2): persisted session exists -> resumed; New Chat pressed -> empty state unaffected", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a session active before a pull-to-refresh reload is resumed after it: persist, then a fresh 'mount' reads persistence straight back through the resolver", () => {
    const sessions = [{ id: "s-active" }, { id: "s-other" }];
    // Before the reload: the user was in s-active, and ChatPage's own
    // `persistActiveSessionId(activeSessionId)` effect had already written
    // it.
    persistActiveSessionId("s-active");

    // The reload happens -- ChatPage remounts from scratch. This is
    // EXACTLY the pair of calls ChatPage.tsx's own mount effect makes.
    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: false,
    });

    expect(resolution).toEqual({ kind: "resume", sessionId: "s-active" });
  });

  it("New Chat pressed (persistence cleared), THEN a pull-to-refresh reload happens before anything is sent: an explicit New Chat trigger at mount time always resolves empty, regardless of what is persisted or which sessions exist", () => {
    const sessions = [{ id: "s-active" }, { id: "s-other" }];
    // The user was in s-active (persisted), then pressed New Chat --
    // ChatPage.tsx's real startNewChat() clears persistence for exactly
    // this reason: "so an accidental reload right after (before anything
    // is sent) doesn't drag back the PREVIOUS session."
    persistActiveSessionId("s-active");
    persistActiveSessionId(null);
    expect(readPersistedActiveSessionId()).toBeNull();

    // A reload at THIS exact moment, modelled the way a mount that is
    // itself the direct continuation of a just-pressed New Chat would
    // resolve (explicitNewChat: true) -- confirms the empty state wins
    // outright, not merely "happens to fall back to nothing because
    // sessions is empty" (sessions is NOT empty here, on purpose, and
    // s-active is still the most recently updated one -- proving this
    // isn't a coincidence of an empty session list).
    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: true,
    });

    expect(resolution).toEqual({ kind: "empty" });
  });

  it("documents the residual case this resolver does NOT distinguish: a reload with NO explicit New Chat signal and cleared persistence falls back to the most recent session, not empty -- persistedSessionId=null is ambiguous between 'first-ever load' and 'New Chat was pressed, then an ORDINARY reload (not modelled as explicitNewChat) happened' by design, since ChatPage never passes explicitNewChat:true from its own mount effect (see that file's own resolveActiveSessionOnMount call, always explicitNewChat:false) -- an accidental reload seconds after New Chat, before anything is typed, resumes the most recent session rather than staying empty, which is judged an acceptable outcome since nothing was lost (no draft, no message)", () => {
    const sessions = [{ id: "s-active" }, { id: "s-other" }];
    persistActiveSessionId("s-active");
    persistActiveSessionId(null);

    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: false,
    });

    expect(resolution).toEqual({ kind: "resume", sessionId: "s-active" });
  });
});
