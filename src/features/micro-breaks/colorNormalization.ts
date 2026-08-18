// ADR-0014, MB-02b: canvas 2D color values must be concrete strings (no
// CSS var()/color-mix()) that exactly match a format the browser's color
// parser accepts. The DOM pointer orb never hits this problem -- it uses
// var()/color-mix() directly in CSS, which is format-agnostic. The canvas
// renderer has to resolve a CSS custom property via getComputedStyle and
// build the color string itself; MB-02 wrongly assumed the resolved value
// would be an HSL-components triplet ("H S% L%") and constructed
// `hsl(<value> / alpha)` unconditionally -- but the orb settings' actual
// underlying custom properties (--flow-*, see src/styles/flow-tokens.css)
// are stored as HEX (`#7C4DFF`), not HSL components. `hsl(#7C4DFF / 0.5)`
// is not valid CSS, and `CanvasGradient.addColorStop` -- unlike
// `ctx.fillStyle`, which silently ignores an invalid value -- validates
// strictly and throws a SyntaxError. That uncaught throw (MB-02b production
// incident, smartaryn.com) happened inside a synchronous mount-time draw()
// call, before React's passive-effect flush had reached this overlay's own
// Esc-listener effect, and with no error boundary anywhere in the app tree,
// the resulting unmount cascade took the whole page down -- see
// MicroBreakOverlay's own render-error handling for the fix to that half.
//
// This module is the fix for the color half: normalize ANY of the formats
// actually produced by this codebase's tokens to one canvas-safe rgba()
// string, with alpha support, and a safe fallback for anything
// unrecognized -- so no draw call anywhere has to assume a specific stored
// format again.

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// --flow-primary's own value (src/styles/flow-tokens.css) -- used only when
// a token can't be parsed at all, so the game is never left drawing an
// undefined/invisible color.
export const FALLBACK_RGB: RgbColor = { r: 124, g: 77, b: 255 };

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i;
// Matches both a bare "H S% L%" custom-property value (the shadcn/Tailwind
// convention used by --primary, see index.css) and an already-wrapped
// hsl()/hsla() string, comma- or space-separated.
const HSL_PATTERN = /^(?:hsla?\(\s*)?(-?[\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i;

function expandHex(hex: string): string {
  return hex.length === 3
    ? hex
        .split('')
        .map(c => c + c)
        .join('')
    : hex;
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let [r1, g1, b1] = [0, 0, 0];
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Parses any of the color formats actually produced by this codebase's
 * design tokens -- hex (#RGB/#RRGGBB), rgb()/rgba(), a bare "H S% L%"
 * triplet, or an already-wrapped hsl()/hsla() string -- into plain RGB
 * components. Returns null for anything unrecognized (garbage input);
 * callers apply FALLBACK_RGB, this function never throws.
 */
export function parseColorToRgb(raw: string): RgbColor | null {
  const value = raw.trim();
  if (!value) return null;

  const hexMatch = value.match(HEX_PATTERN);
  if (hexMatch) {
    const hex = expandHex(hexMatch[1]);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = value.match(RGB_PATTERN);
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
  }

  const hslMatch = value.match(HSL_PATTERN);
  if (hslMatch) {
    return hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]), Number(hslMatch[3]));
  }

  return null;
}

// ADR-0014 visibility invariant: game-critical elements (ball, paddle) must
// never become invisible regardless of a user's chosen orb opacity/color
// token. Decorative-only uses (trail, glow) are NOT floored here -- they're
// allowed to stay subtle/token-driven; only opaque "core" fills (see
// resolveOrbCanvasColors below) go through this floor.
export const MIN_VISIBLE_ALPHA = 0.35;
export const MIN_VISIBLE_BRIGHTNESS = 60; // 0-255 perceived-luma floor against the overlay's dark backdrop

export function clampVisibleAlpha(alpha: number, enforceMinimumVisibility: boolean): number {
  const bounded = Math.min(1, Math.max(0, alpha));
  return enforceMinimumVisibility ? Math.max(bounded, MIN_VISIBLE_ALPHA) : bounded;
}

function perceivedBrightness(rgb: RgbColor): number {
  // ITU-R BT.601 luma approximation -- sufficient for a visibility floor,
  // not intended to be colorimetrically precise.
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

/** Blends toward white just enough to close the gap to MIN_VISIBLE_BRIGHTNESS -- keeps hue mostly intact rather than jumping to a fixed "safe" color. */
export function ensureMinimumBrightness(rgb: RgbColor): RgbColor {
  const brightness = perceivedBrightness(rgb);
  if (brightness >= MIN_VISIBLE_BRIGHTNESS) return rgb;
  const blend = Math.min(1, (MIN_VISIBLE_BRIGHTNESS - brightness) / 255);
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * blend),
    g: Math.round(rgb.g + (255 - rgb.g) * blend),
    b: Math.round(rgb.b + (255 - rgb.b) * blend),
  };
}

export function toRgbaColor(rgb: RgbColor, alpha: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export interface ToCanvasColorOptions {
  /** Applies the alpha AND brightness visibility floors -- use for
   *  game-critical opaque fills (ball, paddle), never for purely
   *  decorative uses (trail, glow). */
  readonly enforceMinimumVisibility?: boolean;
}

/**
 * The one function game rendering code should call: a raw token value in
 * (whatever format it happens to be stored/resolved as), a canvas-safe
 * rgba() string out. Never throws -- falls back to FALLBACK_RGB for
 * unparseable input.
 */
export function toCanvasColor(raw: string, alpha: number, options?: ToCanvasColorOptions): string {
  const enforce = options?.enforceMinimumVisibility ?? false;
  const parsed = parseColorToRgb(raw) ?? FALLBACK_RGB;
  const rgb = enforce ? ensureMinimumBrightness(parsed) : parsed;
  return toRgbaColor(rgb, clampVisibleAlpha(alpha, enforce));
}
