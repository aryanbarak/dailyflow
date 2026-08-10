import { describe, expect, it } from "vitest";
import { translations } from "@/i18n";
import { documentMemoryExtractionErrorMessage } from "./documentMemoryExtractionPresentation";

describe("documentMemoryExtractionErrorMessage", () => {
  const en = (key: keyof typeof translations.en) => translations.en[key];
  const de = (key: keyof typeof translations.de) => translations.de[key];
  const fa = (key: keyof typeof translations.fa) => translations.fa[key];

  it("resolves each taxonomy code to its own distinct EN message", () => {
    expect(documentMemoryExtractionErrorMessage("PROVIDER_REQUEST_REJECTED", "raw", en)).toBe(translations.en.doc_memory_error_provider_request_rejected);
    expect(documentMemoryExtractionErrorMessage("PROVIDER_UNAVAILABLE", "raw", en)).toBe(translations.en.doc_memory_error_provider_unavailable);
    expect(documentMemoryExtractionErrorMessage("MODEL_OUTPUT_UNUSABLE", "raw", en)).toBe(translations.en.doc_memory_error_model_output_unusable);
    expect(documentMemoryExtractionErrorMessage("NO_SOURCE_MATERIAL", "raw", en)).toBe(translations.en.doc_memory_error_no_source_material);
    expect(documentMemoryExtractionErrorMessage("DOCUMENT_NOT_FOUND", "raw", en)).toBe(translations.en.doc_memory_error_document_not_found);
    expect(documentMemoryExtractionErrorMessage("DOCUMENT_TOO_LARGE", "raw", en)).toBe(translations.en.doc_memory_error_document_too_large);
    expect(documentMemoryExtractionErrorMessage("UNSUPPORTED_DOCUMENT_TYPE", "raw", en)).toBe(translations.en.doc_memory_error_unsupported_document_type);
  });

  it("resolves the German translation", () => {
    expect(documentMemoryExtractionErrorMessage("PROVIDER_UNAVAILABLE", "raw", de)).toBe(translations.de.doc_memory_error_provider_unavailable);
  });

  it("resolves the Farsi translation", () => {
    expect(documentMemoryExtractionErrorMessage("MODEL_OUTPUT_UNUSABLE", "raw", fa)).toBe(translations.fa.doc_memory_error_model_output_unusable);
  });

  it("falls through to the server's own message for a code with no explicit entry (e.g. REQUEST_FAILED)", () => {
    expect(documentMemoryExtractionErrorMessage("REQUEST_FAILED", "some server message", en)).toBe("some server message");
  });
});
