// SmartFlow -- Document-Sourced Memory, slice 1 (task 16). Per-code,
// localized (EN/DE/FA via useT/@/i18n) messages for the combined "Extract
// to personal memory" action, which sequences documentMemoryExtractionTriggerClient's
// triggerDocumentMemoryChunking and personalMemoryExtractionTriggerClient's
// triggerPersonalMemoryExtraction -- whichever step fails, its code is
// looked up here. Mirrors InferredContextSection.tsx's
// DERIVATION_ERROR_MESSAGE_KEYS pattern (task R-3).

import type { TranslationKey } from "@/i18n";

const DOCUMENT_MEMORY_ERROR_MESSAGE_KEYS: Record<string, TranslationKey> = {
  UNAUTHENTICATED: "doc_memory_error_unauthenticated",
  CONFIGURATION_MISSING: "doc_memory_error_configuration_missing",
  NETWORK_UNREACHABLE: "doc_memory_error_network_unreachable",
  NO_SOURCE_MATERIAL: "doc_memory_error_no_source_material",
  DOCUMENT_NOT_FOUND: "doc_memory_error_document_not_found",
  DOCUMENT_TOO_LARGE: "doc_memory_error_document_too_large",
  UNSUPPORTED_DOCUMENT_TYPE: "doc_memory_error_unsupported_document_type",
  PROVIDER_REQUEST_REJECTED: "doc_memory_error_provider_request_rejected",
  PROVIDER_UNAVAILABLE: "doc_memory_error_provider_unavailable",
  MODEL_OUTPUT_UNUSABLE: "doc_memory_error_model_output_unusable",
};

/** `code`/`message` come from either trigger client's failure result -- REQUEST_FAILED (and any other code with no explicit entry) falls through to the server's own message, exactly like InferredContextSection.tsx's identical fallback. */
export function documentMemoryExtractionErrorMessage(code: string, message: string, t: (key: TranslationKey) => string): string {
  const key = DOCUMENT_MEMORY_ERROR_MESSAGE_KEYS[code];
  return key ? t(key) : message;
}
