// SmartFlow -- Flow AI visual identity (task 17b): a reusable, tested
// implementation of the same WCAG relative-luminance/contrast-ratio
// method task 17a's report computed by hand for its light-theme pairs.
// Made into real code here because 17b needs the SAME check repeated for
// several Dark Cosmic pairs (including the PO's explicitly flagged
// "gradient's lightest stop vs. text-primary" risk), and a hand
// calculation can't be independently re-verified by a test the way this
// can. See https://www.w3.org/TR/WCAG21/#dfn-relative-luminance and
// #dfn-contrast-ratio for the formulas this implements verbatim.

function srgbChannelToLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    throw new Error(`Expected a 6-digit hex color, got "${hex}"`);
  }
  return {
    r: Number.parseInt(normalized.substring(0, 2), 16),
    g: Number.parseInt(normalized.substring(2, 4), 16),
    b: Number.parseInt(normalized.substring(4, 6), 16),
  };
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const rLin = srgbChannelToLinear(r);
  const gLin = srgbChannelToLinear(g);
  const bLin = srgbChannelToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT_MIN_RATIO = 4.5;
