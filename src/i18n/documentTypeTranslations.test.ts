// Task 18, A2: the unified document-type selector's labels must have real
// EN/DE/FA strings, not a silent English fallback -- see
// orbSettingsTranslations.test.ts (task 17h) for the identical pattern
// this file follows.
import { describe, expect, it } from "vitest";
import { translations, type Lang, type TranslationKey } from "./index";

const DOC_TYPE_KEYS: TranslationKey[] = [
  "doc_memory_type_label",
  "doc_memory_type_placeholder",
  "doc_memory_type_resume",
  "doc_memory_type_financial",
  "doc_memory_type_personal",
  "doc_memory_type_business",
];

const LANGS: Lang[] = ["en", "de", "fa"];

describe("document type selector translations (task 18, A2)", () => {
  it.each(LANGS)("%s defines a non-empty string for every document type selector key", (lang) => {
    const dict = translations[lang] as Record<string, string>;
    for (const key of DOC_TYPE_KEYS) {
      expect(dict[key], `${lang}.${key}`).toBeTruthy();
      expect(typeof dict[key]).toBe("string");
    }
  });

  it("DE and FA translations are genuinely localized, not copies of the English string", () => {
    for (const key of DOC_TYPE_KEYS) {
      expect(translations.de[key], `de.${key} vs en`).not.toBe(translations.en[key]);
      expect(translations.fa[key], `fa.${key} vs en`).not.toBe(translations.en[key]);
    }
  });

  it("the old resume-only mark/unmark keys were removed (replaced by the unified type selector), not left dangling", () => {
    const enDict = translations.en as Record<string, string>;
    expect(enDict.doc_memory_mark_resume).toBeUndefined();
    expect(enDict.doc_memory_unmark_resume).toBeUndefined();
  });

  it("doc_memory_extract_action reads \"Add to personal memory\" (or its localization), not the old \"Extract to personal memory\" wording", () => {
    expect(translations.en.doc_memory_extract_action).toBe("Add to personal memory");
  });
});
