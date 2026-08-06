import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Wallet,
  Menu,
  Users,
  FileText,
  Music,
  Image,
  Settings,
  Bot,
  Flame,
  BookOpen,
  MessageSquare,
  FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SmartFlowLogo } from "@/components/SmartFlowLogo";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";

const mainNavItems: { icon: React.ElementType; key: TranslationKey; path: string }[] = [
  { icon: LayoutDashboard, key: 'nav_dashboard', path: "/" },
  { icon: MessageSquare, key: 'nav_chat', path: "/chat" },
  { icon: Bot, key: 'nav_tutor_app', path: "/tutor/app" },
  { icon: CheckSquare, key: 'nav_tasks', path: "/tasks" },
];

const moreNavItems: { icon: React.ElementType; key: TranslationKey; path: string }[] = [
  { icon: FolderKanban, key: 'nav_projects', path: "/projects" },
  { icon: Calendar, key: 'nav_calendar', path: "/calendar" },
  { icon: Flame, key: 'nav_habits', path: "/habits" },
  { icon: BookOpen, key: 'nav_journal', path: "/journal" },
  { icon: Wallet, key: 'nav_finance', path: "/finance" },
  { icon: Users, key: 'nav_family', path: "/family" },
  { icon: FileText, key: 'nav_documents', path: "/documents" },
  { icon: Image, key: 'nav_photos', path: "/photos" },
  { icon: Music, key: 'nav_music', path: "/music" },
  { icon: Settings, key: 'nav_settings', path: "/settings" },
];

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { t } = useT();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
      <div className="flex items-center justify-around py-2">
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
            <div className="py-4">
              <div className="mb-6 px-2">
                <SmartFlowLogo size={36} />
              </div>
              <div className="grid grid-cols-4 gap-4">
                {moreNavItems.map((item) => {
                  const isActive =
                    location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => { setOpen(false); navigate(item.path); }}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl transition-colors",
                        isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      <item.icon className="w-6 h-6" />
                      <span className="text-xs">{t(item.key)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
