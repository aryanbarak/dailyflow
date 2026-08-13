import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { OfflineBadge } from "@/components/OfflineBadge";
import { MiniPlayer } from "@/components/music/MiniPlayer";
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { useAlarms } from "@/features/calendar/useAlarms";
import { PageTitleProvider } from "@/contexts/PageTitleContext";
import { LaunchExperience } from "@/components/LaunchExperience";
import { LaunchProvider, useLaunch } from "@/contexts/LaunchContext";
import { SmartflowPointerFollower } from "@/components/smartflow";
import { cn } from "@/lib/utils";
import { resolveShellHeightStyle, useVisualViewportInsets } from "@/features/chat/useVisualViewportInsets";

// Task 17c, PO decisions D3/D4: on the mobile Flow AI page ONLY, the
// bottom nav is removed (chat takes the full height; navigation moves into
// a "More" entry in ChatPage's own header, reusing MobileNav's sheet -- see
// MobileNav.tsx's exported NavItemsGrid/mainNavItems/moreNavItems) and the
// global search row is removed (it merges into the conversations drawer's
// own search field -- see ConversationsDrawer.tsx). Every other page's
// mobile shell is completely unchanged.
const PAGES_WITHOUT_MOBILE_CHROME = new Set(["/chat"]);

function AppLayoutInner() {
  const { shouldShowAppShell } = useLaunch();
  const location = useLocation();
  const hideMobileChrome = PAGES_WITHOUT_MOBILE_CHROME.has(location.pathname);
  useAlarms();
  // Task 17f, C2: production evidence -- after a fresh mount in the
  // Android PWA STANDALONE context, `100dvh` mis-measured this shell (the
  // chat composer sat below the visible viewport). Scoped to the chat page
  // ONLY (`hideMobileChrome`, the same flag PAGES_WITHOUT_MOBILE_CHROME
  // already uses to special-case this page) -- every other page's shell
  // height is untouched, `h-[100dvh]` alone, exactly as task 17a shipped
  // it; see resolveShellHeightStyle's own comment for why the JS
  // measurement is authoritative over dvh whenever it's available.
  const { viewportHeightPx } = useVisualViewportInsets();
  const mobileShellHeight = hideMobileChrome ? resolveShellHeightStyle(viewportHeightPx) : undefined;

  const appShellStyle = {
    opacity: shouldShowAppShell ? 1 : 0,
    visibility: shouldShowAppShell ? "visible" : "hidden",
    pointerEvents: shouldShowAppShell ? "auto" : "none",
    transition: shouldShowAppShell
      ? "opacity 700ms cubic-bezier(0.22,1,0.36,1)"
      : "none",
  } as const;

  useEffect(() => {
    if ("Notification" in globalThis && Notification.permission === "default") {
      const timer = setTimeout(() => { void Notification.requestPermission(); }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <LaunchExperience />

      <div style={appShellStyle} aria-hidden={!shouldShowAppShell}>
        {/* Task 17h: RESTORED after task 17g incorrectly gated this off the
            chat page as a "stray orb" regression -- the PO likes the
            cursor-following glow and wants it back on every page, unchanged
            in behaviour. This is APP-SHELL CHROME (global, cursor-driven,
            rendered by AppLayout for every route) and is a SEPARATE concern
            from task 17b's "exactly two glow placements" restraint rule,
            which is scoped to the CHAT SURFACE itself only (ChatEmptyState's
            own contained orb + the typing-indicator dots -- see index.css's
            comment on the typing-indicator glow and
            ChatPageChromeCleanup.test.tsx's Y4 block). Do NOT re-gate this
            off /chat (or any other route) to satisfy 17b's rule again --
            that rule was never about this component in the first place. It
            is now user-configurable instead (Settings -> Appearance ->
            "Pointer glow": on/off, colour (from the existing --flow-*
            palette only), size, opacity -- see appearanceStore.ts's orb*
            fields/ORB_* constants and SmartflowPointerFollower.tsx, which
            reads them and applies size/colour/opacity via CSS custom
            properties on its own root element, never inside its per-frame
            animation loop). */}
        <SmartflowPointerFollower />
        <OfflineBadge />

        {/* Desktop */}
        <div className="hidden lg:flex">
          <Sidebar />
          {/* Task 17g, Y5: production evidence -- two scrollbars appeared
              simultaneously on desktop (nested scroll containers). ChatPage
              manages its OWN vertical space entirely internally (its root
              is `lg:sticky lg:top-0 lg:h-screen`, with the message list's
              own `overflow-y-auto` region -- see ChatPage.tsx -- doing the
              real scrolling), so this outer <main>'s `overflow-auto` was a
              REDUNDANT second scroll container for the chat page
              specifically: whenever chat's own rendered height didn't
              exactly match this main's available height, the browser's
              plain default scrollbar appeared here too, alongside chat's
              own styled inner one. Scoped to the chat page ONLY
              (`hideMobileChrome`) -- every other page still needs this
              main to scroll normally, since they don't self-manage an
              internal scroll region the way chat does. */}
          <main className={cn("flex-1 min-h-screen", hideMobileChrome ? "overflow-hidden" : "overflow-auto")}>
            <Outlet />
          </main>
        </div>

        {/* Mobile -- task 17a: h-[100dvh] (was min-h-screen/100vh) so this
            shell's own box genuinely shrinks when the on-screen keyboard
            opens, on every current mobile browser that supports dvh. This
            is what lets ChatPage's own h-full flex-column composer stay
            correctly pinned above the keyboard with no JS height hacks --
            see ChatPage.tsx and the task 17a report's "viewport strategy
            chosen + why" for the full writeup. min-h-screen was a static
            100vh floor that never shrank, so a fixed-at-the-bottom
            composer could end up rendered behind the keyboard. */}
        <div className="lg:hidden flex flex-col h-[100dvh]" style={mobileShellHeight ? { height: mobileShellHeight } : undefined}>
          {!hideMobileChrome && (
            <div className="flex justify-end px-4 pt-3 pb-1 shrink-0">
              <GlobalSearch />
            </div>
          )}
          {/* Task 17f, C1a: overscroll-contain -- this is the scrolling
              ancestor for every mobile page's OTHER content (Settings,
              Documents, etc. -- pages that don't self-manage their own
              scroll region the way chat does). Task 20c deliberately
              leaves this UNTOUCHED, even though it removed the equivalent
              containment from html/body and ChatPage's own root to restore
              the chat's pull-to-refresh gesture: this <main> is NOT "the
              chat page root" (it's the shared shell for every route) and,
              for the chat page specifically, it is functionally INERT
              here anyway -- chat's own mobile root is sized to exactly
              fill it (C2's resolveShellHeightStyle, whose entire point is
              "composer visible with no scrolling"), so this <main> never
              actually overflows/scrolls while displaying chat and never
              becomes the chain link 20c needed to remove. It keeps
              suppressing pull-to-refresh on every OTHER page, which task
              20c was never asked to change. */}
          <main className={cn("flex-1 overflow-auto overscroll-contain", !hideMobileChrome && "pb-20")}>
            <Outlet />
          </main>
          {!hideMobileChrome && <MobileNav />}
        </div>

        <MiniPlayer />
      </div>
    </div>
  );
}

export function AppLayout() {
  return (
    <PageTitleProvider>
      <LaunchProvider>
        <AppLayoutInner />
      </LaunchProvider>
    </PageTitleProvider>
  );
}
