import { describe, expect, it } from "vitest";
import { extractProjectStatusDocument } from "./projectBriefProjectStatusExtractor";
import type { ProjectBriefExtractorInput } from "./projectBriefExtractorTypes";

function input(textContent: string, overrides: Partial<ProjectBriefExtractorInput> = {}): ProjectBriefExtractorInput {
  return {
    evidenceId: "evidence-1",
    sourceReference: "PROJECT_STATUS.md",
    sourceKind: "project_status_document",
    textContent,
    ...overrides,
  };
}

const REALISTIC_DOC = `# SmartFlow - Project Status

## 2. Current Project Phase

Current phase: Slice 9 -- Project Brief Foundation, building on the completed Context Rebuild Foundation.

## 3. Completed Milestones

- ProjectRecord Foundation
- ProjectEvidence Foundation
- Context Rebuild Foundation

## 9. Technical Debt

- Write execution is intentionally narrow.
- Conversation memory is not yet implemented.

## 10. Next Sprint

Current next milestone: independent review of Project Brief Foundation.

- Next action: run the targeted test suite.
- Next action: update PROJECT_STATUS.md.
- Recommended selection criteria (not a next action).
`;

describe("extractProjectStatusDocument", () => {
  it("extracts current phase, current focus, completed milestones, next actions, and limitations from a realistic document", () => {
    const { facts, warnings } = extractProjectStatusDocument(input(REALISTIC_DOC));
    expect(facts.currentPhase?.text).toBe("Slice 9 -- Project Brief Foundation, building on the completed Context Rebuild Foundation.");
    expect(facts.currentFocus?.text).toBe("independent review of Project Brief Foundation.");
    expect(facts.completedMilestones.map((m) => m.text)).toEqual([
      "ProjectRecord Foundation",
      "ProjectEvidence Foundation",
      "Context Rebuild Foundation",
    ]);
    expect(facts.explicitNextActions.map((a) => a.text)).toEqual(["run the targeted test suite.", "update PROJECT_STATUS.md."]);
    expect(facts.technicalDebt.map((l) => l.text)).toEqual([
      "Write execution is intentionally narrow.",
      "Conversation memory is not yet implemented.",
    ]);
    expect(facts.limitations).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("attaches complete provenance to every extracted item", () => {
    const { facts } = extractProjectStatusDocument(input(REALISTIC_DOC, { evidenceId: "ev-99", sourceReference: "docs/PROJECT_STATUS.md" }));
    expect(facts.currentPhase?.provenance).toEqual({
      sourceEvidenceId: "ev-99",
      sourceReference: "docs/PROJECT_STATUS.md",
      sourceKind: "project_status_document",
      sectionHeading: "2. Current Project Phase",
      lineOffset: expect.any(Number),
    });
    expect(facts.completedMilestones[0].provenance.sectionHeading).toBe("3. Completed Milestones");
  });

  it("does not infer current focus from the newest bullet, document order, or any unlabeled statement", () => {
    const doc = "## Next Sprint\n\nSome free-form prose about what's next, with no explicit label at all.\n";
    const { facts } = extractProjectStatusDocument(input(doc));
    expect(facts.currentFocus).toBeUndefined();
  });

  it("reports a whole-document UNSUPPORTED_DOCUMENT_SHAPE warning when no recognized heading is present", () => {
    const { facts, warnings } = extractProjectStatusDocument(input("# Some Other Document\n\nJust prose, no recognized sections.\n"));
    expect(facts.completedMilestones).toEqual([]);
    expect(warnings).toEqual([{ code: "UNSUPPORTED_DOCUMENT_SHAPE", message: expect.any(String), sourceEvidenceId: "evidence-1", sourceReference: "PROJECT_STATUS.md" }]);
  });

  it("reports MISSING_EXPECTED_SECTION for a heading that is entirely absent, while still extracting what is present", () => {
    const doc = "## 3. Completed Milestones\n\n- One\n";
    const { facts, warnings } = extractProjectStatusDocument(input(doc));
    expect(facts.completedMilestones.map((m) => m.text)).toEqual(["One"]);
    expect(warnings.filter((w) => w.code === "MISSING_EXPECTED_SECTION")).toHaveLength(3);
  });

  it("reports a malformed-shape warning when a known heading is present but its expected label is missing", () => {
    const doc = "## Current Project Phase\n\nNo literal label here, just prose.\n";
    const { facts, warnings } = extractProjectStatusDocument(input(doc));
    expect(facts.currentPhase).toBeUndefined();
    expect(warnings.some((w) => w.code === "UNSUPPORTED_DOCUMENT_SHAPE" && w.sectionHeading === "Current Project Phase")).toBe(true);
  });

  it("reports DUPLICATE_HEADING and uses only the first occurrence when a heading repeats", () => {
    const doc = "## Completed Milestones\n\n- First\n\n## Completed Milestones\n\n- Second\n";
    const { facts, warnings } = extractProjectStatusDocument(input(doc));
    expect(facts.completedMilestones.map((m) => m.text)).toEqual(["First"]);
    expect(warnings.some((w) => w.code === "DUPLICATE_HEADING")).toBe(true);
  });

  it("never fabricates technical debt from milestones, or milestones from technical debt -- each stays under its own heading only", () => {
    const doc = "## Completed Milestones\n\n- Widget A\n\n## Technical Debt\n\n- Widget B is unfinished.\n";
    const { facts } = extractProjectStatusDocument(input(doc));
    expect(facts.completedMilestones.map((m) => m.text)).toEqual(["Widget A"]);
    expect(facts.technicalDebt.map((l) => l.text)).toEqual(["Widget B is unfinished."]);
  });

  it("only populates limitations from an explicit 'Limitations' heading, never from Technical Debt", () => {
    const doc = "## Technical Debt\n\n- Something incomplete.\n\n## Limitations\n\n- Explicitly labeled limitation.\n";
    const { facts } = extractProjectStatusDocument(input(doc));
    expect(facts.technicalDebt.map((t) => t.text)).toEqual(["Something incomplete."]);
    expect(facts.limitations.map((l) => l.text)).toEqual(["Explicitly labeled limitation."]);
  });
});
