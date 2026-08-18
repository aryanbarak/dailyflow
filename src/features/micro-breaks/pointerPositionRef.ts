// Cheap, non-reactive shared "last known pointer position" -- used only for
// the orb handoff transition (ADR-0014 §5). Deliberately NOT in a zustand
// store: both SmartflowPointerFollower's and PongCanvas's own pointermove
// handlers would need to update it on every single event, and a reactive
// store would re-render every subscriber on every pointer move for no
// reason -- MicroBreakOverlay only ever READS this, once, at handoff time.
export interface PointerPosition {
  x: number;
  y: number;
}

const position: PointerPosition = { x: 0, y: 0 };
let hasPosition = false;

export function setLastPointerPosition(x: number, y: number): void {
  position.x = x;
  position.y = y;
  hasPosition = true;
}

/** Returns the last known pointer position, or `null` if no pointer event
 *  has been observed yet (e.g. a touch-only session that hasn't moved a
 *  finger before opening a break) -- callers fall back to a fixed rest
 *  point (viewport center) in that case. */
export function getLastPointerPosition(): PointerPosition | null {
  return hasPosition ? position : null;
}
