import { useEffect } from "react";
import { Outlet } from "react-router-dom";
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

function AppLayoutInner() {
  const { shouldShowAppShell } = useLaunch();
  useAlarms();

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
        <div className="lg:hidden flex flex-col h-[100dvh]">
          <div className="flex justify-end px-4 pt-3 pb-1 shrink-0">
            <GlobalSearch />
          </div>
          <main className="flex-1 pb-20 overflow-auto">
            <Outlet />
          </main>
          <MobileNav />
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
