// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SESSION_STORAGE_KEY,
  NEW_CHAT_PERSISTED_MARKER,
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

  it("marker -> empty (PO decision, v2 follow-up): the persisted new-chat marker resolves to empty even though sessions exist and explicitNewChat is false -- a reload after pressing New Chat stays on the new chat", () => {
    const result = resolveActiveSessionOnMount({
      persistedSessionId: NEW_CHAT_PERSISTED_MARKER,
      sessions,
      explicitNewChat: false,
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

  it("persisting null writes the new-chat MARKER over any previously persisted value (New Chat's own outcome) -- deliberately NOT a key removal, so it stays distinguishable from 'never persisted'", () => {
    persistActiveSessionId("s-123");
    persistActiveSessionId(null);
    expect(readPersistedActiveSessionId()).toBe(NEW_CHAT_PERSISTED_MARKER);
    expect(window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBe(NEW_CHAT_PERSISTED_MARKER);
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

  it("New Chat pressed, THEN an ORDINARY reload happens before anything is sent: the persisted new-chat marker keeps the reload on the EMPTY chat (PO decision, v2 follow-up -- this exact sequence used to resume the previous session and was documented as an accepted residual case; it no longer is)", () => {
    const sessions = [{ id: "s-active" }, { id: "s-other" }];
    // The user was in s-active (persisted), then pressed New Chat --
    // ChatPage.tsx's real startNewChat() persists the marker for exactly
    // this reason: a reload right after (before anything is sent) must
    // land back on the NEW chat, not drag back the previous session.
    persistActiveSessionId("s-active");
    persistActiveSessionId(null);
    expect(readPersistedActiveSessionId()).toBe(NEW_CHAT_PERSISTED_MARKER);

    // An ordinary reload at THIS exact moment -- ChatPage's own mount
    // effect always passes explicitNewChat:false; the persisted marker
    // alone must win, with sessions deliberately NON-empty and s-active
    // still the most recently updated one (proving this isn't a
    // coincidence of an empty session list).
    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: false,
    });

    expect(resolution).toEqual({ kind: "empty" });
  });

  it("first-ever load stays unaffected by the marker design: an ABSENT key (nothing ever persisted) still resumes the most recent session -- the marker, not key removal, is what encodes New Chat", () => {
    const sessions = [{ id: "s-active" }, { id: "s-other" }];
    expect(readPersistedActiveSessionId()).toBeNull();

    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: false,
    });

    expect(resolution).toEqual({ kind: "resume", sessionId: "s-active" });
  });

  it("sending the first message of the new chat overwrites the marker with the real session id, so the NEXT reload resumes that new conversation", () => {
    const sessions = [{ id: "s-new" }, { id: "s-active" }];
    persistActiveSessionId(null);
    // handleSend created the session and ChatPage's sync effect persisted it:
    persistActiveSessionId("s-new");

    const resolution = resolveActiveSessionOnMount({
      persistedSessionId: readPersistedActiveSessionId(),
      sessions,
      explicitNewChat: false,
    });

    expect(resolution).toEqual({ kind: "resume", sessionId: "s-new" });
  });
});
