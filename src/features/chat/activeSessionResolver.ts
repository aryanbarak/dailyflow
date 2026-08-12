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

export interface ResolveActiveSessionOnMountInput {
  /** Read from persistence (localStorage) -- null if nothing was ever persisted, or the page is being loaded for the first time on this device. */
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
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
    }
  } catch {
    // Storage unavailable (private browsing, quota, SSR) -- session
    // continuity degrades to "always fresh," never a crash.
  }
}
