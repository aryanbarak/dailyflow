// ADR-0014 §5: the shared Orb visual definition -- tokens/model only (core
// color, glow radius/opacity, size, gradient stops), sourced from the
// EXISTING orb settings in appearanceStore.ts. Deliberately NOT a shared
// React component: SmartflowPointerFollower keeps rendering exactly as
// before (pixel-identical DOM), and PongCanvas draws the game ball on
// <canvas> from these same tokens.
import { ORB_COLOR_VAR, ORB_SIZE_PX, useAppearance, type OrbColor, type OrbSize } from '@/features/settings/appearanceStore';

export interface OrbVisualTokens {
  /** `var(--flow-*)` -- usable directly as a DOM/CSS color value. */
  readonly colorVar: string;
  /** The bare custom-property name (e.g. `--flow-primary`) -- canvas cannot
   *  read `var()` references directly, so this is resolved separately via
   *  resolveOrbCanvasColors. */
  readonly cssVarName: string;
  readonly sizePx: number;
  readonly opacity: number;
}

// Mirrors smartflow-pointer-follower.tsx's own radial-gradient stops
// exactly (see its glow layer): a soft white highlight at the core,
// fading through the orb color, to fully transparent by 70%.
export const ORB_GRADIENT_STOPS = {
  coreWhiteAlpha: 0.5,
  innerColorStop: 0.18,
  innerColorAlpha: 0.34,
  outerColorStop: 0.42,
  outerColorAlpha: 0.12,
  transparentStop: 0.7,
} as const;

export function getOrbVisualTokens(orbColor: OrbColor, orbSize: OrbSize, orbOpacity: number): OrbVisualTokens {
  const cssVarName = ORB_COLOR_VAR[orbColor];
  return {
    colorVar: `var(${cssVarName})`,
    cssVarName,
    sizePx: ORB_SIZE_PX[orbSize],
    opacity: orbOpacity,
  };
}

export function useOrbVisualTokens(): OrbVisualTokens {
  const orbColor = useAppearance(s => s.orbColor);
  const orbSize = useAppearance(s => s.orbSize);
  const orbOpacity = useAppearance(s => s.orbOpacity);
  return getOrbVisualTokens(orbColor, orbSize, orbOpacity);
}

export interface OrbCanvasColors {
  /** Solid core color, e.g. `hsl(256 100% 65%)`. */
  readonly core: string;
  /** Alpha-blended variant for gradient stops, e.g. `glow(0.34)`. */
  readonly glow: (alpha: number) => string;
}

// Resolves the CSS custom property (an "H S% L%" triplet, e.g.
// "256 100% 65%" -- see appearanceStore.ts's ORB_COLOR_VAR/flow-tokens.css)
// to concrete color strings a <canvas> 2D context can use directly. The DOM
// orb reads the SAME custom property via var()/color-mix() in CSS; canvas
// has no equivalent, so this is the one place that resolves it to a plain
// value -- kept as a small, isolated function rather than duplicating the
// palette so both renderers still derive from one source of truth
// (flow-tokens.css via getComputedStyle, not a hardcoded copy).
export function resolveOrbCanvasColors(tokens: OrbVisualTokens, rootElement: HTMLElement = document.documentElement): OrbCanvasColors {
  const hslTriplet = getComputedStyle(rootElement).getPropertyValue(tokens.cssVarName).trim() || '256 100% 65%';
  return {
    core: `hsl(${hslTriplet})`,
    glow: (alpha: number) => `hsl(${hslTriplet} / ${alpha})`,
  };
}
