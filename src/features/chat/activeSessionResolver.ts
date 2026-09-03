// SmartFlow -- task 17f, C1b. Production evidence: pull-to-refresh inside
// the chat reloads the PWA (see ChatPage.tsx's overscroll-behavior fix for
// the other half of this bug) and the reload lands on a brand-new EMPTY
// chat instead of the conversation the user was in. Root cause (see the
// task 17f report, section C): ChatPage.tsx's `activeSessionId` state
// (`useState<string | null>(null)`) has NO persistence and NO mount-time
// restoration logic at all -- every fresh mount starts at `null` with
// `messages: []`, which `isChatEmptyState` (emptyStateVisibility.ts) reads
// as "show the empty state," regardless of whether the user had an
// active, populated conversation a moment before the reload.
//
// This resolver is the ONE pure decision of what `activeSessionId` should
// be on a fresh mount, extracted the same way this file's siblings
// (chatScrollDecision.ts, emptyStateVisibility.ts) already extract their
// own single decisions -- independently testable without mounting
// ChatPage's heavy hook tree.

export interface ActiveSessionCandidate {
  readonly id: string;
}

// PO decision (SmartFlow Home v2 follow-up): pressing "New Chat" and then
// reloading must land back on the NEW empty chat, not resume the previous
// session. Task 17f's original encoding could not express that -- "New
// Chat" REMOVED the persisted key, which is indistinguishable from
// "first-ever load on this device", and the resolver's most-recent
// fallback (correct for first loads) dragged the old session back. The
// fix is this explicit marker: "New Chat" now PERSISTS the marker instead
// of removing the key, so an absent key still means "first load -> resume
// most recent", while the marker means "the user deliberately started
// fresh -> stay empty". Sending the first message overwrites the marker
// with the real new session id, exactly as before.
export const NEW_CHAT_PERSISTED_MARKER = "__new-chat__";

export interface ResolveActiveSessionOnMountInput {
  /** Read from persistence (localStorage) -- null if nothing was ever persisted (first load on this device); NEW_CHAT_PERSISTED_MARKER if the user explicitly started a new chat and nothing has been sent yet. */
  readonly persistedSessionId: string | null;
  /** Already ordered most-recent-first (useChatSessions sorts by updated_at DESC). */
  readonly sessions: readonly ActiveSessionCandidate[];
  /** True only for the equivalent of a "New Chat" action at resolution time -- ChatPage.tsx's own startNewChat() already implements this outcome directly (and clears persistence, see persistActiveSessionId), this exists so the same DECISION is expressed once, testable on its own. */
  readonly explicitNewChat: boolean;
}

export type ActiveSessionResolution =
  | { readonly kind: "resume"; readonly sessionId: string }
  | { readonly kind: "empty" };

export function resolveActiveSessionOnMount(
  input: ResolveActiveSessionOnMountInput,
): ActiveSessionResolution {
  if (input.explicitNewChat) return { kind: "empty" };

  // The user pressed New Chat and reloaded before sending anything: stay
  // on the fresh empty chat (PO decision -- see NEW_CHAT_PERSISTED_MARKER
  // above). The previous conversation stays one History click away.
  if (input.persistedSessionId === NEW_CHAT_PERSISTED_MARKER) return { kind: "empty" };

  if (input.persistedSessionId !== null) {
    const stillExists = input.sessions.some((session) => session.id === input.persistedSessionId);
    if (stillExists) return { kind: "resume", sessionId: input.persistedSessionId };
  }

  const mostRecent = input.sessions[0];
  if (mostRecent) return { kind: "resume", sessionId: mostRecent.id };

  return { kind: "empty" };
}

export const ACTIVE_SESSION_STORAGE_KEY = "smartflow:chat-active-session-id";

/** Guarded for SSR/jsdom/private-browsing storage failures -- mirrors chatDisplayPreferencesStore.ts's own systemPrefersDarkChatTheme guard pattern. */
export function readPersistedActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistActiveSessionId(sessionId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionId === null) {
      // null = "the user is deliberately on the fresh empty chat" (New
      // Chat pressed, or an explicitly-empty resolution). Persist the
      // MARKER rather than removing the key: an absent key must keep
      // meaning "first-ever load", which resumes the most recent session.
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, NEW_CHAT_PERSISTED_MARKER);
    } else {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
    }
  } catch {
    // Storage unavailable (private browsing, quota, SSR) -- session
    // continuity degrades to "always fresh," never a crash.
  }
}
