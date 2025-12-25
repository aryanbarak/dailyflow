import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { OfflineBadge } from "@/components/OfflineBadge";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <OfflineBadge />
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
        <main className="flex-1 min-h-screen overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden flex flex-col min-h-screen">
        <main className="flex-1 pb-20 overflow-auto">
          <Outlet />
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
