import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MICRO_BREAK_DURATION_SECONDS,
  MICRO_BREAK_DURATION_PRESETS_SECONDS,
  resolveMicroBreakDurationSeconds,
} from './types';

describe('resolveMicroBreakDurationSeconds (MB-03, ADR-0014 §7 frozen preset set)', () => {
  it.each(MICRO_BREAK_DURATION_PRESETS_SECONDS)('passes a valid preset (%i) through unchanged', preset => {
    expect(resolveMicroBreakDurationSeconds(preset)).toBe(preset);
  });

  it.each([45, 0, -90, 999, NaN, Infinity])('falls back to the default (90) for an invalid numeric value: %s', invalid => {
    expect(resolveMicroBreakDurationSeconds(invalid)).toBe(DEFAULT_MICRO_BREAK_DURATION_SECONDS);
  });

  it.each([undefined, null, 'ninety', {}, [], true])('falls back to the default (90) for a garbage/non-numeric value: %s', invalid => {
    expect(resolveMicroBreakDurationSeconds(invalid)).toBe(DEFAULT_MICRO_BREAK_DURATION_SECONDS);
  });

  it('the fallback default is itself always one of the frozen presets', () => {
    expect(MICRO_BREAK_DURATION_PRESETS_SECONDS).toContain(DEFAULT_MICRO_BREAK_DURATION_SECONDS);
  });
});
