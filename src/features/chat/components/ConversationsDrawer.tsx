import { useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { isolateEmbeddedBidiRuns } from "@/lib/bidiText";
import type { ChatSession } from "@/hooks/useChatSessions";
import { ConversationsList } from "./ConversationsList";

// SmartFlow -- Chat Experience v2 (task 17a), workstream 2: "Conversations
// sidebar becomes a drawer/sheet on mobile (hidden by default, swipe/
// button to open); chat gets full width." Reuses the app's existing
// Sheet primitive (src/components/ui/sheet.tsx, already used by
// MobileNav's own "more" menu -- see that file) rather than building a
// new drawer mechanism: Radix Dialog underneath already gives swipe-to-
// dismiss-via-overlay-tap, Escape-to-close, and focus trapping for free.
// The slide side is RTL-aware (opens from the reading-start edge -- right
// for Persian, left otherwise) via useT()'s own isRTL, the same source
// StepApprovalDialog.tsx already uses for its own dir attribute.
//
// Task 17c, PO decision D4: "the search entry merges INTO the conversations
// drawer (search field at its top) -- no separate search row." This is a
// LOCAL filter over this page's own conversation titles, not a re-hosting
// of the app-wide GlobalSearch widget (a different, cross-entity search
// feature over tasks/notes/etc. -- out of scope here) -- AppLayout.tsx no
// longer renders GlobalSearch on this page at all (see its own comment).

function matchesQuery(title: string, query: string): boolean {
  return title.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export interface ConversationsDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sessions: readonly ChatSession[];
  readonly activeSessionId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

export function ConversationsDrawer({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
}: ConversationsDrawerProps) {
  const { t, isRTL } = useT();
  const [query, setQuery] = useState("");

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed === "") return sessions;
    return sessions.filter((session) => matchesQuery(session.title, trimmed));
  }, [sessions, query]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <SheetContent side={isRTL ? "right" : "left"} className="flex w-[85vw] max-w-xs flex-col gap-0 p-0">
        <SheetHeader className="space-y-3 border-b border-border p-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("flow_conversations")}
          </SheetTitle>
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
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-3">
          {filteredSessions.length === 0 && sessions.length > 0 ? (
            <p className="text-xs text-muted-foreground" dir="auto">
              {isolateEmbeddedBidiRuns(t("chat_no_conversations_match"))}
            </p>
          ) : (
            <ConversationsList
              sessions={filteredSessions}
              activeSessionId={activeSessionId}
              onSelect={(id) => {
                onSelect(id);
                onOpenChange(false);
              }}
              onDelete={onDelete}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
