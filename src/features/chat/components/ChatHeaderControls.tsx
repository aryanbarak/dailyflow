import { Maximize2, Minimize2, Moon, Sun } from "lucide-react";
import { useT } from "@/i18n";
import { useChatDisplayPreferences } from "../chatDisplayPreferencesStore";

// SmartFlow -- Chat Experience v2 (task 17a), workstreams 4 + 5: "a small
// chat-header settings cluster, keyboard-accessible" holding both the
// theme toggle and the compact-mode toggle. Plain <button> elements are
// natively keyboard-operable (Tab + Enter/Space) with no extra wiring;
// aria-pressed reflects each toggle's current state for screen readers.
// Colors use the SAME global-named tokens (border-border, bg-background,
// text-primary) the rest of the chat page uses -- theme-aware for free
// via [data-chat-theme] (see index.css).

export function ChatHeaderControls() {
  const { t } = useT();
  const theme = useChatDisplayPreferences((state) => state.theme);
  const density = useChatDisplayPreferences((state) => state.density);
  const toggleTheme = useChatDisplayPreferences((state) => state.toggleTheme);
  const toggleDensity = useChatDisplayPreferences((state) => state.toggleDensity);

  const isDark = theme === "dark";
  const isCompact = density === "compact";

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-background/50 p-0.5">
      <button
        type="button"
        onClick={toggleDensity}
        aria-pressed={isCompact}
        aria-label={isCompact ? t("chat_switch_to_comfortable") : t("chat_switch_to_compact")}
        title={isCompact ? t("chat_switch_to_comfortable") : t("chat_switch_to_compact")}
        className="chat-reduced-motion flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-primary"
      >
        {isCompact ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-pressed={isDark}
        aria-label={isDark ? t("chat_switch_to_light_theme") : t("chat_switch_to_dark_theme")}
        title={isDark ? t("chat_switch_to_light_theme") : t("chat_switch_to_dark_theme")}
        className="chat-reduced-motion flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isDark ? <Moon className="h-3.5 w-3.5" aria-hidden="true" /> : <Sun className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}
