// Task 18 (Document-Sourced Memory slice 2): coverage for the new
// DOCUMENT_TYPES/isSupportedDocumentType exports and the widened
// updateDocumentType, following documentChunkSourceResolver.test.ts's own
// established Supabase-chain-mock pattern.
import { beforeEach, describe, expect, it, vi } from "vitest";

const eqMock = vi.fn();
const updateMock = vi.fn((_patch: Record<string, unknown>) => ({ eq: eqMock }));
const fromMock = vi.fn((_table: string) => ({ update: updateMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fromMock(table) },
}));

import { DOCUMENT_TYPES, isSupportedDocumentType, updateDocumentType, type DocumentType } from "./documentsService";

describe("DOCUMENT_TYPES (task 18)", () => {
  it("is exactly the four types the widened CHECK constraint accepts", () => {
    expect(DOCUMENT_TYPES).toEqual(["resume", "financial", "personal", "business"]);
  });
});

describe("isSupportedDocumentType", () => {
  it.each(DOCUMENT_TYPES)("accepts %s", (type) => {
    expect(isSupportedDocumentType(type)).toBe(true);
  });

  it("rejects null", () => {
    expect(isSupportedDocumentType(null)).toBe(false);
  });

  it("rejects an unrecognized string", () => {
    expect(isSupportedDocumentType("invoice")).toBe(false);
  });
});

describe("updateDocumentType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the document's type column and can clear it back to null", async () => {
    eqMock.mockResolvedValue({ error: null });

    await updateDocumentType("doc-1", "financial");
    expect(fromMock).toHaveBeenCalledWith("documents");
    expect(updateMock).toHaveBeenCalledWith({ type: "financial" });
    expect(eqMock).toHaveBeenCalledWith("id", "doc-1");

    await updateDocumentType("doc-1", null);
    expect(updateMock).toHaveBeenCalledWith({ type: null });
  });

  it("accepts every DOCUMENT_TYPES value (type-level + runtime smoke)", async () => {
    eqMock.mockResolvedValue({ error: null });
    for (const type of DOCUMENT_TYPES) {
      const value: DocumentType = type;
      await updateDocumentType("doc-1", value);
    }
    expect(updateMock).toHaveBeenCalledTimes(DOCUMENT_TYPES.length);
  });

  it("throws on a Supabase error", async () => {
    eqMock.mockResolvedValue({ error: new Error("boom") });
    await expect(updateDocumentType("doc-1", "resume")).rejects.toThrow("boom");
  });
});
