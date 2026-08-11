import { Bot, History, Menu, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { ChatHeaderControls } from "./ChatHeaderControls";

// SmartFlow -- task 17c, PO decision D4, final single-row mobile header:
// [More menu] [Conversations] -- "Flow AI" -- [theme/density] [New].
// Extracted from ChatPage.tsx's own render (task 17a/17b had it inline) so
// this header's composition/icons/RTL mirroring are independently
// testable via renderToString without ChatPage's heavy hook dependencies
// (useAuth, useTasks, useWorkspace, useChatSessions, ...) -- the same
// "extract a small presentational piece" pattern task 17a already used for
// ConversationsList/JumpToLatestPill/ChatHeaderControls.
//
// "More" -- task 17c D3: the bottom nav is gone on this page (AppLayout.tsx
// no longer renders it here), so this is now the only way to reach any
// other page; the hamburger icon moved here accordingly.
// "Conversations" -- task 17c D4: icon changed from the hamburger to
// History, since the hamburger now means "more" (app navigation), not
// "conversations."
// RTL mirroring: this component does NOT set its own `dir` -- it relies on
// an ANCESTOR (ChatPage's own root) providing a real `dir="rtl"|"ltr"`
// context, which is also task 17c's E4 fix (see ChatComposer.test.tsx's own
// comment for why `dir="auto"` on unrelated leaf elements is not enough to
// make a structural row like this one mirror).

export interface ChatPageHeaderProps {
  readonly compact: boolean;
  readonly prefersReducedMotion: boolean;
  readonly onOpenMoreMenu: () => void;
  readonly onOpenConversations: () => void;
  readonly onStartNewChat: () => void;
}

export function ChatPageHeader({
  compact,
  prefersReducedMotion,
  onOpenMoreMenu,
  onOpenConversations,
  onStartNewChat,
}: ChatPageHeaderProps) {
  const { t } = useT();

  return (
    <motion.header
      initial={prefersReducedMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("shrink-0 border-b border-border px-3 sm:px-6", compact ? "py-2" : "py-3")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 lg:hidden"
            onClick={onOpenMoreMenu}
            aria-label={t("chat_open_more_menu")}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 lg:hidden"
            onClick={onOpenConversations}
            aria-label={t("chat_open_conversations")}
          >
            <History className="h-4 w-4" />
          </Button>
          <div className="icon-tile shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <h1 className="whitespace-nowrap text-lg font-semibold leading-tight">{t("chat_title")}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChatHeaderControls />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onStartNewChat}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("flow_new_chat")}</span>
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
