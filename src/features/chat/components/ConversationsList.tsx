import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { isolateEmbeddedBidiRuns } from "@/lib/bidiText";
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
              "min-w-0 flex-1 rounded-lg px-2.5 text-left transition-colors",
              compact ? "py-1.5" : "py-2",
              session.id === activeSessionId ? "border border-primary/20 bg-primary/10" : "hover:bg-secondary/30",
            )}
          >
            <p className="truncate text-xs font-medium" dir="auto">
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
