import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { isolateEmbeddedBidiRuns, resolveMessageBaseDirection } from "@/lib/bidiText";
import type { ChatSession } from "@/hooks/useChatSessions";
import { timeAgo } from "../timeAgo";

// SmartFlow -- Chat Experience v2 (task 17a). Shared conversation-list
// content, extracted from ChatPage.tsx's own former inline JSX so the
// SAME rendering is used by both the desktop sidebar and the mobile
// ConversationsDrawer.tsx (workstream 2: "sidebar becomes a drawer/sheet
// on mobile"), rather than forking the markup.

export interface ConversationsListProps {
  readonly sessions: readonly ChatSession[];
  readonly activeSessionId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly compact?: boolean;
}

export function ConversationsList({ sessions, activeSessionId, onSelect, onDelete, compact = false }: ConversationsListProps) {
  const { t } = useT();

  if (sessions.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("flow_no_conversations")}</p>;
  }

  return (
    <ul className="-mx-1 space-y-1 overflow-y-auto">
      {sessions.map((session) => (
        <li key={session.id} className="group flex items-center">
          <button
            type="button"
            onClick={() => onSelect(session.id)}
            className={cn(
              "min-w-0 flex-1 rounded-lg px-2.5 text-start transition-colors",
              compact ? "py-1.5" : "py-2",
              session.id === activeSessionId ? "border border-primary/20 bg-primary/10" : "hover:bg-secondary/30",
            )}
          >
            {/* Task 17f, B3: a Persian title used to ellipsize on the WRONG
                side ("…نظرت آینده") -- root cause was TWO stacked bugs: (1)
                the hardcoded `text-left` above (now `text-start`, a logical
                property) forced left alignment regardless of the title's
                own direction, defeating `truncate`'s per-direction ellipsis
                placement; (2) `dir="auto"` here suffered the exact same
                17e-class leak as chat bubbles (a pure-Persian title, once
                bidiText.tsx wrapped it whole in a <bdi>, had nothing left
                for its own auto-detection to find). Task 17f's bidiText.tsx
                rewrite fixes (2) at the isolation layer directly (a title's
                own dominant script is never swallowed now); this ALSO
                takes the explicit, content-derived resolveMessageBaseDirection
                (the same helper the chat bubble root uses, 17e/17f R1) so
                truncation direction never depends on the app UI language
                either, matching every other per-message direction decision
                in this app. */}
            <p className="truncate text-xs font-medium" dir={resolveMessageBaseDirection(session.title)}>
              {isolateEmbeddedBidiRuns(session.title)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{timeAgo(session.updated_at)}</p>
          </button>
          <button
            type="button"
            aria-label={t("chat_delete_conversation")}
            onClick={() => onDelete(session.id)}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
