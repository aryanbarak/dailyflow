// Task 22 (calendar write slice): exact structural copy of
// agentIntentTranslations.test.ts's pattern -- see that file for the
// original create/update task keys this mirrors for calendar events.
import { describe, expect, it } from "vitest";
import { translations, type Lang, type TranslationKey } from "./index";

const LANGUAGES: Lang[] = ["en", "de", "fa"];

const NEW_CALENDAR_INTENT_KEYS: TranslationKey[] = [
  "agent_intent_title_create_calendar_event",
  "agent_intent_title_update_calendar_event",
  "agent_intent_create_calendar_event_description",
  "agent_intent_calendar_event_update_description",
  "agent_intent_create_calendar_event_approval_reason",
  "agent_intent_calendar_event_update_approval_reason",
  "agent_intent_preview_start",
  "agent_intent_preview_end",
];

describe("calendar write intent translations", () => {
  it.each(LANGUAGES)("resolves new create/update calendar event keys in %s", language => {
    for (const key of NEW_CALENDAR_INTENT_KEYS) {
      expect(translations[language][key], `${language}.${key}`).toBeTruthy();
      expect(translations[language][key], `${language}.${key}`).not.toBe(key);
    }
  });

  it("localizes the visible create/update titles rather than reusing English everywhere", () => {
    expect(translations.de.agent_intent_title_create_calendar_event).not.toBe(translations.en.agent_intent_title_create_calendar_event);
    expect(translations.fa.agent_intent_title_create_calendar_event).not.toBe(translations.en.agent_intent_title_create_calendar_event);
    expect(translations.de.agent_intent_title_update_calendar_event).not.toBe(translations.en.agent_intent_title_update_calendar_event);
    expect(translations.fa.agent_intent_title_update_calendar_event).not.toBe(translations.en.agent_intent_title_update_calendar_event);
  });

  it("the calendar preview labels are distinct from the existing task preview labels (no key collisions)", () => {
    expect(translations.en.agent_intent_preview_start).not.toBe(translations.en.agent_intent_preview_due);
    expect(translations.en.agent_intent_preview_end).not.toBe(translations.en.agent_intent_preview_due);
  });
});
