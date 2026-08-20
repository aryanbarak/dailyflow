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
//
// MB-13, ADR-0015 §12: a SECOND theme family, Rhythm/Calendar (Room 3) --
// grid lines and horizontal bar shapes, same "abstract, token-sourced,
// never real data" rule, same closed import list (see this file's own
// header above and roomTheme.test.ts's static-boundary proof, which covers
// BOTH theme functions since it checks the whole file's imports, not a
// per-function allowlist).
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
// MB-13, ADR-0015 §12: Rhythm/Calendar (Room 3) deliberately uses a
// DIFFERENT token family (blue) from Focus/Tasks' violet
// (--flow-primary/--flow-surface-2/--flow-border-soft) -- both an
// intentional per-module-family visual distinction (ADR-0015 §5) and what
// makes Room 3 read as visibly distinct from Rooms 1/2 at a glance, not
// just via shape.
const ROOM_THEME_CSS_VARS: Record<RoomThemeId, RoomThemeCssVars> = {
  'focus-tasks': {
    accent: '--flow-primary',
    cardFill: '--flow-surface-2',
    cardBorder: '--flow-border-soft',
  },
  'rhythm-calendar': {
    accent: '--flow-blue',
    cardFill: '--flow-surface-3',
    cardBorder: '--flow-border',
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

// MB-13, ADR-0015 §12: Rhythm/Calendar theme -- grid lines (a calendar-grid
// abstraction: evenly spaced horizontal "day rows" and vertical "hour
// columns") plus a few horizontal bar shapes across some of those rows (an
// abstract "event block" -- a plain rectangle, no rounded corners and no
// glyph, deliberately a DIFFERENT shape language from Focus/Tasks' rounded
// checkmark cards above, so the two themes read as visually distinct even
// in a single still frame, not just via color). Never real dates, times, or
// event text -- same rule as drawFocusTasksTheme. Drawn BEHIND the ball/
// paddle/trail, same layering contract as drawFocusTasksTheme. `progress`
// brightens the accent the same way (closer to the room's own goal), for
// parity with Focus/Tasks' behavior.
export function drawRhythmCalendarTheme(
  ctx: CanvasRenderingContext2D,
  geometry: RoomThemeGeometry,
  colors: RoomThemeColors,
  progress: number,
): void {
  const { width, height } = geometry;
  const clampedProgress = Math.min(1, Math.max(0, progress));

  ctx.save();

  // Grid: a handful of "day row" horizontal lines and "hour column"
  // vertical lines, evenly spaced, low-alpha -- a calendar-grid silhouette,
  // not a functional grid (no labels, no real time values).
  const rowCount = 6;
  const columnCount = 4;
  ctx.strokeStyle = colors.cardBorder(0.35);
  ctx.lineWidth = 1;
  for (let row = 1; row < rowCount; row++) {
    const y = (height * row) / rowCount;
    ctx.beginPath();
    ctx.moveTo(width * 0.06, y);
    ctx.lineTo(width * 0.94, y);
    ctx.stroke();
  }
  for (let col = 1; col < columnCount; col++) {
    const x = (width * col) / columnCount;
    ctx.beginPath();
    ctx.moveTo(x, height * 0.08);
    ctx.lineTo(x, height * 0.92);
    ctx.stroke();
  }

  // Horizontal "event" bars -- flat rectangles spanning one or more grid
  // columns, aligned to grid rows. The FIRST (the "current goal", mirroring
  // drawFocusTasksTheme's own leftmost-card convention) brightens toward the
  // accent color as room progress nears the goal; the rest stay a plain,
  // static card-fill tone.
  const barHeight = (height / rowCount) * 0.5;
  const barSpecs = [
    { row: 1, startCol: 0, spanCols: 3 },
    { row: 3, startCol: 1, spanCols: 2 },
    { row: 4, startCol: 0, spanCols: 2 },
  ];
  barSpecs.forEach((spec, index) => {
    const barX = width * 0.06 + (spec.startCol * (width * 0.88)) / columnCount;
    const barWidth = (spec.spanCols * (width * 0.88)) / columnCount;
    const barY = (height * spec.row) / rowCount - barHeight / 2;

    ctx.beginPath();
    ctx.rect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = index === 0 ? colors.accent(0.25 + clampedProgress * 0.45) : colors.cardFill(0.6);
    ctx.fill();
    ctx.strokeStyle = colors.cardBorder(0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.restore();
}

// MB-06: room-transition accent-flash alpha envelope, extracted out of
// JourneyCanvas.tsx's draw() so the easing SHAPE is unit-testable without a
// canvas (draw() itself is not testable in jsdom -- getContext('2d') returns
// null). Half-sine over the window: 0 at both ends, peak at the midpoint --
// deliberately NOT a linear ramp from an instant jump-to-peak, which was the
// pre-MB-06 shape (a hard cut on transition entry, only eased on exit).
export function computeRoomTransitionFlashAlpha(elapsedMs: number, totalMs: number, peakAlpha: number): number {
  if (totalMs <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
  return peakAlpha * Math.sin(Math.PI * progress);
}

// MB-07, ADR-0015 §10 (amendment): pulse alpha (0..1) for a breakable
// obstacle's edge, extracted as a pure function so the SHAPE is unit-
// testable without a canvas -- mirrors computeRoomTransitionFlashAlpha's
// own rationale above. Under reduced motion this returns a fixed
// mid-brightness value instead of animating, consistent with this
// component's existing reduced-motion convention (trail length, shadow
// blur, particle count, transition flash all suppress CONTINUOUS motion --
// see JourneyCanvas.tsx) -- the obstacle must still read as visually
// distinct (a fairness requirement, ADR-0015 §10), just without animating.
export function computeObstaclePulseAlpha(nowMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.75;
  return (Math.sin(nowMs / 220) + 1) / 2;
}

export interface RoomObstacleRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ADR-0015 §10 (amendment): obstacles use the SAME Focus/Tasks card visual
// language as the decorative background above (rounded rect, card
// fill/border tokens) but read as more solid (higher fill alpha) since they
// are REAL collision surfaces, not decoration. Breakable ones get a
// pulsing accent border -- a FAIRNESS requirement per §10's own text, not
// just polish: a player must be able to tell breakable apart from solid at
// a glance. Non-breakable is supported here for forward compatibility
// (§10 explicitly says obstacles "may be" breakable) but unused this
// slice -- Room 2's one obstacle is always breakable.
export function drawRoomObstacle(
  ctx: CanvasRenderingContext2D,
  rect: RoomObstacleRect,
  colors: RoomThemeColors,
  breakable: boolean,
  pulseAlpha: number,
): void {
  const clampedPulse = Math.min(1, Math.max(0, pulseAlpha));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, Math.min(rect.width, rect.height) * 0.22);
  ctx.fillStyle = colors.cardFill(0.75);
  ctx.fill();
  ctx.lineWidth = breakable ? 2 : 1.5;
  ctx.strokeStyle = breakable ? colors.accent(0.5 + clampedPulse * 0.5) : colors.cardBorder(0.9);
  ctx.stroke();
  ctx.restore();
}

// MB-08, ADR-0015 §11 (amendment): drifting orbs render in the SAME light
// family as the main Orb ("same light family... per the Design Language
// table"), so this accepts the SHAPE of micro-breaks/orbTokens.ts's
// OrbCanvasColors WITHOUT importing that module -- structurally compatible
// (core: string, glow: alpha => string), so the caller's already-resolved
// colors object satisfies this directly. Preserves roomTheme.ts's closed
// import list (colorNormalization.ts / roomEngine.ts only -- see this
// file's own header comment and roomTheme.test.ts's static-boundary proof).
export interface DriftingOrbColors {
  readonly core: string;
  readonly glow: (alpha: number) => string;
}

export interface DriftingOrbRimStyle {
  readonly lineWidth: number;
  /** Applied only when role === 'penalty' -- reward's rim is always smooth
   *  (an empty dash array), so there is no separate "reward dash" constant. */
  readonly penaltyDash: readonly number[];
}

// ADR-0015 §11: idle (pre-contact) appearance. Reward (Calm) gets a smooth,
// continuous rim; penalty (Haste) gets a notched/dashed rim -- a
// distinction that must be visible BEFORE contact and is NEVER gated by
// reduced motion (it's a static shape, not animation). `rimStyle` bundles
// named tuning constants supplied by the caller (orb-journey/tuning.ts),
// not inline literals here -- keeps this module's import list unchanged
// (no new import needed) while still satisfying "named constants, not
// inline values."
export function drawDriftingOrbIdle(
  ctx: CanvasRenderingContext2D,
  center: { readonly x: number; readonly y: number },
  radius: number,
  role: 'reward' | 'penalty',
  colors: DriftingOrbColors,
  rimStyle: DriftingOrbRimStyle,
): void {
  const { x, y } = center;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = colors.glow(0.5);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = colors.core;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = rimStyle.lineWidth;
  ctx.setLineDash(role === 'penalty' ? [...rimStyle.penaltyDash] : []);
  ctx.strokeStyle = colors.core;
  ctx.stroke();
  ctx.setLineDash([]); // reset -- subsequent draw calls (obstacles, theme cards) must not inherit this
  ctx.restore();
}

// ADR-0015 §11: Jolt (Haste) "sharp double-flash (bright-dim-bright)" --
// pure so the SHAPE is unit-testable without a canvas, mirroring
// computeRoomTransitionFlashAlpha/computeObstaclePulseAlpha's own
// rationale. NEVER gated by reduced motion at this layer -- it's a
// color/brightness cue, not motion (ADR-0015 §11's own distinction); the
// caller decides whether to render it, but the math itself doesn't change.
export function computeJoltFlashIntensity(elapsedMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
  return Math.abs(Math.cos(Math.PI * progress));
}

// ADR-0015 §11: Absorb (Calm) "single smooth warm brightening pulse" --
// deliberately a plain fade-out (not a dip-shaped curve like Jolt's flash),
// so the two reactions read as visually distinct shapes, not just different
// colors. Also never gated by reduced motion at this layer.
export function computeAbsorbPulseAlpha(elapsedMs: number, totalMs: number, peakAlpha: number): number {
  if (totalMs <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
  return peakAlpha * (1 - progress);
}

// ADR-0015 §11: Jolt's "small, bounded, short-duration shake." Deterministic
// (no RNG -- decaying sine/cosine jitter), bounded (decays linearly to
// zero), and reduced-motion-gated AT THE CALL SITE via the `reducedMotion`
// parameter (returns {0,0} immediately) rather than baked into the motion
// math itself, so the underlying curve stays independently testable from
// the gating decision.
export function computeJoltShakeOffset(
  nowMs: number,
  elapsedMs: number,
  totalMs: number,
  magnitudePx: number,
  reducedMotion: boolean,
): { readonly dx: number; readonly dy: number } {
  if (reducedMotion || totalMs <= 0 || elapsedMs < 0 || elapsedMs > totalMs) return { dx: 0, dy: 0 };
  const decay = 1 - elapsedMs / totalMs;
  return {
    dx: Math.sin(nowMs * 0.08) * magnitudePx * decay,
    dy: Math.cos(nowMs * 0.11) * magnitudePx * decay,
  };
}

// NEW, MB-10, ADR-0015 §11 (revision): penalty-role paddle-catch -- a
// successful defensive block. A symmetric rise-then-fall (half-sine) bump,
// deliberately a THIRD distinct curve shape from both Jolt's bright-dim-
// bright dip and Absorb's plain monotonic fade, so all three drifting-orb
// reactions read as visually distinct even before considering position
// (this one draws at the PADDLE, not the ball) or particle direction.
// Never gated by reduced motion at this layer, matching Absorb/Jolt's own
// convention -- a successful block is gameplay feedback, not decoration.
export function computePaddleCatchPulseAlpha(elapsedMs: number, totalMs: number, peakAlpha: number): number {
  if (totalMs <= 0) return 0;
  const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
  return peakAlpha * Math.sin(Math.PI * progress);
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
    case 'rhythm-calendar':
      drawRhythmCalendarTheme(ctx, geometry, colors, progress);
      break;
  }
}
