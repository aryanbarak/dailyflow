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

        {/* Mobile */}
        <div className="lg:hidden flex flex-col min-h-screen">
          <div className="flex justify-end px-4 pt-3 pb-1">
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
