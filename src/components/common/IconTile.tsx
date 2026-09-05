import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type IconTileTone =
  | "primary"
  | "study"
  | "plan"
  | "analyze"
  | "review"
  | "report"
  | "career";

// DESIGN-AUDIT 2 (2026-09-06): the last shared-component extraction from
// the audit -- the `.icon-tile` chip used across pages/widgets picked its
// colors ad hoc at every call site. The `tone` prop locks the choices to
// the flow semantic token pairs (bg + icon color; icons inherit via
// currentColor, so children need no text-* class). Sizing/radius stay
// per-call-site via className, same as before. The chat surface keeps
// using the raw `.icon-tile` class -- its chrome is pinned/frozen
// (ChatPageChromeCleanup.test.tsx) and chat colors are token-guarded
// separately.
const TONE_CLASSES: Record<IconTileTone, string> = {
  primary: "text-primary",
  study: "bg-[var(--flow-study-bg)] text-[var(--flow-study)]",
  plan: "bg-[var(--flow-plan-bg)] text-[var(--flow-plan)]",
  analyze: "bg-[var(--flow-analyze-bg)] text-[var(--flow-analyze)]",
  review: "bg-[var(--flow-review-bg)] text-[var(--flow-review)]",
  report: "bg-[var(--flow-report-bg)] text-[var(--flow-report)]",
  career: "bg-[var(--flow-career-bg)] text-[var(--flow-career)]",
};

export function IconTile({
  tone = "primary",
  className,
  children,
}: Readonly<{ tone?: IconTileTone; className?: string; children: ReactNode }>) {
  // `.icon-tile` already supplies the primary-tinted background; non-primary
  // tones override it (utilities layer wins over the component layer).
  return (
    <div className={cn("icon-tile", TONE_CLASSES[tone], className)}>
      {children}
    </div>
  );
}
