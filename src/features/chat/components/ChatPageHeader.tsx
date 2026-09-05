import { Bot, History, Menu, Plus, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

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
// "conversations." Task 17f, B1: the PO decided to remove the persistent
// desktop Conversations panel entirely -- desktop now matches mobile, the
// conversation list lives ONLY in the drawer this button opens. Moved next
// to "New Chat" (was `lg:hidden`, left of the title) and now visible at
// EVERY width -- "one pattern, one code path, no desktop-only variant," so
// there is no longer a separate always-visible desktop sidebar to keep in
// sync with this button's mobile-only visibility.
// RTL mirroring: this component does NOT set its own `dir` -- it relies on
// an ANCESTOR (ChatPage's own root) providing a real `dir="rtl"|"ltr"`
// context, which is also task 17c's E4 fix (see ChatComposer.test.tsx's own
// comment for why `dir="auto"` on unrelated leaf elements is not enough to
// make a structural row like this one mirror).

export interface ChatPageHeaderProps {
  readonly compact: boolean;
  readonly prefersReducedMotion: boolean;
  readonly onOpenMoreMenu: () => void;
  // PO decision (2026-09-05): optional -- Home's embedded header passes
  // undefined (its history toggle moved to the app icon rail, opening the
  // docked panel); the standalone /chat route still passes a handler and
  // keeps this button exactly as before.
  readonly onOpenConversations?: () => void;
  readonly onStartNewChat: () => void;
  // Home V2 final visual correction: Home's embedded chat panel shows
  // "SmartFlow" as its visible title instead of the standalone /chat
  // route's own `chat_title` translation ("Flow AI") -- a presentation-
  // only label swap, not a rename of `chat_title` itself (which would
  // also change the standalone route). Undefined (every existing caller,
  // including /chat) falls back to `t("chat_title")`, unchanged.
  readonly titleOverride?: string;
  // SmartFlow Home frozen design handoff §7: the embedded chat header
  // shows a ping dot + "Online" next to the title. Presentation only;
  // undefined (the standalone /chat route) renders nothing new.
  readonly showOnlineStatus?: boolean;
  // Frozen handoff §10 (<=1120px), widened by DESIGN-AUDIT phase 5: a
  // panel button appears in the chat header that opens the Assistant Rail
  // overlay. Only rendered when a handler is provided (Home's embedded
  // panel); the standalone route passes nothing and is unchanged.
  // Visibility is media-scoped to <=1120px -- every shell where the rail
  // is not a grid column (mobile included, since phase 5 replaced the
  // below-the-fold stacked mobile rail with this same overlay).
  readonly onOpenAssistantPanel?: () => void;
  // PO decision (2026-09-05, round 2): Home's embedded header shows the
  // History button on MOBILE only (desktop Home keeps the icon-rail
  // toggle for the docked panel; a second header button would duplicate
  // it). The standalone route leaves this unset -- its button stays
  // visible at every width (task 17f B1, unchanged).
  readonly conversationsMobileOnly?: boolean;
}

export function ChatPageHeader({
  compact,
  prefersReducedMotion,
  onOpenMoreMenu,
  onOpenConversations,
  onStartNewChat,
  titleOverride,
  showOnlineStatus,
  onOpenAssistantPanel,
  conversationsMobileOnly = false,
}: ChatPageHeaderProps) {
  const { t } = useT();

  return (
    <motion.header
      initial={prefersReducedMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      // v2 rev-2 mobile rules (#sfChatHead): the header compacts to
      // 10px vertical padding at <=760px. PO decision (2026-09-05, round
      // 2, ChatGPT-style): on mobile the header is a GLASS bar -- token
      // background at 60% + blur, raised above the transcript (which is
      // pulled up underneath it via the negative margin below), so
      // messages show through it while scrolling.
      className={cn(
        "shrink-0 border-b border-border px-3 max-[760px]:py-2.5 sm:px-6",
        "max-lg:relative max-lg:z-20 max-lg:-mb-14 max-lg:bg-background/60 max-lg:backdrop-blur-xl",
        compact ? "py-2" : "py-3",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Mobile responsive pass: min-w-0 + overflow-hidden let this
            cluster actually SHRINK instead of overlapping the controls
            cluster on narrow phones (the title cluster used to render on
            top of the theme/density pill at <=390px). The brand text
            itself stays untruncated -- the width is recovered by the
            smaller mobile title size, the sm-gated Online label, and the
            tighter mobile control gaps below. */}
        <div className="flex min-w-0 items-center gap-2 overflow-hidden max-[760px]:gap-1.5">
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
          <div className="icon-tile shrink-0">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          {/* PO fix (2026-09-05, round 3): with the History button back in
              the mobile header the row got tight and "SmartFlow" lost its
              last letters -- slightly smaller mobile title + the tighter
              paddings below recover the width. */}
          <h1 className="whitespace-nowrap text-base font-semibold leading-tight max-[760px]:text-[15px] sm:text-lg">{titleOverride ?? t("chat_title")}</h1>
          {showOnlineStatus && (
            // Frozen handoff §7 colors via existing palette/tokens (the
            // chat feature's flowTokenDerivation test forbids raw hex
            // here): emerald-400 is exactly the frozen online-dot green,
            // and muted-foreground is the chat theme's secondary text
            // token the frozen "Online" grey maps to. Hidden below sm:
            // on phones the header row has no room for the ornament and
            // it collided with the controls cluster.
            <span className="hidden items-center gap-1.5 ps-1 sm:flex">
              <span className="relative inline-flex h-2 w-2">
                <span className="sf-home-ping absolute inset-0 rounded-full bg-emerald-400 motion-safe:animate-[sfPing_2.2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-xs text-muted-foreground">Online</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {onOpenAssistantPanel && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="hidden h-8 w-8 shrink-0 text-primary max-[1120px]:flex"
              onClick={onOpenAssistantPanel}
              aria-label="Assistant panel"
            >
              <Zap className="h-4 w-4" strokeWidth={1.7} />
            </Button>
          )}
          {/* PO decision (2026-09-05): the theme/density pill
              (ChatHeaderControls) is removed from the header -- both
              toggles' stores keep their persisted values; the component
              and its unit tests remain for a possible future surface. */}
          {onOpenConversations && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("h-9 w-9 shrink-0", conversationsMobileOnly && "lg:hidden")}
              onClick={onOpenConversations}
              aria-label={t("chat_open_conversations")}
            >
              <History className="h-4 w-4" />
            </Button>
          )}
          {/* v2 rev-2 mobile rules (#sfNewChatBtn/#sfNewChatLabel): the
              New Chat button is icon-only up to 760px (not just below
              sm), so the compacted mobile header row always fits. */}
          <Button size="sm" variant="outline" className="gap-1.5 max-[760px]:px-2" onClick={onStartNewChat} aria-label={t("flow_new_chat")}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden min-[761px]:inline">{t("flow_new_chat")}</span>
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
