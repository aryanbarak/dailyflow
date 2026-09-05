import { useEffect, useLayoutEffect, useRef } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { isolateEmbeddedBidiRuns } from "@/lib/bidiText";
import { clampComposerHeight, COMPOSER_MIN_LINES, isComposerOverflowing, prefersDesktopEnterToSend } from "../composerSizing";
import {
  CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES,
  formatAttachmentSize,
} from "../chatAttachmentValidation";

// Task 17d, V2: the field's line-height multiplier (Tailwind's
// leading-relaxed = 1.625), used to build a CSS-only `min-height` floor
// below -- see that comment for why this exists.
const LEADING_RELAXED_MULTIPLIER = 1.625;

// SmartFlow -- Chat Experience v2 (task 17a), workstream 1: composer
// rebuild; layout revised per PO decision (2026-09-05) to a DeepSeek-style
// single box, then compacted the same day against the ChatGPT reference:
// the rounded glass surface is a wrapper containing the auto-growing field
// (1 -> ~5 lines then internal scroll) on top and an action row below it
// -- attach at the inline start, send at the inline end (mirrors
// automatically for RTL via justify-end + me-auto). Both buttons are 36px
// circles (h-9 w-9) by explicit PO override of the >=44px touch-target
// floor, and Enter-to-send is desktop-only
// (mobile/touch keyboards and IME composition get a plain newline on
// Enter -- see composerSizing.ts's prefersDesktopEnterToSend for why
// viewport width is the WRONG signal here).
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
  // Task 19 (Attach file in Flow AI): all optional, and the attach control
  // renders ONLY when onAttachFile is provided -- every pre-task-19 caller/
  // test that omits these props keeps rendering exactly one button (the
  // send button), unaffected by this addition.
  readonly attachedFile?: File | null;
  readonly onAttachFile?: (file: File) => void;
  readonly onRemoveAttachedFile?: () => void;
  readonly attachBusy?: boolean;
  readonly attachError?: string | null;
  // SmartFlow Home frozen design handoff §7: Home's embedded composer says
  // "Ask SmartFlow anything…". Presentation-only, same pattern as
  // ChatPageHeader's compactControls -- undefined (the standalone /chat
  // route and every existing caller) falls back to the translated
  // `chat_placeholder`, unchanged.
  readonly placeholderOverride?: string;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  compact = false,
  attachedFile = null,
  onAttachFile,
  onRemoveAttachedFile,
  attachBusy = false,
  attachError = null,
  placeholderOverride,
}: ChatComposerProps) {
  const { t } = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file after removal
    if (file && onAttachFile) onAttachFile(file);
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
    //
    // Task 19: the attachment chip/error live ABOVE this flex row (their own
    // block-level siblings in a column), never inside it -- keeping the row
    // itself exactly the same two/three-item flex layout V1 already
    // guarantees non-overlapping, just with one more shrink-0 item.
    <div className="flex flex-col gap-1.5">
      {attachedFile && (
        <div
          className={cn("flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 py-1.5 text-xs", compact ? "mx-2 px-2.5" : "mx-3 px-3")}
          data-testid="chat-attachment-chip"
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {/* File names are arbitrary user/OS-provided text -- mixed-direction
              (e.g. a Persian name with a Latin ".pdf" extension) needs the
              same bidi isolation every other user-generated text surface
              uses (task 11e/17f convention), not plain interpolation. */}
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {isolateEmbeddedBidiRuns(attachedFile.name)}
          </span>
          <span className="shrink-0 text-muted-foreground">{formatAttachmentSize(attachedFile.size)}</span>
          <button
            type="button"
            onClick={onRemoveAttachedFile}
            disabled={attachBusy}
            aria-label={t("chat_attach_remove")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {attachError && (
        <p className={cn("text-xs text-destructive", compact ? "mx-2" : "mx-3")} role="alert">
          {attachError}
        </p>
      )}
      {/* PO decision (2026-09-05): DeepSeek-style composer -- ONE visual
          box (the rounded glass surface + focus ring live on this wrapper
          now, via focus-within) containing the textarea on top and an
          action row BELOW it with the attach + send buttons side by side
          at the inline end. This keeps task 17d V1's core guarantee even
          more strongly than the old single-row layout: the buttons are in
          their own flex row, a separate block sibling of the textarea, so
          text/button overlap is impossible by construction in every
          direction, font, and zoom -- no absolute positioning anywhere.
          justify-end resolves to the right in LTR and the left in RTL
          automatically. */}
      <div className={cn(compact ? "px-2 py-1.5" : "px-3 py-2")}>
        <div className="flex flex-col rounded-2xl bg-[hsl(var(--glass-bg))] transition-shadow focus-within:ring-2 focus-within:ring-ring">
          <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholderOverride ?? t("chat_placeholder")}
        rows={COMPOSER_MIN_LINES}
        disabled={disabled}
        dir="auto"
        aria-label={placeholderOverride ?? t("chat_placeholder")}
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
          minHeight: `calc(${COMPOSER_MIN_LINES} * ${LEADING_RELAXED_MULTIPLIER}em + 1rem)`,
        }}
        className={cn(
          // Task 17b's token map ("composer -> --flow-glass-bg") and the
          // 17d/17g focus + border decisions now live on the WRAPPER box
          // above: it carries bg-[hsl(var(--glass-bg))] and the ring-2
          // focus affordance (via focus-within, same --ring token). Task
          // 17g Y1 still holds: no always-on decorative outline anywhere
          // -- `border-0` removes shadcn Textarea's default border, and
          // the field itself is transparent and ring-free (PO decision
          // 2026-09-05, DeepSeek-style box).
          "w-full resize-none border-0 bg-transparent px-3.5 py-2 text-sm leading-relaxed shadow-none transition-[height] duration-100 focus-visible:ring-0",
          compact && "text-[13px]",
        )}
      />
          {/* Action row INSIDE the box, below the field. PO decision
              (2026-09-05, ChatGPT-style compact pass): attach sits at the
              inline START (me-auto pushes everything after it to the end),
              send at the inline END -- the ChatGPT arrangement -- and both
              buttons shrank from the 44px floor to 36px circles (explicit
              PO override of the >=44px touch-target rule for these two
              controls, matching the reference). justify-end + me-auto both
              mirror automatically for RTL. */}
          <div className={cn("flex items-center justify-end gap-1.5 pb-1.5 pt-0.5", compact ? "px-1.5" : "px-2")}>
            {onAttachFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES.join(",")}
                  onChange={handleFileInputChange}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleAttachClick}
                  disabled={disabled || attachBusy}
                  aria-label={t("chat_attach_file")}
                  // me-auto anchors attach at the inline START of the
                  // justify-end row (ChatGPT arrangement); shrink-0 keeps
                  // its box whole.
                  className="h-9 w-9 shrink-0 rounded-full p-0 me-auto"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </Button>
              </>
            )}
            <Button
              type="button"
              size="icon"
              onClick={onSend}
              disabled={!canSend}
              aria-label={disabled ? t("chat_sending") : t("chat_send")}
              // Task 17d, workstream 3 (design polish -- affordance): a plain
              // elevation shadow (the existing shadow-md utility) gives the
              // send action visual weight when it's actually actionable, and
              // recedes to flat when disabled.
              className="h-9 w-9 shrink-0 rounded-full p-0 shadow-md disabled:shadow-none"
              style={{ background: "var(--gradient-primary)" }}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
