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
        <SmartflowPointerFollower />
        <OfflineBadge />

        {/* Desktop */}
        <div className="hidden lg:flex">
          <Sidebar />
          <main className="flex-1 min-h-screen overflow-auto">
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
              ancestor for every mobile page's own content, including the
              chat page's message region; without this, a boundary
              overscroll here could still chain into the browser's native
              pull-to-refresh even with the chat's OWN inner scroll region
              contained (see ChatPage.tsx and index.css's html/body for the
              other scroll-chain stops). */}
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
