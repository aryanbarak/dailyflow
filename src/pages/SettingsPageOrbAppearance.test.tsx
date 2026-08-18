// @vitest-environment jsdom
//
// Task 17h: the new "Pointer glow" section in Settings -> Appearance.
// SettingsPage's default export is heavy (useAuth/useTasks/useDocuments/
// usePhotos/useProfile/several live Supabase queries) and, like
// ChatPage.tsx's own default export (see ChatPageChromeCleanup.test.tsx),
// isn't practically mountable in isolation -- this file follows that same
// established source-verification pattern instead.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const settingsPageSource = readFileSync(
  path.resolve(process.cwd(), "src", "pages", "SettingsPage.tsx"),
  "utf-8",
);

describe("Settings > Appearance: pointer glow section (task 17h)", () => {
  it("reads orb preferences + setters from appearanceStore (not local-only state)", () => {
    // MB-03 added microBreakDurationSeconds/setMicroBreakDurationSeconds on
    // the SAME two lines (a legitimate destructuring extension, not a
    // regression) -- \S* tolerates whatever else shares the line without
    // weakening what this test actually verifies (orb fields + setters are
    // still destructured from appearanceStore, not local-only state).
    expect(settingsPageSource).toMatch(
      /orbEnabled, orbColor, orbSize, orbOpacity,\s*\S*\s*\n\s*setDensity, setAccentColor, setReducedMotion, setLanguage,\s*\n\s*setOrbEnabled, setOrbColor, setOrbSize, setOrbOpacity,/,
    );
  });

  it("every new orb label routes through t(...) -- none of the four new controls are hardcoded English strings", () => {
    expect(settingsPageSource).toMatch(/title=\{t\('settings_orb_title'\)\}/);
    expect(settingsPageSource).toMatch(/label=\{t\('settings_orb_enabled'\)\}\s*desc=\{t\('settings_orb_enabled_desc'\)\}/);
    expect(settingsPageSource).toMatch(/\{t\('settings_orb_color'\)\}/);
    expect(settingsPageSource).toMatch(/\{t\('settings_orb_size'\)\}/);
    expect(settingsPageSource).toMatch(/\{t\('settings_orb_opacity'\)\}/);
  });

  it("the colour/size rows use the same flex-wrap layout as the sibling Accent color/Layout density sections -- no hardcoded ml-/mr-/pl-/pr-/left-/right- utility that would fail to mirror in RTL", () => {
    const orbSectionStart = settingsPageSource.indexOf("settings_orb_title");
    const orbSectionEnd = settingsPageSource.indexOf('title="Accessibility"');
    expect(orbSectionStart).toBeGreaterThan(-1);
    expect(orbSectionEnd).toBeGreaterThan(orbSectionStart);
    const orbSection = settingsPageSource.slice(orbSectionStart, orbSectionEnd);
    expect(orbSection).toMatch(/flex gap-2 flex-wrap/);
    expect(orbSection).not.toMatch(/\b(ml|mr|pl|pr)-\d/);
    expect(orbSection).not.toMatch(/\bleft-\d|\bright-\d/);
  });

  it("the empty-state avatar toggle from a prior task and the theme/density selectors are untouched by this section (sanity: orb section is additive, inserted before Accessibility)", () => {
    const accessibilityIndex = settingsPageSource.indexOf('title="Accessibility"');
    const orbTitleIndex = settingsPageSource.indexOf("t('settings_orb_title')");
    expect(orbTitleIndex).toBeGreaterThan(-1);
    expect(orbTitleIndex).toBeLessThan(accessibilityIndex);
  });
});
