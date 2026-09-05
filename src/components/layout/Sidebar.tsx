import { useState } from "react";
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
  History,
  Home,
  Menu,
} from "lucide-react";
import { useConversationsPanelStore } from "@/features/chat/conversationsPanelStore";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "@/features/search/GlobalSearch";
import { MicroBreaksCommandLauncher } from "@/features/micro-breaks/components/MicroBreaksCommandLauncher";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/features/profile/useProfile";
import { FlowAIOrb } from "@/components/FlowAIOrb";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";

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
  // Smart Academy points back at the INTERNAL tutor page. The
  // VITE_SMART_ACADEMY_URL external override (config/apps.ts) is
  // deliberately not wired here anymore -- the nav stays internal
  // regardless of what any environment sets.
  { icon: Bot, key: 'nav_tutor_app', path: "/tutor/app" },
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

function useSidebarIdentity() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const displayName = profile?.displayName?.trim()
    || user?.email?.split("@")[0]
    || "User";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
  return { displayName, initials, avatarUrl: profile?.avatarUrl ?? null };
}

// SmartFlow Home frozen design handoff (§9 / spec §2b): the ONE full
// SmartFlow navigation, extracted so the exact same structure/data renders
// in BOTH places that show it -- the persistent w-64 sidebar on every
// non-Home route, and Home's left overlay drawer (opened by the slim
// rail's hamburger AND its Home icon). Same `navItems`, same star-field
// identity, same logo header, same active treatment, same footer -- never
// a second menu system. `onNavigate` (drawer only) closes the drawer when
// a destination is selected; navigation itself stays NavLink's job.
export function FullSidebarContent({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  const location = useLocation();
  const { t } = useT();
  const shouldReduceMotion = useReducedMotion();
  const { displayName, initials, avatarUrl } = useSidebarIdentity();

  return (
    <>
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
                ariaLabel="SmartFlow"
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
                  // DESIGN-AUDIT 0.2: pill, not a physical borderLeft -- a
                  // directional border sits on the WRONG side under RTL
                  // (fa). Violet-tinted fill + the active flow border,
                  // derived from --primary (now the --flow-primary family).
                  style={{
                    background: "hsl(var(--primary) / 0.14)",
                    border: "1px solid var(--flow-border-active)",
                  }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
              {item.externalUrl ? (
                <a
                  href={item.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onNavigate}
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
                  onClick={onNavigate}
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
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-medium text-primary">{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground">Personal</p>
          </div>
        </div>
      </div>
    </>
  );
}

// SmartFlow Home frozen design handoff §4: the slim rail's shared 42px
// icon-button treatment.
const HOME_RAIL_BUTTON_CLASS =
  "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[#9EA3BF] transition-colors hover:bg-[#7C4DFF]/[0.12] hover:text-[#F3F3FA]";

export function Sidebar() {
  const location = useLocation();
  const { t } = useT();
  const [homeMenuOpen, setHomeMenuOpen] = useState(false);
  const conversationsPanelOpen = useConversationsPanelStore((state) => state.open);
  const toggleConversationsPanel = useConversationsPanelStore((state) => state.toggle);
  const { displayName, initials, avatarUrl } = useSidebarIdentity();

  // SmartFlow Home frozen design handoff §4/§9: route-aware presentation
  // mode, not a second navigation system. On Home the rail is slim and
  // icon-only -- hamburger, 12px spacer, Home, Chat, Settings, flex
  // spacer, avatar -- 68px wide (64px at <=1280px), and BOTH the hamburger
  // and the Home icon open the EXISTING full navigation (FullSidebarContent
  // above: same navItems, star field, logo, footer) as a 256px left
  // overlay drawer over a scrim. Selecting a destination closes the drawer
  // and navigates; clicking outside closes it. The main content is never
  // pushed or resized. Every other route renders the unchanged full
  // sidebar below.
  if (location.pathname === "/") {
    return (
      <aside className="sticky top-0 z-40 flex h-screen w-[68px] shrink-0 flex-col items-center gap-1.5 border-e border-[#7078B4]/[0.14] bg-[#070816]/[0.82] py-3.5 backdrop-blur-[12px] max-[1280px]:w-16">
        <Sheet open={homeMenuOpen} onOpenChange={setHomeMenuOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t('nav_more')}
              className={HOME_RAIL_BUTTON_CLASS}
            >
              <Menu className="h-5 w-5" strokeWidth={1.7} />
            </button>
          </SheetTrigger>

          <div aria-hidden="true" className="h-3 shrink-0" />

          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={`${t('nav_dashboard')} — ${t('nav_more')}`}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-[#7D5CFF]/40 bg-[#7C4DFF]/[0.16] text-[#A88BFF] shadow-[0_0_14px_rgba(124,77,255,0.28)]"
            >
              <Home className="h-5 w-5" strokeWidth={1.7} />
            </button>
          </SheetTrigger>

          <SheetContent
            side="left"
            aria-label={t('nav_more')}
            className="z-[90] flex w-64 max-w-[82vw] flex-col gap-0 overflow-hidden border-e border-[#7078B4]/[0.22] bg-[#090B1C]/[0.97] p-0 shadow-[24px_0_60px_rgba(0,0,0,0.5)]"
          >
            <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
              <FullSidebarContent onNavigate={() => setHomeMenuOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <nav className="flex flex-1 flex-col items-center gap-1.5" aria-label={t('nav_dashboard')}>
          <NavLink
            to="/chat"
            title={t('nav_chat')}
            aria-label={t('nav_chat')}
            className={HOME_RAIL_BUTTON_CLASS}
          >
            <MessageSquare className="h-5 w-5" strokeWidth={1.7} />
          </NavLink>
          {/* PO decision (2026-09-05): the conversations-history toggle
              moved OUT of the embedded chat header into this rail, next to
              the other icons -- it toggles the docked DeepSeek-style panel
              (conversationsPanelStore), pressed state reflected for a11y. */}
          <button
            type="button"
            onClick={toggleConversationsPanel}
            aria-pressed={conversationsPanelOpen}
            title={t('flow_conversations')}
            aria-label={t('flow_conversations')}
            className={cn(HOME_RAIL_BUTTON_CLASS, conversationsPanelOpen && "border border-[#7D5CFF]/40 bg-[#7C4DFF]/[0.16] text-[#A88BFF]")}
          >
            <History className="h-5 w-5" strokeWidth={1.7} />
          </button>
          <NavLink
            to="/settings"
            title={t('nav_settings')}
            aria-label={t('nav_settings')}
            className={HOME_RAIL_BUTTON_CLASS}
          >
            <Settings className="h-5 w-5" strokeWidth={1.7} />
          </NavLink>
        </nav>

        <div
          className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[#7078B4]/[0.35] bg-gradient-to-br from-[#3D1D94] to-[#28155F]"
          title={displayName}
          aria-label={displayName}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-[#DDD4FF]">{initials}</span>
          )}
          <span
            aria-hidden="true"
            className="absolute -bottom-px -end-px h-[11px] w-[11px] rounded-full border-2 border-[#07081A] bg-[#34D399]"
          />
        </div>
      </aside>
    );
  }

  // DESIGN-AUDIT phase 5 (tablet icon-rail): between lg (where AppLayout's
  // desktop shell starts) and xl, the 256px text sidebar ate a third of an
  // iPad-landscape viewport -- so the full sidebar now renders from xl up,
  // and the lg..<xl window gets a compact 68px icon rail instead: the SAME
  // navItems list (one navigation data source), icon-only with the label as
  // title/aria-label, active state styled like Home's slim rail. Both are
  // in the tree and CSS-toggled (hidden xl:flex / xl:hidden), so no state
  // is lost when the viewport crosses the breakpoint.
  return (
    <>
      <aside className="relative w-64 h-screen sticky top-0 overflow-hidden bg-sidebar border-e border-sidebar-border hidden xl:flex flex-col">
        <FullSidebarContent />
      </aside>
      <aside className="sticky top-0 z-40 flex h-screen w-[68px] shrink-0 flex-col items-center border-e border-sidebar-border bg-sidebar py-3.5 xl:hidden">
        <nav
          aria-label={t('nav_dashboard')}
          className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-hide"
        >
          {navItems.map((item) => {
            const isActive =
              item.activeMatch === "prefix"
                ? location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                : location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                title={t(item.key)}
                aria-label={t(item.key)}
                className={cn(
                  HOME_RAIL_BUTTON_CLASS,
                  isActive && "border border-[#7D5CFF]/40 bg-[#7C4DFF]/[0.16] text-[#A88BFF]",
                )}
              >
                <item.icon className="h-5 w-5" strokeWidth={1.7} />
              </NavLink>
            );
          })}
        </nav>
        <div
          className="relative mt-2 flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[#7078B4]/[0.35] bg-gradient-to-br from-[#3D1D94] to-[#28155F]"
          title={displayName}
          aria-label={displayName}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-[#DDD4FF]">{initials}</span>
          )}
          <span
            aria-hidden="true"
            className="absolute -bottom-px -end-px h-[11px] w-[11px] rounded-full border-2 border-[#07081A] bg-[#34D399]"
          />
        </div>
      </aside>
    </>
  );
}
