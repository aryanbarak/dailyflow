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
}

const NO_INSET: VisualViewportInsets = { keyboardInsetPx: 0, isKeyboardOpen: false };

function readInsets(): VisualViewportInsets {
  if (typeof window === "undefined" || !window.visualViewport) return NO_INSET;
  const vv = window.visualViewport;
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  // Sub-pixel noise from browser rounding shouldn't register as "keyboard open".
  const keyboardInsetPx = inset > 1 ? Math.round(inset) : 0;
  return { keyboardInsetPx, isKeyboardOpen: keyboardInsetPx > 0 };
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
