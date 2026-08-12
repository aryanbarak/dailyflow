import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES,
  CHAT_ATTACHMENT_MAX_BYTES,
  formatAttachmentSize,
  isChatAttachmentAcceptedMimeType,
  validateChatAttachment,
} from "./chatAttachmentValidation";

function fakeFile(type: string, size: number) {
  return { type, size };
}

describe("validateChatAttachment (task 19)", () => {
  it.each(CHAT_ATTACHMENT_ACCEPTED_MIME_TYPES)("accepts %s under the size cap", (mimeType) => {
    expect(validateChatAttachment(fakeFile(mimeType, 1024))).toEqual({ ok: true });
  });

  it("rejects an unsupported mime type", () => {
    expect(validateChatAttachment(fakeFile("application/msword", 1024))).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("rejects a file over the 10MB cap -- matches Learn's own limit (useLearnAI.ts), so nothing regresses for the PO", () => {
    expect(CHAT_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(validateChatAttachment(fakeFile("application/pdf", CHAT_ATTACHMENT_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("accepts a file exactly AT the size cap (boundary, not off-by-one)", () => {
    expect(validateChatAttachment(fakeFile("application/pdf", CHAT_ATTACHMENT_MAX_BYTES))).toEqual({ ok: true });
  });

  it("an unsupported type is rejected for its type EVEN IF it is also oversized -- type is checked first", () => {
    expect(validateChatAttachment(fakeFile("video/mp4", CHAT_ATTACHMENT_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });
});

describe("isChatAttachmentAcceptedMimeType", () => {
  it("narrows only the exact accepted set", () => {
    expect(isChatAttachmentAcceptedMimeType("application/pdf")).toBe(true);
    expect(isChatAttachmentAcceptedMimeType("text/html")).toBe(false);
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatAttachmentSize(500)).toBe("500 B");
    expect(formatAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
