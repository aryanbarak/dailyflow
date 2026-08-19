// @vitest-environment jsdom
//
// ADR-0015 §5: room theming is abstract and design-token-driven ONLY --
// never real task titles, event data, or amounts. This preserves the
// existing "game never reads workspace data" trust boundary (ADR-0014 §1).
//
// Two independent proofs, deliberately not just one:
// 1. STATIC (source-verification): roomTheme.ts's own import statements
//    never reference any workspace/task/calendar/finance/journal
//    data-fetching module. This is the stronger guarantee -- it holds
//    regardless of which code path a test happens to exercise, unlike a
//    runtime spy which only proves "wasn't called THIS run."
// 2. RUNTIME: resolving colors never triggers a network request. Actually
//    drawing (drawRoomTheme/drawFocusTasksTheme, in the SAME file with the
//    SAME closed import list) needs a real canvas 2D context -- jsdom has
//    none at all (see this project's "green jsdom proves nothing about
//    canvas rendering" lesson) -- so that half of the proof is structural
//    (proof #1: nothing importable to call) plus the real-browser Journey
//    smoke test (e2e/orbJourney.spec.ts) actually rendering a room.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRoomThemeColors } from './roomTheme';

const roomThemeSource = readFileSync(path.resolve(process.cwd(), 'src', 'features', 'orb-journey', 'roomTheme.ts'), 'utf-8');

describe('roomTheme: static import boundary (ADR-0015 §5)', () => {
  it('imports nothing from any workspace/task/calendar/finance/journal data module', () => {
    const disallowedPatterns = [
      /from ['"].*tasksService['"]/,
      /from ['"].*useTasks['"]/,
      /from ['"].*financeService['"]/,
      /from ['"].*useFinance['"]/,
      /from ['"].*calendarService['"]/,
      /from ['"].*journalService['"]/,
      /from ['"].*\/hooks\/use[A-Z]/, // any app data hook (useTasks, useFinance, useHabits, etc.)
      /from ['"].*supabase['"]/i,
      /from ['"]@\/features\/tasks/,
      /from ['"]@\/features\/finance/,
      /from ['"]@\/features\/calendar/,
      /from ['"]@\/features\/journal/,
    ];
    for (const pattern of disallowedPatterns) {
      expect(roomThemeSource, `roomTheme.ts must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('imports ONLY from colorNormalization.ts and roomEngine.ts -- a small, closed, auditable import list', () => {
    const importLines = roomThemeSource.match(/^import .+$/gm) ?? [];
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line, line).toMatch(/colorNormalization|roomEngine/);
    }
  });
});

describe('roomTheme: runtime boundary', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    document.documentElement.style.setProperty('--flow-primary', '#7C4DFF');
    document.documentElement.style.setProperty('--flow-surface-2', '#0F1128');
    document.documentElement.style.setProperty('--flow-border-soft', 'rgba(112, 120, 180, 0.22)');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
  });

  it('resolving theme colors (the only part testable without a real canvas -- jsdom has no 2D context, see this project\'s own "green jsdom proves nothing about canvas" lesson) never calls fetch', () => {
    const colors = resolveRoomThemeColors('focus-tasks');
    expect(colors.accent(0.5)).toBeTruthy();
    expect(colors.cardFill(0.5)).toBeTruthy();
    expect(colors.cardBorder(0.5)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
