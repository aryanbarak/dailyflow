// Task 17h: the pointer-glow settings (Settings -> Appearance) must have
// real EN/DE/FA labels, not just an English fallback silently reused --
// useT()'s own fallback-to-English behaviour (see index.ts) would hide a
// missing DE/FA translation, so this asserts each language's dictionary
// defines its OWN distinct string for every new key.
import { describe, expect, it } from "vitest";
import { translations, type Lang, type TranslationKey } from "./index";

const ORB_KEYS: TranslationKey[] = [
  "settings_orb_title",
  "settings_orb_enabled",
  "settings_orb_enabled_desc",
  "settings_orb_color",
  "settings_orb_size",
  "settings_orb_opacity",
  "settings_orb_size_small",
  "settings_orb_size_medium",
  "settings_orb_size_large",
  "settings_orb_size_xl",
  "settings_orb_color_primary",
  "settings_orb_color_blue",
  "settings_orb_color_cyan",
  "settings_orb_color_study",
  "settings_orb_color_plan",
  "settings_orb_color_analyze",
  "settings_orb_color_review",
  "settings_orb_color_report",
  "settings_orb_color_career",
];

const LANGS: Lang[] = ["en", "de", "fa"];

describe("orb (pointer glow) settings translations (task 17h)", () => {
  it.each(LANGS)("%s defines a non-empty string for every orb settings key", (lang) => {
    const dict = translations[lang] as Record<string, string>;
    for (const key of ORB_KEYS) {
      expect(dict[key], `${lang}.${key}`).toBeTruthy();
      expect(typeof dict[key]).toBe("string");
    }
  });

  // "Cyan" is the standard German word for the colour too (a legitimate
  // shared loanword, same spelling) -- not a missing translation.
  const SHARED_SPELLING_KEYS = new Set<TranslationKey>(["settings_orb_color_cyan"]);

  it("DE and FA translations are genuinely localized, not just copies of the English string", () => {
    for (const key of ORB_KEYS) {
      if (SHARED_SPELLING_KEYS.has(key)) continue;
      expect(translations.de[key], `de.${key} vs en`).not.toBe(translations.en[key]);
      expect(translations.fa[key], `fa.${key} vs en`).not.toBe(translations.en[key]);
    }
  });
});
