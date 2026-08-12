// Task 19 (Attach file in Flow AI): pure validation for an in-conversation
// attachment. Mirrors useLearnAI.ts's own ACCEPTED_MIME_TYPES/10MB cap ("match
// Learn's limits so nothing regresses for the PO") as an independent copy --
// not imported from src/features/learn-ai, since Learn is untouched and being
// retired in task 21; this is Flow AI's own validation, not a shared
// dependency on the system being replaced.

export const CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
] as const;

export type ChatAttachmentAcceptedMimeType = (typeof CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES)[number];

// Matches Learn's own 10 MB cap (useLearnAI.ts) -- deliberately narrower than
// document-memory-extraction-endpoint.ts's 20MB MAX_SOURCE_FILE_BYTES, which
// governs a different, already-uploaded-and-typed document, not this
// composer's in-line attach affordance.
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type ChatAttachmentRejectionReason = "unsupported_type" | "too_large";

export type ChatAttachmentValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ChatAttachmentRejectionReason };

export function isChatAttachmentAcceptedMimeType(mimeType: string): mimeType is ChatAttachmentAcceptedMimeType {
  return (CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function validateChatAttachment(file: Pick<File, "type" | "size">): ChatAttachmentValidationResult {
  if (!isChatAttachmentAcceptedMimeType(file.type)) {
    return { ok: false, reason: "unsupported_type" };
  }
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}

/** Formats a byte count the same way the chip does -- "123 KB" / "4.2 MB" -- kept alongside the validation it labels. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
