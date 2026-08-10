import { describe, expect, it, vi } from "vitest";

const inMock = vi.fn();
const selectMock = vi.fn((_columns: string) => ({ in: inMock }));
const fromMock = vi.fn((_table: string) => ({ select: selectMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fromMock(table) },
}));

import { resolveDocumentChunkSources } from "./documentChunkSourceResolver";

describe("resolveDocumentChunkSources", () => {
  it("returns an empty map without querying when given no ids", async () => {
    const result = await resolveDocumentChunkSources([]);
    expect(result).toEqual({});
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("queries document_chunks by (deduplicated) id and maps rows into a { [id]: { fileName, sectionLabel } } record", async () => {
    inMock.mockResolvedValue({
      data: [
        { id: "chunk-1", file_name: "resume.pdf", section_label: "Experience" },
        { id: "chunk-2", file_name: "resume.pdf", section_label: "Education" },
      ],
      error: null,
    });

    const result = await resolveDocumentChunkSources(["chunk-1", "chunk-2", "chunk-1"]);

    expect(result).toEqual({
      "chunk-1": { fileName: "resume.pdf", sectionLabel: "Experience" },
      "chunk-2": { fileName: "resume.pdf", sectionLabel: "Education" },
    });
    expect(inMock).toHaveBeenCalledWith("id", ["chunk-1", "chunk-2"]);
  });

  it("a chunk id that no longer exists (deleted) is simply absent from the result -- caller falls back to the snapshot", async () => {
    inMock.mockResolvedValue({ data: [{ id: "chunk-1", file_name: "resume.pdf", section_label: "Experience" }], error: null });

    const result = await resolveDocumentChunkSources(["chunk-1", "chunk-deleted"]);

    expect(result["chunk-1"]).toBeDefined();
    expect(result["chunk-deleted"]).toBeUndefined();
  });

  it("throws on a query error", async () => {
    inMock.mockResolvedValue({ data: null, error: new Error("boom") });
    await expect(resolveDocumentChunkSources(["chunk-1"])).rejects.toThrow("boom");
  });
});
