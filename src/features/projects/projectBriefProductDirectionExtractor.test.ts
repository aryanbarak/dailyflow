import { describe, expect, it } from "vitest";
import { extractProductDirectionDocument } from "./projectBriefProductDirectionExtractor";
import type { ProjectBriefExtractorInput } from "./projectBriefExtractorTypes";

function input(textContent: string, overrides: Partial<ProjectBriefExtractorInput> = {}): ProjectBriefExtractorInput {
  return {
    evidenceId: "evidence-1",
    sourceReference: "docs/product/product-direction-v1.md",
    sourceKind: "product_direction_document",
    textContent,
    ...overrides,
  };
}

describe("extractProductDirectionDocument", () => {
  it("extracts explicit non-goals only", () => {
    const doc = "## 8. Explicit Non-Goals\n\n- Not a general-purpose PM tool.\n- Not a chat-first product.\n";
    const { facts, warnings } = extractProductDirectionDocument(input(doc));
    expect(facts.nonGoals.map((n) => n.text)).toEqual(["Not a general-purpose PM tool.", "Not a chat-first product."]);
    expect(warnings).toEqual([]);
  });

  it("does not extract mission or positioning prose -- only the Non-Goals list", () => {
    const doc = "## 2. Product Mission\n\nSmartFlow helps people ship software.\n\n## 8. Explicit Non-Goals\n\n- Not a CRM.\n";
    const { facts } = extractProductDirectionDocument(input(doc));
    expect(facts.nonGoals.map((n) => n.text)).toEqual(["Not a CRM."]);
    expect(JSON.stringify(facts)).not.toMatch(/ship software/);
  });

  it("reports UNSUPPORTED_DOCUMENT_SHAPE when no recognized heading is present", () => {
    const { facts, warnings } = extractProductDirectionDocument(input("# Unrelated\n\nJust prose.\n"));
    expect(facts.nonGoals).toEqual([]);
    expect(warnings.some((w) => w.code === "UNSUPPORTED_DOCUMENT_SHAPE")).toBe(true);
  });
});
