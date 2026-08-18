import { NavLink, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Wallet,
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
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { MicroBreaksCommandLauncher } from "@/features/micro-breaks/components/MicroBreaksCommandLauncher";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/features/profile/useProfile";
import { FlowAIOrb } from "@/components/FlowAIOrb";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import { getSmartAcademyUrl } from "@/config/apps";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";

const smartAcademyUrl = getSmartAcademyUrl();

const navItems: {
  externalUrl?: string | null;
  icon: React.ElementType;
  key: TranslationKey;
  path: string;
  activeMatch?: "exact" | "prefix";
}[] = [
  { icon: LayoutDashboard, key: 'nav_dashboard', path: "/" },
  { icon: MessageSquare, key: 'nav_chat', path: "/chat" },
  { icon: FolderKanban, key: 'nav_projects', path: "/projects", activeMatch: "prefix" },
  { icon: Bot, key: 'nav_tutor_app', path: "/tutor/app", externalUrl: smartAcademyUrl },
  { icon: CheckSquare, key: 'nav_tasks', path: "/tasks" },
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

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { profile } = useProfile();
  const { t } = useT();
  const shouldReduceMotion = useReducedMotion();

  const displayName = profile?.displayName?.trim()
    || user?.email?.split("@")[0]
    || "User";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";

  return (
    <aside className="relative w-64 h-screen sticky top-0 overflow-hidden bg-sidebar border-r border-sidebar-border flex flex-col">
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 z-0 opacity-85"
        style={{
          backgroundImage: [
            "radial-gradient(circle at center, hsl(248 95% 82% / 0.54) 0 0.3px, hsl(var(--primary) / 0.28) 0.42px, transparent 0.72px)",
            "radial-gradient(180px circle at 24% 8%, hsl(248 90% 72% / 0.20), transparent 62%)",
          ].join(", "),
          backgroundSize: "14px 14px, 100% 100%",
          backgroundPosition: "0px 0px, center",
          mixBlendMode: "screen",
          willChange: "transform",
        }}
        animate={
          shouldReduceMotion
            ? undefined
            : {
                x: [0, -14, 6, 0],
                y: [0, 18, 8, 0],
              }
        }
        transition={
          shouldReduceMotion
            ? undefined
            : { duration: 12, ease: "easeInOut", repeat: Infinity }
        }
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-8 z-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, hsl(248 95% 80% / 0.34) 0 0.42px, transparent 0.86px)",
          backgroundSize: "30px 30px",
          backgroundPosition: "8px 10px",
          mixBlendMode: "screen",
          willChange: "transform",
        }}
        animate={
          shouldReduceMotion
            ? undefined
            : {
                x: [0, 12, -7, 0],
                y: [0, -18, -6, 0],
              }
        }
        transition={
          shouldReduceMotion
            ? undefined
            : { duration: 16, ease: "easeInOut", repeat: Infinity }
        }
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-sidebar/5 via-sidebar/28 to-sidebar/72"
      />
      {/* Logo */}
      <div className="relative z-10 p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/15 bg-primary/10 shadow-[0_0_34px_hsl(var(--primary)/0.28)]">
            <div className="absolute inset-[-10px] opacity-55">
              <FlowAIOrb
                size={84}
                state="presence"
                variant="identity"
                beam={false}
                particles={false}
                glowIntensity={0.72}
                theme="transparent"
                ariaLabel="Flow AI"
              />
            </div>
            <SmartflowAsciiVisual
              variant="wiremesh"
              className="absolute inset-[-8px] opacity-95 mix-blend-screen"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(circle_at_48%_46%,hsl(0_0%_100%/0.26),transparent_16%),radial-gradient(circle_at_center,hsl(var(--primary)/0.16),transparent_62%)]"
            />
          </div>
          <div>
            <h1 className="text-lg leading-none">
              <span className="font-light text-sidebar-foreground">Smart</span>
              <span className="font-semibold text-sidebar-foreground">Flow</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Intelligent productivity</p>
          </div>
        </div>
      </div>

      {/* Navigation — Context Rail: active pill slides between items via layoutId */}
      <nav className="relative z-10 flex-1 p-4 space-y-0.5 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => {
          const isActive =
            item.activeMatch === "prefix"
              ? location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
              : location.pathname === item.path;
          return (
            <div key={item.path} className="relative">
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-pill"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: "hsl(var(--primary) / 0.08)",
                    borderLeft: "2px solid hsl(var(--primary))",
                  }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
              {item.externalUrl ? (
                <a
                  href={item.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "nav-link relative z-10",
                    isActive
                      ? "text-primary font-medium"
                      : "hover:bg-transparent",
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-sm">{t(item.key)}</span>
                </a>
              ) : (
                <NavLink
                  to={item.path}
                  className={cn(
                    "nav-link relative z-10",
                    isActive
                      ? "text-primary font-medium"
                      : "hover:bg-transparent",
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-sm">{t(item.key)}</span>
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>

      {/* Search */}
      <div className="relative z-10 flex items-center gap-2 px-3 py-2 border-t border-white/5">
        <GlobalSearch />
        {/* ADR-0014 §10: Micro Breaks desktop entry point. */}
        <MicroBreaksCommandLauncher />
      </div>

      {/* Footer */}
      <div className="relative z-10 p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-sm font-medium text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground">Personal</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
