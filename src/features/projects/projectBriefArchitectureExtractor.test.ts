import { describe, expect, it } from "vitest";
import { extractArchitectureDocument } from "./projectBriefArchitectureExtractor";
import type { ProjectBriefExtractorInput } from "./projectBriefExtractorTypes";

function input(textContent: string, overrides: Partial<ProjectBriefExtractorInput> = {}): ProjectBriefExtractorInput {
  return {
    evidenceId: "evidence-1",
    sourceReference: "docs/architecture/project-domain.md",
    sourceKind: "architecture_document",
    textContent,
    ...overrides,
  };
}

const REALISTIC_DOC = `# SmartFlow Project Domain

## 19. Open decisions

- One repository versus multiple repository bindings.
- Durable versus on-demand ProjectEvidence.

## Explicitly Out of Scope

This document does not design or implement:

- database schema or migrations,
- a context rebuild service implementation.
`;

describe("extractArchitectureDocument", () => {
  it("extracts open decisions and out-of-scope items", () => {
    const { facts, warnings } = extractArchitectureDocument(input(REALISTIC_DOC));
    expect(facts.openDecisions.map((d) => d.text)).toEqual([
      "One repository versus multiple repository bindings.",
      "Durable versus on-demand ProjectEvidence.",
    ]);
    expect(facts.outOfScope.map((n) => n.text)).toEqual(["database schema or migrations,", "a context rebuild service implementation."]);
    expect(facts.nonGoals).toEqual([]);
    // This fixture has no "Non-Goals" heading (only "Explicitly Out of
    // Scope", which is a distinct field) -- "Non-Goals" is independently
    // expected once the document is recognized as architecture-shaped at
    // all, so its absence is reported, exactly like any other missing
    // expected section.
    expect(warnings).toEqual([
      { code: "MISSING_EXPECTED_SECTION", message: expect.any(String), sourceEvidenceId: "evidence-1", sourceReference: "docs/architecture/project-domain.md" },
    ]);
  });

  it("keeps 'Non-Goals' and 'Out of Scope' as two distinct fields, never merged", () => {
    const doc = "## Non-Goals\n\n- Learning Project type.\n\n## Out of Scope\n\n- GitHub write expansion.\n";
    const { facts } = extractArchitectureDocument(input(doc));
    expect(facts.nonGoals.map((n) => n.text)).toEqual(["Learning Project type."]);
    expect(facts.outOfScope.map((o) => o.text)).toEqual(["GitHub write expansion."]);
  });

  it("reports UNSUPPORTED_DOCUMENT_SHAPE when no recognized heading is present", () => {
    const { facts, warnings } = extractArchitectureDocument(input("# Unrelated\n\nJust prose.\n"));
    expect(facts.openDecisions).toEqual([]);
    expect(warnings.some((w) => w.code === "UNSUPPORTED_DOCUMENT_SHAPE")).toBe(true);
  });

  it("never converts an out-of-scope item into an open decision", () => {
    const { facts } = extractArchitectureDocument(input(REALISTIC_DOC));
    const openDecisionText = facts.openDecisions.map((d) => d.text).join(" ");
    expect(openDecisionText).not.toMatch(/schema or migrations/);
  });

  it("only populates limitations from an explicit 'Limitations' heading, never from Out of Scope or Non-Goals", () => {
    const doc = "## Out of Scope\n\n- X.\n\n## Limitations\n\n- Explicitly labeled limitation.\n";
    const { facts } = extractArchitectureDocument(input(doc));
    expect(facts.outOfScope.map((o) => o.text)).toEqual(["X."]);
    expect(facts.limitations.map((l) => l.text)).toEqual(["Explicitly labeled limitation."]);
  });

  it("attaches complete provenance", () => {
    const { facts } = extractArchitectureDocument(input(REALISTIC_DOC, { evidenceId: "arch-1" }));
    expect(facts.openDecisions[0].provenance).toEqual({
      sourceEvidenceId: "arch-1",
      sourceReference: "docs/architecture/project-domain.md",
      sourceKind: "architecture_document",
      sectionHeading: "19. Open decisions",
      lineOffset: expect.any(Number),
    });
  });
});
