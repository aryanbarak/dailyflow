import { describe, expect, it } from "vitest";
import { extractAdrDocument } from "./projectBriefAdrExtractor";
import type { ProjectBriefExtractorInput } from "./projectBriefExtractorTypes";

function input(textContent: string, overrides: Partial<ProjectBriefExtractorInput> = {}): ProjectBriefExtractorInput {
  return {
    evidenceId: "evidence-1",
    sourceReference: "docs/decisions/adr/ADR-0007-example.md",
    sourceKind: "adr",
    textContent,
    ...overrides,
  };
}

const ACCEPTED_ADR = `# ADR-0007: ProjectEvidence Observation Model

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision Makers:** Product Owner
- **Supersedes:** None
- **Superseded by:** None

## Context

Some context prose.

## Decision

Some decision prose.

## Consequences

- The next slice may proceed without further sign-off.
- The old fingerprint semantics must be corrected.

## Deferred Decisions

- Structured JSON payload.
- Object storage.

## Non-Goals

This ADR does not redesign anything.
`;

describe("extractAdrDocument", () => {
  it("extracts title, accepted decision, consequences, and deferred decisions from an accepted ADR", () => {
    const { facts, warnings } = extractAdrDocument(input(ACCEPTED_ADR));
    expect(facts.title).toBe("ADR-0007: ProjectEvidence Observation Model");
    expect(facts.status).toBe("Accepted");
    expect(facts.acceptedDecision?.text).toBe("ADR-0007: ProjectEvidence Observation Model");
    expect(facts.consequences.map((c) => c.text)).toEqual([
      "The next slice may proceed without further sign-off.",
      "The old fingerprint semantics must be corrected.",
    ]);
    expect(facts.deferredDecisions.map((d) => d.text)).toEqual(["Structured JSON payload.", "Object storage."]);
    // Neither Consequences bullet carries the literal "Next action:" label
    // -- section membership under Consequences never promotes a bullet
    // into an action.
    expect(facts.nextActions).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("BLOCKER 1 regression: a boundary/scope statement under Consequences is preserved as a consequence but is never an explicit next action", () => {
    const doc = `# ADR-0100: Boundary Example

- **Status:** Accepted
- **Supersedes:** None
- **Superseded by:** None

## Consequences

- No object storage, binary adapter, or Context Rebuild implementation is authorized by this ADR.
`;
    const { facts } = extractAdrDocument(input(doc));
    expect(facts.consequences.map((c) => c.text)).toEqual([
      "No object storage, binary adapter, or Context Rebuild implementation is authorized by this ADR.",
    ]);
    expect(facts.nextActions).toEqual([]);
  });

  it("BLOCKER 1 regression: a Consequences bullet carrying the literal 'Next action:' label is extracted as a next action, and also preserved verbatim as a consequence", () => {
    const doc = `# ADR-0101: Action Example

- **Status:** Accepted
- **Supersedes:** None
- **Superseded by:** None

## Consequences

- Next action: correct the candidate-fingerprint semantics before the next release.
- No further Product Owner sign-off is required for this narrow question.
`;
    const { facts } = extractAdrDocument(input(doc));
    expect(facts.nextActions.map((a) => a.text)).toEqual(["correct the candidate-fingerprint semantics before the next release."]);
    // Preserved with provenance, verbatim (label still attached), in
    // consequences too -- extraction into nextActions never removes it
    // from consequences.
    expect(facts.consequences.map((c) => c.text)).toEqual([
      "Next action: correct the candidate-fingerprint semantics before the next release.",
      "No further Product Owner sign-off is required for this narrow question.",
    ]);
    expect(facts.nextActions[0].provenance).toEqual({
      sourceEvidenceId: "evidence-1",
      sourceReference: "docs/decisions/adr/ADR-0007-example.md",
      sourceKind: "adr",
      sectionHeading: "Consequences",
      lineOffset: expect.any(Number),
    });
  });

  it("BLOCKER 1 regression: Consequences remain preserved with provenance regardless of next-action content", () => {
    const { facts } = extractAdrDocument(input(ACCEPTED_ADR, { evidenceId: "adr-7" }));
    for (const consequence of facts.consequences) {
      expect(consequence.provenance).toEqual({
        sourceEvidenceId: "adr-7",
        sourceReference: "docs/decisions/adr/ADR-0007-example.md",
        sourceKind: "adr",
        sectionHeading: "Consequences",
        lineOffset: expect.any(Number),
      });
    }
  });

  it("BLOCKER 1 regression: accepted ADR status alone does not imply any action -- an accepted ADR with no Consequences section produces zero next actions and zero consequences", () => {
    const doc = `# ADR-0102: No Consequences Section

- **Status:** Accepted
- **Supersedes:** None
- **Superseded by:** None

## Context

Some context prose only -- no Consequences section at all.
`;
    const { facts } = extractAdrDocument(input(doc));
    expect(facts.status).toBe("Accepted");
    expect(facts.acceptedDecision).toBeDefined();
    expect(facts.consequences).toEqual([]);
    expect(facts.nextActions).toEqual([]);
  });

  it("attaches complete provenance to the accepted decision", () => {
    const { facts } = extractAdrDocument(input(ACCEPTED_ADR, { evidenceId: "adr-7" }));
    expect(facts.acceptedDecision?.provenance).toEqual({
      sourceEvidenceId: "adr-7",
      sourceReference: "docs/decisions/adr/ADR-0007-example.md",
      sourceKind: "adr",
      sectionHeading: "ADR-0007: ProjectEvidence Observation Model",
      lineOffset: 0,
    });
  });

  it("does not contribute a decision for a non-accepted ADR, and reports ADR_NOT_ACCEPTED", () => {
    const doc = `# ADR-0099: Proposed Idea\n\n- **Status:** Proposed\n- **Supersedes:** None\n- **Superseded by:** None\n\n## Consequences\n\n- Should not appear.\n`;
    const { facts, warnings } = extractAdrDocument(input(doc));
    expect(facts.acceptedDecision).toBeUndefined();
    expect(facts.consequences).toEqual([]);
    expect(warnings).toEqual([
      { code: "ADR_NOT_ACCEPTED", message: expect.any(String), sourceEvidenceId: "evidence-1", sourceReference: "docs/decisions/adr/ADR-0007-example.md" },
    ]);
  });

  it("honors an explicit Superseded-by declaration: no decision contributed, ADR_SUPERSEDED reported", () => {
    const doc = `# ADR-0003: Old Decision\n\n- **Status:** Accepted\n- **Supersedes:** None\n- **Superseded by:** ADR-0007\n\n## Consequences\n\n- Should not appear.\n`;
    const { facts, warnings } = extractAdrDocument(input(doc));
    expect(facts.acceptedDecision).toBeUndefined();
    expect(facts.supersededBy).toBe("ADR-0007");
    expect(warnings.some((w) => w.code === "ADR_SUPERSEDED")).toBe(true);
  });

  it("reports MALFORMED_ADR_METADATA and contributes nothing when the Status line is missing", () => {
    const doc = `# ADR-0050: No Status\n\n- **Supersedes:** None\n\n## Consequences\n\n- Should not appear.\n`;
    const { facts, warnings } = extractAdrDocument(input(doc));
    expect(facts.acceptedDecision).toBeUndefined();
    expect(facts.consequences).toEqual([]);
    expect(warnings).toEqual([
      { code: "MALFORMED_ADR_METADATA", message: expect.any(String), sourceEvidenceId: "evidence-1", sourceReference: "docs/decisions/adr/ADR-0007-example.md" },
    ]);
  });

  it("reports MALFORMED_ADR_METADATA for an unrecognized status value", () => {
    const doc = `# ADR-0051: Weird Status\n\n- **Status:** Withdrawn\n\n## Consequences\n\n- Should not appear.\n`;
    const { facts, warnings } = extractAdrDocument(input(doc));
    expect(facts.acceptedDecision).toBeUndefined();
    expect(warnings.some((w) => w.code === "MALFORMED_ADR_METADATA")).toBe(true);
  });

  it("reports UNSUPPORTED_DOCUMENT_SHAPE when there is no top-level ADR title heading", () => {
    const doc = `## Not A Title\n\nSome prose.\n`;
    const { facts, warnings } = extractAdrDocument(input(doc));
    expect(facts.acceptedDecision).toBeUndefined();
    expect(warnings).toEqual([
      { code: "UNSUPPORTED_DOCUMENT_SHAPE", message: expect.any(String), sourceEvidenceId: "evidence-1", sourceReference: "docs/decisions/adr/ADR-0007-example.md" },
    ]);
  });

  it("never interprets the Non-Goals prose section as a decision, consequence, or deferred decision", () => {
    const { facts } = extractAdrDocument(input(ACCEPTED_ADR));
    const allText = [facts.acceptedDecision?.text, ...facts.consequences.map((c) => c.text), ...facts.deferredDecisions.map((d) => d.text)];
    expect(allText.join(" ")).not.toMatch(/redesign/);
  });
});
