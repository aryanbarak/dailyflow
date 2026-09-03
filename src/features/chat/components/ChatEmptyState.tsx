import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import { FlowAIOrb } from "@/components/FlowAIOrb";

// SmartFlow -- Flow AI visual identity (task 17b). The mockup's "lobby"
// page, distilled into the CONVERSATION-FIRST empty state (see the task's
// architecture decision): a compact welcome card (greeting + one-line
// tagline, deliberately NO stats row -- the old hero also showed
// conversation/task counts, dropped here) plus a horizontally-scrolling
// quick-action chip row, reusing task 17a's motion/RTL/token conventions.
//
// Dark-only Flow AI styling (--flow-* custom properties, see
// src/styles/flow-tokens.css) is applied via inline `style`, exactly the
// same escape hatch ChatComposer.tsx's send button already uses for
// `var(--gradient-primary)` -- inline styles always win over any stylesheet
// class regardless of Tailwind's base/components/utilities layer order, so
// this is the one reliable way to override a utility class's
// background/color per-theme without fighting the cascade. Light theme is
// completely untouched (the PO's own scope boundary: "a cosmic light theme
// is a separate future design task") -- it keeps rendering exactly what
// task 17a already shipped (glass-card + the existing per-action
// iconBg/iconColor Tailwind classes).
//
// The ONE orbital motif placement (of the task's exactly-two-total budget,
// the other being the typing indicator's dot glow in index.css) lives here,
// contained in the card's corner via `overflow-hidden` + absolute
// positioning, `aria-hidden`, and positioned so it never sits under the
// greeting text -- the explicit regression this task called out against
// the OLD design's large absolutely-positioned SmartflowAsciiVisual
// background, which spanned behind/around the heading text.
//
// Task 17c, PO decision D2: on mobile the card/orb/chip row above are gone
// entirely -- a genuinely separate, simpler subtree (a one-line greeting
// only) renders instead, not the same markup hidden by CSS. Desktop keeps
// the full card + chip row unchanged.

export type FlowQuickActionAccent = "study" | "plan" | "analyze" | "review" | "report" | "career";

export interface ChatEmptyStateAction {
  readonly id: string;
  readonly labelKey: TranslationKey;
  readonly descKey: TranslationKey;
  readonly icon: React.ElementType;
  readonly iconBg: string;
  readonly iconColor: string;
  readonly accent: FlowQuickActionAccent;
  readonly prompt: string;
}

export interface ChatEmptyStateProps {
  readonly greetingName: string;
  readonly theme: "light" | "dark";
  readonly actions: readonly ChatEmptyStateAction[];
  readonly disabled: boolean;
  readonly onSelectPrompt: (prompt: string) => void;
  // SmartFlow Home v2 (`SmartFlow Home v2.dc.html`, new-chat empty state):
  // Home's EMBEDDED chat renders a centered greeting -- the ANIMATED
  // SmartFlow orb (the real FlowAIOrb with its breathing/glow background
  // animation, per the standing "never a CSS stand-in" rule; the
  // prototype's CSS orb is a review stand-in), "Hello, {name}." and a
  // one-line tagline. No card, no quick-action chips (the v2 empty state
  // shows none). Default false: the standalone /chat route keeps the
  // existing card + chip layout below, byte-identical.
  readonly embedded?: boolean;
}

export function ChatEmptyState({ greetingName, theme, actions, disabled, onSelectPrompt, embedded = false }: ChatEmptyStateProps) {
  const { t, isRTL } = useT();
  const isDark = theme === "dark";

  if (embedded) {
    return (
      <div dir={isRTL ? "rtl" : "ltr"} className="flex flex-col items-center px-6 pb-5 pt-11 text-center">
        <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-visible">
          <FlowAIOrb
            size={58}
            state="presence"
            beam={false}
            particles
            glowIntensity={0.9}
            theme="transparent"
            ariaLabel="SmartFlow assistant"
          />
        </div>
        <h2 className="mt-[18px] text-[21px] font-semibold tracking-[-0.01em] text-foreground">
          {t("flow_greeting")}, {greetingName}.
        </h2>
        <p className="mt-[7px] max-w-[380px] text-[13px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
          I&apos;m SmartFlow — here to help you learn, plan, and grow every day.
        </p>
      </div>
    );
  }

  return (
    <div dir={isRTL ? "rtl" : "ltr"}>
      {/* Task 17c, PO decision D2: "NO quick-action cards/chips on mobile AT
          ALL. Mobile empty state = compact one-line greeting + composer
          only." This is a genuinely SEPARATE, simpler subtree from the
          desktop block below -- not the same markup merely hidden by CSS --
          so mobile never ships the card/orb/chip DOM at all, only a single
          line of text. `lg:hidden` matches this app's own mobile/desktop
          breakpoint (see AppLayout.tsx's `hidden lg:flex` / `lg:hidden`
          split).
          Task 17d, workstream 3 (design polish -- the PO's own device
          screenshot showed this as "a bare line floating in space"):
          start-aligned instead of centered (a centered line of text with
          nothing else around it reads like a placeholder/error state in a
          chat surface; start-aligned near the top of the empty scroll area
          reads as an intentional greeting), anchored with the SAME
          icon-tile + Bot icon pattern already used for every message
          avatar on this page (not a new component), and the name itself
          gets one step of visual weight (font-medium text-foreground)
          against the softer greeting lead-in (text-muted-foreground) --
          still a single line of non-interactive text, still no
          card/border/background surface, still no chips: D2 stands. */}
      <div data-testid="chat-empty-state-mobile" className="flex items-center gap-2.5 px-4 pb-2 pt-6 lg:hidden">
        <div className="icon-tile h-8 w-8 shrink-0 rounded-full">
          <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("flow_greeting")}, <span className="font-medium text-foreground">{greetingName}</span> 👋
        </p>
      </div>

      {/* Desktop: task 17b's full welcome card + orb + chip row, unchanged. */}
      <div data-testid="chat-empty-state-desktop" className="hidden space-y-4 py-6 lg:block">
        <div
          className="glass-card relative w-full overflow-hidden rounded-2xl p-5"
          style={
            isDark
              ? {
                  backgroundImage: "var(--flow-gradient-card)",
                  borderColor: "var(--flow-border-soft)",
                  boxShadow: "var(--flow-shadow-card)",
                }
              : undefined
          }
        >
          {isDark && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-10 -top-10 h-36 w-36 shrink-0 rounded-full"
              style={{ background: "var(--flow-gradient-orb)", boxShadow: "var(--flow-shadow-orb)" }}
            />
          )}
          <div className="relative z-10 flex items-center gap-4">
            {isDark ? (
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--flow-glow-violet-soft)" }}
              >
                <Bot className="h-6 w-6" style={{ color: "var(--flow-primary-bright)" }} aria-hidden="true" />
              </div>
            ) : (
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-primary/10 bg-background/25">
                <SmartflowAsciiVisual variant="wiremesh" className="h-full w-full opacity-80" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold sm:text-xl">
                {t("flow_greeting")}, {greetingName} 👋
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("flow_hero_desc")}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("flow_quick_title")}</h3>
          <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1" role="list">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="listitem"
                disabled={disabled}
                onClick={() => onSelectPrompt(action.prompt)}
                className="glass-card flex w-[176px] shrink-0 flex-col items-start gap-2 rounded-xl p-3 text-start transition-all hover:shadow-elevated hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div
                  className={cn("icon-tile h-9 w-9 shrink-0 rounded-lg", !isDark && action.iconBg)}
                  style={isDark ? { background: `var(--flow-${action.accent}-bg)` } : undefined}
                >
                  <action.icon
                    className={cn("h-4 w-4", !isDark && action.iconColor)}
                    style={isDark ? { color: `var(--flow-${action.accent})` } : undefined}
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(action.labelKey)}</p>
                  <p className="text-[11px] text-muted-foreground">{t(action.descKey)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
