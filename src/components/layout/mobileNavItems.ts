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
import type { TranslationKey } from "@/i18n";

// SmartFlow -- task 17c (D3/D4). Split out of MobileNav.tsx into its own
// data-only module: MobileNav.tsx/ChatPageHeader.tsx both need these plain
// arrays, but a file that exports BOTH React components AND plain
// constants trips the react-refresh/only-export-components lint rule
// (already true for a few other files in this codebase -- this one avoids
// adding to that list rather than accepting two more warnings).

export interface MobileNavItem {
  readonly icon: React.ElementType;
  readonly key: TranslationKey;
  readonly path: string;
}

export const mainNavItems: MobileNavItem[] = [
  { icon: LayoutDashboard, key: 'nav_dashboard', path: "/" },
  { icon: MessageSquare, key: 'nav_chat', path: "/chat" },
  { icon: Bot, key: 'nav_tutor_app', path: "/tutor/app" },
  { icon: CheckSquare, key: 'nav_tasks', path: "/tasks" },
];

export const moreNavItems: MobileNavItem[] = [
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
