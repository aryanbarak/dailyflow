import { describe, expect, it } from "vitest";
import { extractRoadmapDocument } from "./projectBriefRoadmapExtractor";
import type { ProjectBriefExtractorInput } from "./projectBriefExtractorTypes";

function input(textContent: string, overrides: Partial<ProjectBriefExtractorInput> = {}): ProjectBriefExtractorInput {
  return {
    evidenceId: "evidence-1",
    sourceReference: "docs/roadmap/project-workspace-implementation-roadmap-v1.md",
    sourceKind: "roadmap_document",
    textContent,
    ...overrides,
  };
}

const REALISTIC_DOC = `# Project Workspace -- Implementation Roadmap v1

## 14. Risks

**Technical**

- Introducing "Project" as a new entity is the riskiest slice.
- Reusing an existing engine's pattern requires care.

## 15. Explicitly Deferred

- **EPIC-09 (Agent Autonomy)** -- remains frozen.
- **Provider expansion** -- email, calendar remain future work.

## 16. Milestones

- **M1 -- Project Foundation (Read-Only):** S1, S2, S3.
- **M2 -- Understanding [in progress]:** S4, S5, S6, S7.
- **M3 -- Controlled Action:** S8, S9.

## 19. Out of Scope

- Any database schema or migration design.
- Any visual design decision.
`;

describe("extractRoadmapDocument", () => {
  it("extracts deferred capabilities, out-of-scope items, risks, and the explicit in-progress milestone as current focus", () => {
    const { facts, warnings } = extractRoadmapDocument(input(REALISTIC_DOC));
    expect(facts.deferredItems.map((d) => d.text)).toEqual([
      "**EPIC-09 (Agent Autonomy)** -- remains frozen.",
      "**Provider expansion** -- email, calendar remain future work.",
    ]);
    expect(facts.outOfScope.map((o) => o.text)).toEqual(["Any database schema or migration design.", "Any visual design decision."]);
    expect(facts.risks.map((r) => r.text)).toEqual([
      'Introducing "Project" as a new entity is the riskiest slice.',
      "Reusing an existing engine's pattern requires care.",
    ]);
    expect(facts.currentFocus?.text).toBe("**M2 -- Understanding :** S4, S5, S6, S7.");
    expect(warnings).toEqual([]);
  });

  it("does not infer current focus from milestone position or document order when no marker is present", () => {
    const doc = "## Milestones\n\n- **M1 -- First:** S1.\n- **M2 -- Second:** S2.\n";
    const { facts } = extractRoadmapDocument(input(doc));
    expect(facts.currentFocus).toBeUndefined();
  });

  it("reports a conflict and derives no current focus when more than one milestone is marked in progress", () => {
    const doc = "## Milestones\n\n- **M1 [in progress]:** S1.\n- **M2 [in progress]:** S2.\n";
    const { facts, warnings } = extractRoadmapDocument(input(doc));
    expect(facts.currentFocus).toBeUndefined();
    expect(warnings.some((w) => w.code === "CONFLICTING_CANONICAL_STATEMENT")).toBe(true);
  });

  it("reports UNSUPPORTED_DOCUMENT_SHAPE when no recognized roadmap heading is present", () => {
    const { facts, warnings } = extractRoadmapDocument(input("# Unrelated\n\nJust prose.\n"));
    expect(facts.deferredItems).toEqual([]);
    expect(facts.risks).toEqual([]);
    expect(warnings.some((w) => w.code === "UNSUPPORTED_DOCUMENT_SHAPE")).toBe(true);
  });

  it("never treats a deferred/out-of-scope item as a completed capability", () => {
    const { facts } = extractRoadmapDocument(input(REALISTIC_DOC));
    const deferredText = facts.deferredItems.map((d) => d.text).join(" ");
    expect(deferredText).not.toMatch(/completed/i);
  });
});
