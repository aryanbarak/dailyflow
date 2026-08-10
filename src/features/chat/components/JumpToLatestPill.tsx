import { ArrowDown } from "lucide-react";
import { useT } from "@/i18n";

// SmartFlow -- Chat Experience v2 (task 17a), workstream 2: "smart auto-
// scroll... otherwise show a 'jump to latest' pill; never yank the scroll
// position while reading history." Rendered only when the reader has
// scrolled up out of the auto-follow zone AND new content has arrived
// below -- see chatScrollDecision.ts for the pure decision logic and
// ChatPage.tsx for how the two are wired together.

export interface JumpToLatestPillProps {
  readonly visible: boolean;
  readonly onClick: () => void;
}

export function JumpToLatestPill({ visible, onClick }: JumpToLatestPillProps) {
  const { t } = useT();
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="chat-reduced-motion pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97]"
    >
      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
      {t("chat_jump_to_latest")}
    </button>
  );
}
