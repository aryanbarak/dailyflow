import { useMemo, useState } from "react";
import { MessageSquare, Plus, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { localeFor, useT } from "@/i18n";
import { isolateEmbeddedBidiRuns } from "@/lib/bidiText";
import type { ChatSession } from "@/hooks/useChatSessions";
import { ConversationsList } from "./ConversationsList";

// SmartFlow -- Chat Experience v2 (task 17a), workstream 2: conversations
// as a drawer/sheet. Revised per PO decision (2026-09-05, DeepSeek-style
// history): ONE shared panel body (search + New Chat + month-grouped
// list) with two presentations --
//   - DockedConversationsPanel: a persistent, NON-modal column docked at
//     the start side of Home's embedded chat (toggled from the app icon
//     rail via conversationsPanelStore; no backdrop, no auto-close, the
//     chat content sits beside it -- like DeepSeek's sidebar).
//   - ConversationsDrawer: the existing Sheet for the standalone /chat
//     route and mobile, now with a LIGHT backdrop (bg-black/20) instead
//     of the near-full blackout, and closing on select as before.
//
// Task 17c, PO decision D4 (search merges into the panel) still holds:
// the search field is a LOCAL filter over conversation titles, not the
// app-wide GlobalSearch.

function matchesQuery(title: string, query: string): boolean {
  return title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

// PO decision (2026-09-05): sessions grouped by month, newest first --
// the same organizing idea as DeepSeek's history sidebar. Month labels
// are localized via the app language's locale.
function groupSessionsByMonth(
  sessions: readonly ChatSession[],
  locale: string | undefined,
): { key: string; label: string; sessions: ChatSession[] }[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const groups: { key: string; label: string; sessions: ChatSession[] }[] = [];
  for (const session of sessions) {
    const date = new Date(session.updated_at);
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${date.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.sessions.push(session);
    } else {
      groups.push({
        key,
        label: Number.isNaN(date.getTime()) ? "" : formatter.format(date),
        sessions: [session],
      });
    }
  }
  return groups;
}

interface ConversationsPanelBodyProps {
  readonly sessions: readonly ChatSession[];
  readonly activeSessionId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onStartNewChat?: () => void;
  /** Called after select/new-chat in modal presentations; docked passes nothing. */
  readonly onAfterAction?: () => void;
}

function ConversationsPanelBody({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onStartNewChat,
  onAfterAction,
}: ConversationsPanelBodyProps) {
  const { t, lang } = useT();
  const [query, setQuery] = useState("");

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed === "") return sessions;
    return sessions.filter((session) => matchesQuery(session.title, trimmed));
  }, [sessions, query]);

  const monthGroups = useMemo(
    () => groupSessionsByMonth(filteredSessions, localeFor(lang)),
    [filteredSessions, lang],
  );

  const handleSelect = (id: string) => {
    onSelect(id);
    onAfterAction?.();
  };

  return (
    <>
      <div className="space-y-3 border-b border-border p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            dir="auto"
            placeholder={t("chat_search_conversations_placeholder")}
            aria-label={t("chat_search_conversations_placeholder")}
            className="w-full rounded-lg border border-border bg-background/60 py-2 ps-8 pe-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {onStartNewChat && (
          <button
            type="button"
            onClick={() => {
              onStartNewChat();
              onAfterAction?.();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-secondary/60 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("flow_new_chat")}
          </button>
        )}
      </div>
      {/* Task 17f, C1a: overscroll-contain -- this list scrolls
          independently; kept by task 20c (see that task's report). */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        {filteredSessions.length === 0 && sessions.length > 0 ? (
          <p className="text-xs text-muted-foreground" dir="auto">
            {isolateEmbeddedBidiRuns(t("chat_no_conversations_match"))}
          </p>
        ) : filteredSessions.length === 0 ? (
          <ConversationsList
            sessions={filteredSessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelect}
            onDelete={onDelete}
          />
        ) : (
          <div className="space-y-4">
            {monthGroups.map((group) => (
              <section key={group.key}>
                {group.label && (
                  <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                )}
                <ConversationsList
                  sessions={group.sessions}
                  activeSessionId={activeSessionId}
                  onSelect={handleSelect}
                  onDelete={onDelete}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export interface DockedConversationsPanelProps extends Omit<ConversationsPanelBodyProps, "onAfterAction"> {
  readonly onClose: () => void;
}

// PO decision (2026-09-05): the docked, DeepSeek-style presentation --
// a real layout column (no portal, no backdrop, no focus trap), start
// side, persistent until toggled off. Selecting a conversation keeps it
// open, exactly like DeepSeek's sidebar.
export function DockedConversationsPanel({ onClose, ...bodyProps }: DockedConversationsPanelProps) {
  const { t } = useT();
  return (
    <aside
      aria-label={t("flow_conversations")}
      className="flex h-full w-72 max-w-[80vw] shrink-0 flex-col border-e border-border bg-background"
    >
      <div className="flex items-center justify-between border-b border-border p-4 pb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("flow_conversations")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ConversationsPanelBody {...bodyProps} />
    </aside>
  );
}

export interface ConversationsDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sessions: readonly ChatSession[];
  readonly activeSessionId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onStartNewChat?: () => void;
}

export function ConversationsDrawer({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onStartNewChat,
}: ConversationsDrawerProps) {
  const { t, isRTL } = useT();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* PO decision (2026-09-05): a light backdrop instead of the Sheet
          default's near-full blackout -- the page behind stays readable. */}
      <SheetContent
        side={isRTL ? "right" : "left"}
        overlayClassName="bg-black/20"
        className="flex w-[85vw] max-w-xs flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border p-4 pb-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("flow_conversations")}
          </SheetTitle>
        </SheetHeader>
        <ConversationsPanelBody
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelect}
          onDelete={onDelete}
          onStartNewChat={onStartNewChat}
          onAfterAction={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
