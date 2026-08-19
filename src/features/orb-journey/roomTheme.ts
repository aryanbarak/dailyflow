// ADR-0015 §5: Room theming, abstract and design-token-driven ONLY -- never
// real task titles, event data, or amounts. Sourced from the SAME place
// micro-breaks/orbTokens.ts already draws from (existing --flow-* CSS
// custom properties, resolved via the same colorNormalization.ts parser),
// not a new data source. This module intentionally imports NOTHING from any
// workspace/task/calendar/finance data-fetching module -- see
// roomTheme.test.ts's source-verification proof of that boundary.
//
// This slice ships exactly ONE theme family (ADR-0015 §7): Focus/Tasks-
// inspired abstract shapes -- rounded "card" rectangles with a checkmark-
// like glyph or list-line marks, no real text anywhere.
import { toCanvasColor } from '../micro-breaks/colorNormalization';
import type { RoomThemeId } from './roomEngine';

export interface RoomThemeColors {
  readonly accent: (alpha: number) => string;
  readonly cardFill: (alpha: number) => string;
  readonly cardBorder: (alpha: number) => string;
}

interface RoomThemeCssVars {
  readonly accent: string;
  readonly cardFill: string;
  readonly cardBorder: string;
}

// Every value here is an EXISTING design-token custom property name (see
// src/styles/flow-tokens.css) -- no new tokens added, no literal hex values.
const ROOM_THEME_CSS_VARS: Record<RoomThemeId, RoomThemeCssVars> = {
  'focus-tasks': {
    accent: '--flow-primary',
    cardFill: '--flow-surface-2',
    cardBorder: '--flow-border-soft',
  },
};

export function resolveRoomThemeColors(theme: RoomThemeId, rootElement: HTMLElement = document.documentElement): RoomThemeColors {
  const varNames = ROOM_THEME_CSS_VARS[theme];
  const computed = getComputedStyle(rootElement);
  const read = (name: string) => computed.getPropertyValue(name).trim();
  const accentRaw = read(varNames.accent);
  const cardFillRaw = read(varNames.cardFill);
  const cardBorderRaw = read(varNames.cardBorder);
  return {
    accent: alpha => toCanvasColor(accentRaw, alpha),
    cardFill: alpha => toCanvasColor(cardFillRaw, alpha),
    cardBorder: alpha => toCanvasColor(cardBorderRaw, alpha),
  };
}

export interface RoomThemeGeometry {
  readonly width: number;
  readonly height: number;
}

// Abstract "task card" shapes: a few rounded rectangles with a checkmark-like
// glyph or short list-line marks -- never real text, never data. Drawn
// BEHIND the ball/paddle/trail (caller draws those after this). `progress`
// (0..1, the current room's combo / goalCombo) subtly brightens the accent
// so the background visibly responds to the player getting closer to
// clearing the room, without introducing a second scoring signal.
export function drawFocusTasksTheme(
  ctx: CanvasRenderingContext2D,
  geometry: RoomThemeGeometry,
  colors: RoomThemeColors,
  progress: number,
): void {
  const { width, height } = geometry;
  const cardWidth = width * 0.62;
  const cardHeight = height * 0.09;
  const cardX = (width - cardWidth) / 2;
  const gap = height * 0.03;
  const cardCount = 3;
  const totalHeight = cardCount * cardHeight + (cardCount - 1) * gap;
  const startY = height * 0.14;
  const clampedProgress = Math.min(1, Math.max(0, progress));

  ctx.save();
  for (let i = 0; i < cardCount; i++) {
    const cardY = startY + i * (cardHeight + gap);
    if (cardY + cardHeight > startY + totalHeight) break;

    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, cardHeight, cardHeight * 0.3);
    ctx.fillStyle = colors.cardFill(0.55);
    ctx.fill();
    ctx.strokeStyle = colors.cardBorder(0.8);
    ctx.lineWidth = 1;
    ctx.stroke();

    // A checkmark-like glyph on the leftmost card (the "current goal"),
    // brightening toward the accent color as room progress nears the goal;
    // plain list-line marks on the rest -- abstract shape language, no text.
    const glyphSize = cardHeight * 0.5;
    const glyphX = cardX + cardHeight * 0.35;
    const glyphY = cardY + cardHeight / 2;
    if (i === 0) {
      ctx.strokeStyle = colors.accent(0.35 + clampedProgress * 0.5);
      ctx.lineWidth = Math.max(1.5, glyphSize * 0.18);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(glyphX, glyphY);
      ctx.lineTo(glyphX + glyphSize * 0.35, glyphY + glyphSize * 0.35);
      ctx.lineTo(glyphX + glyphSize, glyphY - glyphSize * 0.4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = colors.cardBorder(0.9);
      ctx.lineWidth = Math.max(1, glyphSize * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(glyphX, glyphY);
      ctx.lineTo(glyphX + glyphSize, glyphY);
      ctx.stroke();
    }

    // Short "list line" marks to the right of the glyph -- abstract text
    // placeholders, never real characters.
    const lineStartX = cardX + cardHeight * 1.1;
    const lineEndX = cardX + cardWidth * 0.7;
    ctx.strokeStyle = colors.cardBorder(0.5);
    ctx.lineWidth = Math.max(1, cardHeight * 0.08);
    ctx.beginPath();
    ctx.moveTo(lineStartX, glyphY);
    ctx.lineTo(lineEndX, glyphY);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawRoomTheme(
  ctx: CanvasRenderingContext2D,
  geometry: RoomThemeGeometry,
  theme: RoomThemeId,
  colors: RoomThemeColors,
  progress: number,
): void {
  switch (theme) {
    case 'focus-tasks':
      drawFocusTasksTheme(ctx, geometry, colors, progress);
      break;
  }
}
