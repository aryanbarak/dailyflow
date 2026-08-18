// MB-02b: unit coverage for the color normalization utility that fixes the
// production incident (CanvasGradient.addColorStop threw a SyntaxError on
// 'hsl(#7C4DFF / 0.5)' -- a hex token wrongly wrapped in an hsl() template).
// See this module's own header comment for the full root-cause narrative.
import { describe, expect, it } from 'vitest';
import {
  clampVisibleAlpha,
  ensureMinimumBrightness,
  FALLBACK_RGB,
  MIN_VISIBLE_ALPHA,
  MIN_VISIBLE_BRIGHTNESS,
  parseColorToRgb,
  toCanvasColor,
  toRgbaColor,
} from './colorNormalization';

describe('parseColorToRgb: hex', () => {
  it('parses a 6-digit hex string (the actual --flow-* token format, e.g. --flow-primary)', () => {
    expect(parseColorToRgb('#7C4DFF')).toEqual({ r: 124, g: 77, b: 255 });
  });

  it('parses a 3-digit hex shorthand', () => {
    expect(parseColorToRgb('#0F8')).toEqual({ r: 0, g: 255, b: 136 });
  });

  it('is case-insensitive', () => {
    expect(parseColorToRgb('#7c4dff')).toEqual({ r: 124, g: 77, b: 255 });
  });
});

describe('parseColorToRgb: rgb()/rgba()', () => {
  it('parses rgb()', () => {
    expect(parseColorToRgb('rgb(124, 77, 255)')).toEqual({ r: 124, g: 77, b: 255 });
  });

  it('parses rgba(), ignoring the embedded alpha (alpha is applied separately by toCanvasColor)', () => {
    expect(parseColorToRgb('rgba(124, 77, 255, 0.5)')).toEqual({ r: 124, g: 77, b: 255 });
  });
});

describe('parseColorToRgb: hsl components', () => {
  it('parses a bare "H S% L%" triplet (the shadcn/Tailwind --primary convention, index.css)', () => {
    const rgb = parseColorToRgb('256 100% 65%');
    // 256deg, fully saturated, 65% lightness -- a blue-violet, close to but
    // not identical to #7C4DFF (a different color space convention).
    expect(rgb).not.toBeNull();
    expect(rgb!.r).toBeGreaterThan(100);
    expect(rgb!.b).toBeGreaterThan(200);
  });

  it('parses an already-wrapped hsl() string', () => {
    const bare = parseColorToRgb('256 100% 65%');
    const wrapped = parseColorToRgb('hsl(256 100% 65%)');
    expect(wrapped).toEqual(bare);
  });

  it('round-trips pure red (0deg, 100%, 50%)', () => {
    expect(parseColorToRgb('0 100% 50%')).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('parseColorToRgb: rejection for garbage input', () => {
  it.each(['', '   ', 'not-a-color', 'var(--flow-primary)', 'color-mix(in srgb, red 50%, transparent)', 'transparent', 'currentColor'])(
    'returns null for %j',
    input => {
      expect(parseColorToRgb(input)).toBeNull();
    },
  );
});

describe('toCanvasColor: the exact MB-02b regression case', () => {
  it('a hex token (the real --flow-primary value) produces a valid rgba() string, never an invalid hsl() template', () => {
    const result = toCanvasColor('#7C4DFF', 0.5);
    expect(result).toBe('rgba(124, 77, 255, 0.5)');
    expect(result).not.toContain('hsl(#');
  });

  it('garbage input falls back to FALLBACK_RGB instead of throwing or producing an invalid string', () => {
    const result = toCanvasColor('garbage-value', 0.5);
    expect(result).toBe(toRgbaColor(FALLBACK_RGB, 0.5));
  });
});

describe('clampVisibleAlpha', () => {
  it('bounds alpha to [0, 1] regardless of enforcement', () => {
    expect(clampVisibleAlpha(-5, false)).toBe(0);
    expect(clampVisibleAlpha(5, false)).toBe(1);
  });

  it('without enforcement, a low alpha passes through unchanged', () => {
    expect(clampVisibleAlpha(0.05, false)).toBe(0.05);
  });

  it('with enforcement, alpha is floored at MIN_VISIBLE_ALPHA (ADR-0014 visibility invariant)', () => {
    expect(clampVisibleAlpha(0.05, true)).toBe(MIN_VISIBLE_ALPHA);
    expect(clampVisibleAlpha(0, true)).toBe(MIN_VISIBLE_ALPHA);
  });

  it('with enforcement, an alpha already above the floor is left unchanged', () => {
    expect(clampVisibleAlpha(0.9, true)).toBe(0.9);
  });
});

describe('ensureMinimumBrightness', () => {
  it('leaves an already-bright color unchanged', () => {
    const bright = { r: 124, g: 77, b: 255 };
    expect(ensureMinimumBrightness(bright)).toEqual(bright);
  });

  it('lightens a near-black color to cross MIN_VISIBLE_BRIGHTNESS', () => {
    const dark = { r: 5, g: 5, b: 10 };
    const result = ensureMinimumBrightness(dark);
    const luma = 0.299 * result.r + 0.587 * result.g + 0.114 * result.b;
    // Per-channel Math.round() introduces up to ~1 luma unit of slack.
    expect(luma).toBeGreaterThanOrEqual(MIN_VISIBLE_BRIGHTNESS - 2);
  });

  it('pure black is lifted towards white, not left invisible', () => {
    const result = ensureMinimumBrightness({ r: 0, g: 0, b: 0 });
    expect(result.r).toBeGreaterThan(0);
    expect(result.g).toBeGreaterThan(0);
    expect(result.b).toBeGreaterThan(0);
  });
});

describe('toCanvasColor: visibility floor end to end', () => {
  it('enforceMinimumVisibility raises both a too-low alpha and a too-dark color', () => {
    const result = toCanvasColor('#010101', 0.02, { enforceMinimumVisibility: true });
    const match = result.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
    expect(match).not.toBeNull();
    const [, r, g, b, a] = match!;
    const luma = 0.299 * Number(r) + 0.587 * Number(g) + 0.114 * Number(b);
    expect(luma).toBeGreaterThanOrEqual(MIN_VISIBLE_BRIGHTNESS - 1);
    expect(Number(a)).toBeGreaterThanOrEqual(MIN_VISIBLE_ALPHA);
  });

  it('without enforcement (decorative use), the same dark/low-alpha input is left as-is', () => {
    const result = toCanvasColor('#010101', 0.02);
    expect(result).toBe('rgba(1, 1, 1, 0.02)');
  });
});
