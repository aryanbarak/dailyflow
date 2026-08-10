import { MessageSquare } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isRTL ? "right" : "left"} className="flex w-[85vw] max-w-xs flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("flow_conversations")}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-3">
          <ConversationsList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={(id) => {
              onSelect(id);
              onOpenChange(false);
            }}
            onDelete={onDelete}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
