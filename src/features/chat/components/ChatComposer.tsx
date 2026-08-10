import { useLayoutEffect, useRef } from "react";
import { Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { clampComposerHeight, isComposerOverflowing, prefersDesktopEnterToSend } from "../composerSizing";

// SmartFlow -- Chat Experience v2 (task 17a), workstream 1: composer
// rebuild. This is the PO-flagged mobile pain point -- a plain 5-row
// fixed Textarea before this task. Now: auto-grows 1 -> ~5 lines then
// scrolls internally, the send button lives INSIDE the field (flips side
// automatically for RTL via `end-*`, a logical Tailwind property -- never
// hardcoded left/right), the touch target is >=44px (h-11 w-11, the
// composer's biggest single a11y/mobile-usability fix), and Enter-to-send
// is desktop-only (mobile/touch keyboards and IME composition get a plain
// newline on Enter -- see composerSizing.ts's prefersDesktopEnterToSend
// for why viewport width is the WRONG signal here).
//
// Colors are the SAME global-named tokens (bg-background, border-border,
// text-foreground) the rest of the app already uses -- see index.css's
// [data-chat-theme] blocks for why this is theme-aware with zero extra
// wiring, as long as this renders under a [data-chat-theme] ancestor
// (ChatPage's own root -- see that file).

export interface ChatComposerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly disabled: boolean;
  readonly compact?: boolean;
}

export function ChatComposer({ value, onChange, onSend, disabled, compact = false }: ChatComposerProps) {
  const { t } = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineHeightPxRef = useRef(0);

  // Auto-grow: measured against the field's OWN computed line-height
  // (varies with font/zoom/compact mode), not a hardcoded pixel guess.
  // Re-measures line-height lazily (once, or again whenever compact mode
  // changes the font-size) rather than on every keystroke.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const computedStyle = window.getComputedStyle(el);
    const measuredLineHeight = Number.parseFloat(computedStyle.lineHeight);
    if (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0) {
      lineHeightPxRef.current = measuredLineHeight;
    }
    const verticalPadding =
      Number.parseFloat(computedStyle.paddingTop || "0") + Number.parseFloat(computedStyle.paddingBottom || "0");

    el.style.height = "auto"; // reset so scrollHeight reflects the NEW natural content height
    const naturalHeight = el.scrollHeight;
    const clamped = clampComposerHeight(naturalHeight, lineHeightPxRef.current, verticalPadding);
    el.style.height = `${clamped}px`;
    el.style.overflowY = isComposerOverflowing(naturalHeight, lineHeightPxRef.current, verticalPadding)
      ? "auto"
      : "hidden";
  }, [value, compact]);

  const canSend = !disabled && value.trim().length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    const matchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : undefined;
    if (!prefersDesktopEnterToSend(matchMedia)) return; // mobile/touch: Enter is an ordinary newline, never sends
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className={cn("flex items-end gap-2", compact ? "px-2 py-1.5" : "px-3 py-2")}>
      <div className="relative min-w-0 flex-1">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat_placeholder")}
          rows={1}
          disabled={disabled}
          dir="auto"
          aria-label={t("chat_placeholder")}
          className={cn(
            "min-h-0 resize-none rounded-2xl border-border bg-background/70 py-2.5 ps-3.5 pe-12 text-sm leading-relaxed shadow-none transition-[height] duration-100 focus-visible:ring-1",
            compact && "py-2 text-[13px]",
          )}
        />
        <Button
          type="button"
          size="icon"
          onClick={onSend}
          disabled={!canSend}
          aria-label={disabled ? t("chat_sending") : t("chat_send")}
          className="absolute bottom-1 end-1 h-11 w-11 shrink-0 rounded-full p-0"
          style={{ background: "var(--gradient-primary)" }}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
