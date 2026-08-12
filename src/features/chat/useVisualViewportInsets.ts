import { useEffect, useState } from "react";

// SmartFlow -- Chat Experience v2 (task 17a). Mobile keyboard handling
// strategy (see the task report's "viewport strategy chosen + why" for
// the full writeup): CSS `dvh` is the PRIMARY mechanism (AppLayout's
// mobile shell now sizes itself with `100dvh` instead of the static
// `100vh` `min-h-screen` it used before -- see AppLayout.tsx -- which
// natively shrinks the chat page's own `h-full` flex column when the
// on-screen keyboard opens, on every current mobile browser that supports
// `dvh`, no JS required). This hook is the SECONDARY, defense-in-depth
// layer: it tracks window.visualViewport directly and reports exactly how
// much of the layout viewport the keyboard currently covers, so:
//   (a) the chat root can add that as extra reserved space via a CSS
//       custom property, covering any residual gap on a browser where
//       `dvh` doesn't track the keyboard perfectly; and
//   (b) callers can detect the open/close TRANSITION to re-settle the
//       message scroll position smoothly instead of leaving a visible
//       jump while the viewport is still animating.
// Guarded throughout for environments without window.visualViewport
// (older browsers, and jsdom in tests) -- keyboardInsetPx simply stays 0,
// never throws.

export interface VisualViewportInsets {
  /** Pixels of the layout viewport currently covered by an on-screen keyboard (or any other visual-viewport-shrinking overlay); 0 when none. */
  readonly keyboardInsetPx: number;
  /** True exactly when keyboardInsetPx > 0 -- convenience for consumers that only need the boolean. */
  readonly isKeyboardOpen: boolean;
  /**
   * Task 17f, C2: `window.visualViewport.height`, rounded -- null when
   * visualViewport isn't available (SSR, jsdom, pre-hydration, or an older
   * browser). Production evidence: after a fresh mount in the Android PWA
   * STANDALONE context, `100dvh` mis-measured the shell (the composer sat
   * below the visible viewport, needing a scroll to reach) -- a known
   * standalone-mode quirk where `dvh` doesn't reliably track the real
   * visual viewport immediately after load/reload the way it does in an
   * ordinary browser tab. `window.visualViewport.height` reads the actual
   * rendered viewport directly from the browser, so it is authoritative
   * whenever it's available; `100dvh` (a plain CSS class, no JS
   * dependency) remains the correct fallback for the narrow window before
   * this hook's effect has run, and for any environment without
   * visualViewport support at all.
   */
  readonly viewportHeightPx: number | null;
}

const NO_INSET: VisualViewportInsets = { keyboardInsetPx: 0, isKeyboardOpen: false, viewportHeightPx: null };

function readInsets(): VisualViewportInsets {
  if (typeof window === "undefined" || !window.visualViewport) return NO_INSET;
  const vv = window.visualViewport;
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  // Sub-pixel noise from browser rounding shouldn't register as "keyboard open".
  const keyboardInsetPx = inset > 1 ? Math.round(inset) : 0;
  return { keyboardInsetPx, isKeyboardOpen: keyboardInsetPx > 0, viewportHeightPx: Math.round(vv.height) };
}

/**
 * Task 17f, C2: the ONE place that decides which height source is
 * authoritative for a shell container -- extracted as a pure function
 * (same "extract the single decision" pattern as chatScrollDecision.ts/
 * emptyStateVisibility.ts) so the precedence itself is directly testable
 * without mounting a component or stubbing window.visualViewport. Returns
 * an inline-style `height` value (wins over any CSS class) when a real
 * measurement is available, or `undefined` (lets the `h-[100dvh]` CSS
 * class apply untouched) otherwise.
 */
export function resolveShellHeightStyle(viewportHeightPx: number | null): string | undefined {
  return viewportHeightPx !== null ? `${viewportHeightPx}px` : undefined;
}

export function useVisualViewportInsets(): VisualViewportInsets {
  const [insets, setInsets] = useState<VisualViewportInsets>(NO_INSET);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handle = () => setInsets(readInsets());
    handle();
    vv.addEventListener("resize", handle);
    vv.addEventListener("scroll", handle);
    return () => {
      vv.removeEventListener("resize", handle);
      vv.removeEventListener("scroll", handle);
    };
  }, []);

  return insets;
}
