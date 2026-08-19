// ADR-0014, MB-02 slice 1: mirrors orbSettingsTranslations.test.ts's own
// pattern -- useT()'s fallback-to-English behaviour (see index.ts) would
// silently hide a missing DE/FA translation, so this asserts each
// language's dictionary defines its OWN distinct, non-empty string for
// every new Micro Breaks key (no raw English leaking into the fa flow).
import { describe, expect, it } from 'vitest';
import { translations, type Lang, type TranslationKey } from './index';

const MICRO_BREAKS_KEYS: TranslationKey[] = [
  'micro_breaks_entry_label',
  'micro_breaks_overlay_aria_label',
  'micro_breaks_close_aria_label',
  'micro_breaks_score_value',
  'micro_breaks_time_value',
  'micro_breaks_render_error',
  'micro_breaks_combo_value',
  'micro_breaks_final_wave_label',
  'settings_micro_breaks_title',
  'settings_micro_breaks_duration_label',
  'micro_breaks_duration_option',
  // ADR-0015, MB-05 slice 1.
  'micro_breaks_session_choice_title',
  'micro_breaks_session_choice_quick_break',
  'micro_breaks_session_choice_quick_break_desc',
  'micro_breaks_session_choice_journey',
  'micro_breaks_session_choice_journey_desc',
  'micro_breaks_journey_overlay_aria_label',
  'micro_breaks_journey_room_value',
  'micro_breaks_journey_cleared_label',
];

const LANGS: Lang[] = ['en', 'de', 'fa'];

describe('Micro Breaks translations (ADR-0014)', () => {
  it.each(LANGS)('%s defines a non-empty string for every micro-breaks key', lang => {
    const dict = translations[lang] as Record<string, string>;
    for (const key of MICRO_BREAKS_KEYS) {
      expect(dict[key], `${lang}.${key}`).toBeTruthy();
      expect(typeof dict[key]).toBe('string');
    }
  });

  it('DE and FA translations are genuinely localized, not just copies of the English string', () => {
    for (const key of MICRO_BREAKS_KEYS) {
      expect(translations.de[key], `de.${key} vs en`).not.toBe(translations.en[key]);
      expect(translations.fa[key], `fa.${key} vs en`).not.toBe(translations.en[key]);
    }
  });

  it('FA strings contain Persian script (never a raw English fallback rendered into the RTL flow)', () => {
    const persianPattern = /[؀-ۿ]/;
    for (const key of MICRO_BREAKS_KEYS) {
      expect(persianPattern.test(translations.fa[key]), `fa.${key}`).toBe(true);
    }
  });
});
