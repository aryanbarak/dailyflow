import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Gamepad2, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SmartFlowLogo } from "@/components/SmartFlowLogo";
import { useT } from "@/i18n";
import { useMicroBreaksStore } from "@/features/micro-breaks/store/microBreaksStore";
import { mainNavItems, moreNavItems, type MobileNavItem } from "./mobileNavItems";

// Task 17c (D3/D4): extracted so ChatPage's own header "More" entry can
// reuse the EXACT same sheet content (logo + item grid) this bottom nav
// already renders -- "reuse the existing MobileNav sheet content... reuse,
// don't rebuild." ChatPage passes the FULL item set (mainNavItems +
// moreNavItems combined), since on that one page the bottom nav itself is
// gone (D3) and this becomes the only way to reach any other page; every
// other page keeps its unchanged bottom nav + this same "more" grid showing
// only moreNavItems, exactly as before.
export interface NavItemsGridProps {
  readonly items: readonly MobileNavItem[];
  readonly onNavigate: (path: string) => void;
  readonly isActive: (path: string) => boolean;
}

export function NavItemsGrid({ items, onNavigate, isActive }: NavItemsGridProps) {
  const { t } = useT();
  return (
    <div className="py-4">
      <div className="mb-6 px-2">
        <SmartFlowLogo size={36} />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {items.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => onNavigate(item.path)}
            className={cn(
              "flex flex-col items-center gap-2 p-3 rounded-xl transition-colors",
              isActive(item.path) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
            )}
          >
            <item.icon className="w-6 h-6" />
            <span className="text-xs">{t(item.key)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const startBreak = useMicroBreaksStore(s => s.startBreak);

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
      <div className="flex items-center justify-around py-2">
        {/* ADR-0014 §10: Micro Breaks mobile entry point -- a small icon,
            not a route (no permanent top-level "Games" nav). */}
        <button
          type="button"
          onClick={() => startBreak()}
          aria-label={t('micro_breaks_entry_label')}
          className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-muted-foreground"
        >
          <Gamepad2 className="w-5 h-5" />
        </button>

        {mainNavItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-xs">{t(item.key)}</span>
            </NavLink>
          );
        })}

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button type="button" className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-muted-foreground">
              <Menu className="w-5 h-5" />
              <span className="text-xs">{t('nav_more')}</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto rounded-t-2xl">
            <NavItemsGrid
              items={moreNavItems}
              onNavigate={(path) => { setOpen(false); navigate(path); }}
              isActive={(path) => location.pathname === path || location.pathname.startsWith(`${path}/`)}
            />
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
