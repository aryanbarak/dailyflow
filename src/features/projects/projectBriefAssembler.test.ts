import { describe, expect, it } from "vitest";
import { buildProjectBriefFromSnapshot } from "./projectBriefAssembler";
import type { EvidenceSnapshot, EvidenceSnapshotItem } from "./evidenceSnapshotTypes";

const PROJECT = { id: "project-1", name: "SmartFlow" };

function snapshotItem(overrides: Partial<EvidenceSnapshotItem> = {}): EvidenceSnapshotItem {
  const textContent = (overrides.textContent as string | undefined) ?? "## Completed Milestones\n\n- Default Item\n";
  return {
    evidenceId: "evidence-1",
    sourceKind: "project_status_document",
    classification: "canonical_document_observation",
    title: "PROJECT_STATUS.md",
    reference: "PROJECT_STATUS.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    contentHash: "a".repeat(64),
    textContent,
    mimeType: "text/markdown",
    byteLength: new TextEncoder().encode(textContent).length,
    ...overrides,
  };
}

function snapshot(items: EvidenceSnapshotItem[]): EvidenceSnapshot {
  return {
    schemaVersion: "evidence-snapshot-v1",
    projectId: PROJECT.id,
    ownerId: "user-1",
    projectRecordVersion: 1,
    snapshotCreatedAt: "2026-08-03T00:00:00.000Z",
    items,
    excludedSupersededEvidenceIds: [],
    snapshotHash: "b".repeat(64),
  };
}

const PROJECT_STATUS_TEXT = `## 2. Current Project Phase

Current phase: Slice 9, in progress.

## 3. Completed Milestones

- Context Rebuild Foundation
`;

describe("buildProjectBriefFromSnapshot -- contract", () => {
  it("builds a valid brief from a single supported evidence item", () => {
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([snapshotItem({ textContent: PROJECT_STATUS_TEXT })]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.briefVersion).toBe("project-brief-v1");
    expect(result.brief.project).toEqual(PROJECT);
    expect(result.brief.currentPhase).toEqual({ status: "known", value: "Slice 9, in progress.", provenance: expect.any(Object) });
    expect(result.brief.completedMilestones).toHaveLength(1);
  });

  it("is deterministic: identical input produces an identical brief", () => {
    const s = snapshot([snapshotItem({ textContent: PROJECT_STATUS_TEXT })]);
    const first = buildProjectBriefFromSnapshot(PROJECT, s, "2026-08-03T00:00:01.000Z");
    const second = buildProjectBriefFromSnapshot(PROJECT, s, "2026-08-03T00:00:01.000Z");
    expect(first.valid && second.valid).toBe(true);
    if (!first.valid || !second.valid) return;
    expect(first.brief).toEqual(second.brief);
  });

  it("returns a deep-frozen brief without freezing the caller-owned project input", () => {
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([snapshotItem({ textContent: PROJECT_STATUS_TEXT })]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.isFrozen(result.brief)).toBe(true);
    expect(Object.isFrozen(result.brief.completedMilestones)).toBe(true);
    expect(Object.isFrozen(PROJECT)).toBe(false);
  });

  it("every extracted item carries complete source evidence provenance", () => {
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([snapshotItem({ textContent: PROJECT_STATUS_TEXT })]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    for (const item of result.brief.completedMilestones) {
      expect(item.provenance.sourceEvidenceId).toBeTruthy();
      expect(item.provenance.sourceReference).toBeTruthy();
      expect(item.provenance.sourceKind).toBeTruthy();
    }
  });

  it("fails closed with NO_SUPPORTED_CONTENT when no evidence item produces any extractable content", () => {
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(false);
    if (result.valid === true) return;
    expect(result.errors[0].code).toBe("NO_SUPPORTED_CONTENT");
  });

  it("does not fabricate a field that cannot be deterministically supported: currentFocus stays unknown when no source declares it", () => {
    const doc = "## 3. Completed Milestones\n\n- Something\n";
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([snapshotItem({ textContent: doc })]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.currentFocus).toEqual({ status: "unknown" });
  });
});

describe("buildProjectBriefFromSnapshot -- unsupported source kinds", () => {
  it("ignores an unsupported source kind with a typed warning, never a thrown exception", () => {
    const items = [
      snapshotItem({ textContent: PROJECT_STATUS_TEXT }),
      snapshotItem({ evidenceId: "ev-2", sourceKind: "verified_repository_state", reference: "gh:owner/repo", textContent: "irrelevant" }),
    ];
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot(items), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.extractionWarnings).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_SOURCE_KIND", sourceEvidenceId: "ev-2" }),
    );
    expect(result.brief.sourceReferences.some((r) => r.sourceEvidenceId === "ev-2")).toBe(false);
  });

  it("ignores repository_document by default, per this slice's explicit unsupported-by-default rule", () => {
    const items = [snapshotItem({ sourceKind: "repository_document", reference: "README.md", textContent: "## Anything\n\n- x\n" })];
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot(items), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(false);
    if (result.valid === true) return;
    expect(result.errors[0].code).toBe("NO_SUPPORTED_CONTENT");
  });
});

describe("buildProjectBriefFromSnapshot -- ordering", () => {
  it("orders items deterministically, independent of the snapshot's own item array order", () => {
    const docB = "## 3. Completed Milestones\n\n- Zeta\n";
    const docA = "## 3. Completed Milestones\n\n- Alpha\n";
    const itemA = snapshotItem({ evidenceId: "ev-a", reference: "PROJECT_STATUS_A.md", textContent: docA });
    const itemB = snapshotItem({ evidenceId: "ev-b", reference: "PROJECT_STATUS_B.md", textContent: docB });

    const forward = buildProjectBriefFromSnapshot(PROJECT, snapshot([itemA, itemB]), "2026-08-03T00:00:01.000Z");
    const reversed = buildProjectBriefFromSnapshot(PROJECT, snapshot([itemB, itemA]), "2026-08-03T00:00:01.000Z");
    expect(forward.valid && reversed.valid).toBe(true);
    if (!forward.valid || !reversed.valid) return;
    expect(forward.brief.completedMilestones.map((m) => m.text)).toEqual(reversed.brief.completedMilestones.map((m) => m.text));
  });
});

describe("buildProjectBriefFromSnapshot -- single-value conflicts", () => {
  it("marks currentPhase as conflicted when two evidence items declare different values, preserving both", () => {
    const itemA = snapshotItem({
      evidenceId: "ev-a",
      reference: "PROJECT_STATUS_A.md",
      textContent: "## 2. Current Project Phase\n\nCurrent phase: Slice 9.\n",
    });
    const itemB = snapshotItem({
      evidenceId: "ev-b",
      reference: "PROJECT_STATUS_B.md",
      textContent: "## 2. Current Project Phase\n\nCurrent phase: Slice 10.\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([itemA, itemB]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.currentPhase.status).toBe("conflicted");
    if (result.brief.currentPhase.status !== "conflicted") return;
    expect(result.brief.currentPhase.candidates.map((c) => c.value).sort()).toEqual(["Slice 10.", "Slice 9."]);
  });

  it("does not treat identical verbatim restatements from two sources as a conflict", () => {
    const itemA = snapshotItem({
      evidenceId: "ev-a",
      reference: "PROJECT_STATUS_A.md",
      textContent: "## 2. Current Project Phase\n\nCurrent phase: Slice 9.\n",
    });
    const itemB = snapshotItem({
      evidenceId: "ev-b",
      reference: "PROJECT_STATUS_B.md",
      textContent: "## 2. Current Project Phase\n\nCurrent phase: Slice 9.\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([itemA, itemB]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.currentPhase).toEqual({ status: "known", value: "Slice 9.", provenance: expect.any(Object) });
  });

  it("resolves a currentFocus conflict between a project_status_document and a roadmap_document source", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 10. Next Sprint\n\nCurrent next milestone: A.\n",
    });
    const roadmapItem = snapshotItem({
      evidenceId: "ev-roadmap",
      sourceKind: "roadmap_document",
      reference: "roadmap.md",
      textContent: "## Milestones\n\n- **M2 [in progress]:** B.\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem, roadmapItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.currentFocus.status).toBe("conflicted");
  });
});

describe("buildProjectBriefFromSnapshot -- milestone vs. deferred/out-of-scope conflict", () => {
  it("marks a milestone conflicted when a roadmap source lists the exact same item as deferred", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 3. Completed Milestones\n\n- Smart Automation\n",
    });
    const roadmapItem = snapshotItem({
      evidenceId: "ev-roadmap",
      sourceKind: "roadmap_document",
      reference: "roadmap.md",
      textContent: "## Explicitly Deferred\n\n- Smart Automation\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem, roadmapItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const milestone = result.brief.completedMilestones.find((m) => m.text === "Smart Automation");
    expect(milestone?.conflictedWith).toHaveLength(1);
    expect(result.brief.extractionWarnings.some((w) => w.code === "CONFLICTING_CANONICAL_STATEMENT")).toBe(true);
  });

  it("marks a milestone conflicted when an architecture source lists the exact same item as out of scope", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 3. Completed Milestones\n\n- GitHub write expansion\n",
    });
    const archItem = snapshotItem({
      evidenceId: "ev-arch",
      sourceKind: "architecture_document",
      reference: "docs/architecture/project-domain.md",
      textContent: "## Out of Scope\n\n- GitHub write expansion\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem, archItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const milestone = result.brief.completedMilestones.find((m) => m.text === "GitHub write expansion");
    expect(milestone?.conflictedWith).toHaveLength(1);
  });

  it("does not mark unrelated milestones and technical debt as conflicting", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 3. Completed Milestones\n\n- Widget A\n\n## 9. Technical Debt\n\n- Widget B needs polish.\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.completedMilestones[0].conflictedWith).toBeUndefined();
  });

  it("BLOCKER 2 regression: a non-goal is not automatically a conflict with a same-named completed milestone", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 3. Completed Milestones\n\n- Learning Project type\n",
    });
    const archItem = snapshotItem({
      evidenceId: "ev-arch",
      sourceKind: "architecture_document",
      reference: "docs/architecture/project-domain.md",
      textContent: "## Non-Goals\n\n- Learning Project type\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem, archItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const milestone = result.brief.completedMilestones.find((m) => m.text === "Learning Project type");
    expect(milestone?.conflictedWith).toBeUndefined();
    expect(result.brief.extractionWarnings.some((w) => w.code === "CONFLICTING_CANONICAL_STATEMENT")).toBe(false);
  });

  it("BLOCKER 2 regression: a technical-debt item is not automatically a conflict with a same-named completed milestone", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 3. Completed Milestones\n\n- Error tracking\n\n## 9. Technical Debt\n\n- Error tracking\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const milestone = result.brief.completedMilestones.find((m) => m.text === "Error tracking");
    expect(milestone?.conflictedWith).toBeUndefined();
  });

  it("BLOCKER 2 regression: an explicit limitation is not automatically a conflict with a same-named completed milestone", () => {
    const statusItem = snapshotItem({
      evidenceId: "ev-status",
      reference: "PROJECT_STATUS.md",
      textContent: "## 3. Completed Milestones\n\n- Offline mode\n\n## Limitations\n\n- Offline mode\n",
    });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([statusItem]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const milestone = result.brief.completedMilestones.find((m) => m.text === "Offline mode");
    expect(milestone?.conflictedWith).toBeUndefined();
  });
});

describe("buildProjectBriefFromSnapshot -- decisionConsequences", () => {
  it("BLOCKER 1 regression: an ADR's Consequences are exposed on their own field, never merged into explicitNextActions, and a consequence is never automatically a conflict with a next action", () => {
    const adrDoc = `# ADR-0200: Example Decision

- **Status:** Accepted
- **Supersedes:** None
- **Superseded by:** None

## Consequences

- No object storage is authorized by this ADR.
- Next action: update the migration script.
`;
    const item = snapshotItem({ sourceKind: "adr", reference: "docs/decisions/adr/ADR-0200.md", textContent: adrDoc });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([item]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Deterministic sort order (both bullets share identical provenance,
    // so the text tie-breaker applies) -- not source document order.
    expect(result.brief.decisionConsequences.map((c) => c.text).slice().sort()).toEqual(
      ["No object storage is authorized by this ADR.", "Next action: update the migration script."].sort(),
    );
    expect(result.brief.explicitNextActions.map((a) => a.text)).toEqual(["update the migration script."]);
    // The boundary statement never leaks into explicitNextActions.
    expect(result.brief.explicitNextActions.some((a) => a.text.includes("object storage"))).toBe(false);
    // No conflict is invented between a consequence and a next action.
    expect(result.brief.extractionWarnings.some((w) => w.code === "CONFLICTING_CANONICAL_STATEMENT")).toBe(false);
  });
});

describe("buildProjectBriefFromSnapshot -- honesty", () => {
  it("never generates a next action that was not literally labeled in a supported source", () => {
    const doc = "## 10. Next Sprint\n\nCurrent next milestone: X.\n\n- This bullet has no label and must not become a next action.\n";
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([snapshotItem({ textContent: doc })]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.explicitNextActions).toEqual([]);
  });

  it("never infers a risk from technical debt", () => {
    const doc = "## 9. Technical Debt\n\n- Something is not centralized yet.\n";
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([snapshotItem({ textContent: doc })]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.brief.knownRisks).toEqual([]);
    expect(result.brief.technicalDebt).toHaveLength(1);
    expect(result.brief.limitations).toEqual([]);
  });

  it("never converts an ADR non-goal into a decision or a next action", () => {
    const adrDoc = `# ADR-0099: Example\n\n- **Status:** Accepted\n- **Supersedes:** None\n- **Superseded by:** None\n\n## Non-Goals\n\nThis ADR does not authorize any code change.\n`;
    const item = snapshotItem({ sourceKind: "adr", reference: "docs/decisions/adr/ADR-0099.md", textContent: adrDoc });
    const result = buildProjectBriefFromSnapshot(PROJECT, snapshot([item]), "2026-08-03T00:00:01.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const allText = JSON.stringify(result.brief);
    expect(allText).not.toMatch(/authorize any code change/);
  });
});
