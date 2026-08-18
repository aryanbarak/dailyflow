// @vitest-environment jsdom
//
// MB-03: the new "Micro Breaks" duration-preset section in Settings ->
// Appearance. Mirrors SettingsPageOrbAppearance.test.tsx's own
// source-verification pattern -- SettingsPage's default export is heavy
// (useAuth/useTasks/useDocuments/usePhotos/useProfile/several live Supabase
// queries) and isn't practically mountable in isolation.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const settingsPageSource = readFileSync(path.resolve(process.cwd(), 'src', 'pages', 'SettingsPage.tsx'), 'utf-8');

describe('Settings > Appearance: Micro Breaks duration section (MB-03, ADR-0014 §7)', () => {
  it('reads microBreakDurationSeconds + its setter from appearanceStore (not local-only state)', () => {
    expect(settingsPageSource).toMatch(
      /orbEnabled, orbColor, orbSize, orbOpacity, microBreakDurationSeconds,\s*\n\s*setDensity, setAccentColor, setReducedMotion, setLanguage,\s*\n\s*setOrbEnabled, setOrbColor, setOrbSize, setOrbOpacity, setMicroBreakDurationSeconds,/,
    );
  });

  it('renders exactly the frozen preset set (60/90/120), not a hardcoded literal array', () => {
    expect(settingsPageSource).toMatch(/MICRO_BREAK_DURATION_PRESETS_SECONDS\.map\(seconds =>/);
    expect(settingsPageSource).toMatch(/import \{ MICRO_BREAK_DURATION_PRESETS_SECONDS \} from '@\/features\/micro-breaks\/types';/);
  });

  it('title and duration label route through t(...) -- not hardcoded English', () => {
    expect(settingsPageSource).toMatch(/title=\{t\('settings_micro_breaks_title'\)\}/);
    expect(settingsPageSource).toMatch(/\{t\('settings_micro_breaks_duration_label'\)\}/);
  });

  it('each preset option label is translated (micro_breaks_duration_option), never a bare template literal', () => {
    expect(settingsPageSource).toMatch(/t\('micro_breaks_duration_option', \{ seconds \}\)/);
    expect(settingsPageSource).not.toMatch(/\{seconds\}s</); // no un-translated "{seconds}s" JSX text
  });

  it('numerals are RTL-safe via the bidiText isolation pattern (isolateBidiRunsInText + resolveMessageBaseDirection)', () => {
    const sectionStart = settingsPageSource.indexOf('settings_micro_breaks_title');
    const sectionEnd = settingsPageSource.indexOf('title="Accessibility"');
    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    const section = settingsPageSource.slice(sectionStart, sectionEnd);
    expect(section).toMatch(/resolveMessageBaseDirection\(optionText\)/);
    expect(section).toMatch(/isolateBidiRunsInText\(optionText,/);
  });

  it('is inserted before Accessibility, after the orb section -- additive, not replacing anything', () => {
    const orbTitleIndex = settingsPageSource.indexOf("t('settings_orb_title')");
    const microBreaksTitleIndex = settingsPageSource.indexOf("t('settings_micro_breaks_title')");
    const accessibilityIndex = settingsPageSource.indexOf('title="Accessibility"');
    expect(orbTitleIndex).toBeGreaterThan(-1);
    expect(microBreaksTitleIndex).toBeGreaterThan(orbTitleIndex);
    expect(microBreaksTitleIndex).toBeLessThan(accessibilityIndex);
  });
});
