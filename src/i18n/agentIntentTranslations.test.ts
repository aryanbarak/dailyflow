import { describe, expect, it } from "vitest";
import { translations, type Lang, type TranslationKey } from "./index";

const LANGUAGES: Lang[] = ["en", "de", "fa"];

const NEW_AGENT_INTENT_KEYS: TranslationKey[] = [
  "agent_intent_title_create_task",
  "agent_intent_title_update_task",
  "agent_intent_create_description",
  "agent_intent_task_update_description",
  "agent_intent_create_approval_reason",
  "agent_intent_task_update_approval_reason",
  "agent_intent_preview_title",
  "agent_intent_preview_due",
  "agent_intent_preview_notes",
  "agent_intent_preview_none",
];

describe("agent intent translations", () => {
  it.each(LANGUAGES)("resolves new create/update task keys in %s", language => {
    for (const key of NEW_AGENT_INTENT_KEYS) {
      expect(translations[language][key], `${language}.${key}`).toBeTruthy();
      expect(translations[language][key], `${language}.${key}`).not.toBe(key);
    }
  });

  it("localizes the visible create/update titles rather than reusing English everywhere", () => {
    expect(translations.de.agent_intent_title_create_task).not.toBe(translations.en.agent_intent_title_create_task);
    expect(translations.fa.agent_intent_title_create_task).not.toBe(translations.en.agent_intent_title_create_task);
    expect(translations.de.agent_intent_title_update_task).not.toBe(translations.en.agent_intent_title_update_task);
    expect(translations.fa.agent_intent_title_update_task).not.toBe(translations.en.agent_intent_title_update_task);
  });
});
