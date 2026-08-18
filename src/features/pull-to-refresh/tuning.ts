// Task 38: feel-tuning constants for the custom in-app pull-to-refresh
// gesture, gathered in one file (mirrors the convention already established
// by src/features/micro-breaks/tuning.ts).

// How far (in real touch px) the finger must travel before the pull
// counts as "ready to release into a refresh."
export const PULL_THRESHOLD_PX = 64;

// Hard visual cap on how far the indicator can be dragged, regardless of
// how far the finger actually travels -- keeps the reveal bounded even for
// a very long drag.
export const MAX_PULL_PX = 96;

// Rubber-band feel: the indicator moves at half the finger's real travel
// distance, so the pull reads as resisted rather than 1:1.
export const PULL_DAMPING_FACTOR = 0.5;

// Movement (in px, pre-damping) required before the gesture commits to
// "this is a vertical pull" vs. "this is a horizontal swipe" vs. "this is
// an upward flick." Below this, touchmove is a no-op so a small jitter at
// touchstart never gets misread either way.
export const GESTURE_DECISION_THRESHOLD_PX = 10;
