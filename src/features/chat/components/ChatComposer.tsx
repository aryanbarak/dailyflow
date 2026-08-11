import { useEffect, useLayoutEffect, useRef } from "react";
import { Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { clampComposerHeight, COMPOSER_MIN_LINES, isComposerOverflowing, prefersDesktopEnterToSend } from "../composerSizing";

// Task 17d, V2: the field's line-height multiplier (Tailwind's
// leading-relaxed = 1.625), used to build a CSS-only `min-height` floor
// below -- see that comment for why this exists.
const LEADING_RELAXED_MULTIPLIER = 1.625;

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
  const recomputeHeight = () => {
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
  };

  useLayoutEffect(recomputeHeight, [value, compact]);

  // Task 17d, V2: device evidence showed the composer rendering only ONE
  // line on first paint despite task 17c's COMPOSER_MIN_LINES=2 -- jsdom
  // (no real font loading, no real layout pipeline) never surfaced this.
  // useLayoutEffect's synchronous measure-before-paint guarantee assumes
  // `getComputedStyle` already reflects the FINAL font metrics -- but the
  // custom webfonts (Vazirmatn/Sora, @font-face-loaded asynchronously, see
  // index.css) may not have swapped in yet on first mount, especially on a
  // slower mobile connection/device. `document.fonts.ready` resolves once
  // every font actually used by the rendered page has finished loading;
  // re-running the SAME measurement then catches a stale first-paint
  // measurement without re-running on every render. This is defense in
  // depth -- the PRIMARY fix is the CSS-only `minHeight` inline style below
  // (a pure font-size-relative calc, correct on the very first paint frame
  // with ZERO JavaScript dependency at all, the same "make it structurally
  // impossible to get wrong" approach V1 uses for the send button).
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) recomputeHeight();
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    // Task 17d, V1: on a real Android device, Persian composer text still
    // clipped behind the send button despite task 17c's E4 direction fix --
    // jsdom's computed-style check said the direction resolved correctly,
    // but that only proved the LOGICAL padding/position classes pointed at
    // the right side, not that the reserved space was actually big enough
    // in every real rendering engine. The OLD structure floated the button
    // via `position: absolute`, entirely OUTSIDE normal layout flow, and
    // relied on the textarea's `pe-12` padding happening to line up with
    // it pixel-for-pixel (48px padding vs. a 44px button + 4px inset --
    // effectively a zero-margin fit, with no structural guarantee the two
    // numbers stay in sync). Fixed at the ROOT per the task's own preferred
    // approach: the button is now a REAL FLEX SIBLING of the textarea in
    // one flex row, not an absolutely-positioned overlay -- `flex-1
    // min-w-0` on the field and `shrink-0` on the button make the
    // textarea's own content box narrow to make room, which the browser's
    // box model GUARANTEES regardless of font metrics, zoom, or Android
    // rendering quirks. Overlap is now geometrically impossible by
    // construction, not by two independent numbers happening to match.
    <div className={cn("flex items-end gap-3", compact ? "px-2 py-1.5" : "px-3 py-2")}>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("chat_placeholder")}
        rows={COMPOSER_MIN_LINES}
        disabled={disabled}
        dir="auto"
        aria-label={t("chat_placeholder")}
        // Task 17d, V2: a pure CSS min-height, correct on the FIRST PAINT
        // FRAME with zero JavaScript involved -- the useLayoutEffect/
        // useEffect logic above still owns GROWING the field as the user
        // types, but the 2-line FLOOR no longer depends on that JS having
        // already run (or having measured correct font metrics) before the
        // browser paints. `em` is relative to THIS element's own font-size,
        // so it stays correct across compact mode's smaller text
        // automatically -- no separate hardcoded pixel value to keep in
        // sync. Mirrors composerSizing.ts's COMPOSER_MIN_LINES and
        // LEADING_RELAXED_MULTIPLIER (leading-relaxed's own 1.625 value) so
        // this can never silently drift from the JS clamp logic's own
        // 2-line floor.
        style={{
          minHeight: `calc(${COMPOSER_MIN_LINES} * ${LEADING_RELAXED_MULTIPLIER}em + ${compact ? "1rem" : "1.25rem"})`,
        }}
        className={cn(
          // Task 17b: the field's own surface uses --glass-bg directly
          // (rather than the bg-background/70 opacity trick) so it
          // matches the PO's token map literally -- "composer ->
          // --flow-glass-bg" -- for both themes: light's --glass-bg is
          // task 17a's existing frosted-white value (unchanged look),
          // dark's --glass-bg is now exactly --flow-glass-bg (see
          // index.css's [data-chat-theme="dark"] block). The focus
          // affordance ("with --flow-border-active on focus") comes for
          // free from focus-visible:ring-2 already reading --ring, which
          // is also derived from --flow-border-active in dark -- no
          // composer-specific focus CSS needed. Task 17d, workstream 3
          // (design polish -- affordance): ring width bumped 1->2 so the
          // focus state reads clearly as "you're typing here," still the
          // same --ring color token, no new token.
          "min-w-0 flex-1 resize-none rounded-2xl border-border bg-[hsl(var(--glass-bg))] px-3.5 py-2.5 text-sm leading-relaxed shadow-none transition-[height] duration-100 focus-visible:ring-2",
          compact && "py-2 text-[13px]",
        )}
      />
      <Button
        type="button"
        size="icon"
        onClick={onSend}
        disabled={!canSend}
        aria-label={disabled ? t("chat_sending") : t("chat_send")}
        // Task 17d, workstream 3 (design polish -- affordance): a plain
        // elevation shadow (the existing shadow-md utility, backed by the
        // existing --shadow-md token -- NOT one of the --flow-glow-*/orb
        // tokens task 17b's restraint rule reserves for its two motif
        // placements only) gives the send action visual weight when it's
        // actually actionable, and recedes to flat when disabled --
        // matching the existing disabled:opacity-50 the Button component
        // already applies.
        className="mb-1 h-11 w-11 shrink-0 rounded-full p-0 shadow-md disabled:shadow-none"
        style={{ background: "var(--gradient-primary)" }}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
