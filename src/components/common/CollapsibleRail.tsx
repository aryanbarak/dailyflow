import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

// DESIGN-AUDIT 4 (responsive, 2026-09-05): the shared 300px right rail
// (AI suggestions / stats / widgets) used to render BELOW the entire
// main column on mobile -- far under the fold and effectively
// undiscoverable. On mobile the rail now moves to the TOP of the page
// as a single collapsed disclosure row, so its cards are one tap away
// without pushing the main content down; from lg up nothing changes --
// the same sticky 300px column as before.
export function CollapsibleRail({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "w-full shrink-0 max-lg:order-first lg:sticky lg:top-4 lg:w-[300px] lg:self-start",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="glass-card flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold lg:hidden"
      >
        {t("rail_suggestions_toggle")}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <div className={cn("space-y-4 max-lg:mt-3", !open && "max-lg:hidden")}>
        {children}
      </div>
    </div>
  );
}
