// SmartFlow -- ADR-0009 dual-implementation equivalence guard.
//
// Review finding F2 (docs/reviews/2026-08-inferred-context-layer-review.md,
// MAJOR #4): agent/worker/context-derivation-endpoint.ts's normalizeCandidate
// cannot import inferredProjectContextFieldValidation.ts (agent/worker is a
// zero-runtime-dependency deployable unit) and therefore duplicates its
// per-kind content rules. The review found the two had drifted: the Worker
// validated since/completedAt/decidedAt as merely a bounded string, while the
// canonical TS validator requires Date.parse success. This file is the
// standing guard against that drift recurring -- it runs the SAME fixture
// set through both validators and asserts identical accept/reject outcomes
// for every InferredProjectContextField kind. A future edit to either
// module's per-kind rules without updating the other fails this test.
//
// Deliberately imports across the agent/worker <-> src/features/projects
// boundary that production code must never cross -- this is a Vitest-only
// test module, never bundled into the Worker's deployed output (Wrangler
// builds only agent/worker/index.ts and its production imports), so it does
// not violate the zero-runtime-dependency constraint it exists to police.

import { describe, expect, it } from "vitest";
import { validateInferredFieldContent } from "./inferredProjectContextFieldValidation";
import { normalizeCandidate } from "../../../agent/worker/context-derivation-endpoint";
import type { InferredContextFieldKind } from "./inferredProjectContextFieldTypes";

const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";
const VALID_EVIDENCE_IDS = new Set([EVIDENCE_ID]);

interface Fixture {
  readonly label: string;
  readonly kind: InferredContextFieldKind;
  readonly content: Record<string, unknown>;
  readonly expectValid: boolean;
}

const FIXTURES: readonly Fixture[] = [
  // objective
  { label: "objective: valid minimal", kind: "objective", content: { summary: "Ship v1", status: "active" }, expectValid: true },
  { label: "objective: valid with since", kind: "objective", content: { summary: "Ship v1", status: "active", since: "2026-01-01T00:00:00.000Z" }, expectValid: true },
  { label: "objective: invalid since (not a parseable timestamp) -- the F2 regression case", kind: "objective", content: { summary: "Ship v1", status: "active", since: "banana" }, expectValid: false },
  { label: "objective: invalid status", kind: "objective", content: { summary: "Ship v1", status: "bogus" }, expectValid: false },
  { label: "objective: missing summary", kind: "objective", content: { status: "active" }, expectValid: false },
  { label: "objective: unknown field", kind: "objective", content: { summary: "Ship v1", status: "active", extra: "nope" }, expectValid: false },

  // milestone
  { label: "milestone: valid minimal", kind: "milestone", content: { title: "Beta launch", status: "planned" }, expectValid: true },
  { label: "milestone: valid with completedAt", kind: "milestone", content: { title: "Beta launch", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" }, expectValid: true },
  { label: "milestone: invalid completedAt (not a parseable timestamp) -- the F2 regression case", kind: "milestone", content: { title: "Beta launch", status: "completed", completedAt: "banana" }, expectValid: false },
  { label: "milestone: invalid order (non-number)", kind: "milestone", content: { title: "Beta launch", status: "planned", order: "first" }, expectValid: false },
  { label: "milestone: invalid status", kind: "milestone", content: { title: "Beta launch", status: "bogus" }, expectValid: false },
  { label: "milestone: missing title", kind: "milestone", content: { status: "planned" }, expectValid: false },

  // decision
  { label: "decision: valid minimal", kind: "decision", content: { title: "Use Postgres", status: "accepted" }, expectValid: true },
  { label: "decision: valid with decidedAt", kind: "decision", content: { title: "Use Postgres", status: "accepted", decidedAt: "2026-01-01T00:00:00.000Z" }, expectValid: true },
  { label: "decision: invalid decidedAt (not a parseable timestamp) -- the F2 regression case", kind: "decision", content: { title: "Use Postgres", status: "accepted", decidedAt: "banana" }, expectValid: false },
  { label: "decision: invalid status", kind: "decision", content: { title: "Use Postgres", status: "bogus" }, expectValid: false },

  // risk
  { label: "risk: valid minimal", kind: "risk", content: { summary: "Data loss risk", severity: "high" }, expectValid: true },
  { label: "risk: valid with notes", kind: "risk", content: { summary: "Data loss risk", severity: "high", notes: "Backups run nightly." }, expectValid: true },
  { label: "risk: invalid severity", kind: "risk", content: { summary: "Data loss risk", severity: "critical" }, expectValid: false },
  { label: "risk: notes too long", kind: "risk", content: { summary: "Data loss risk", severity: "high", notes: "x".repeat(1001) }, expectValid: false },
  { label: "risk: missing summary", kind: "risk", content: { severity: "high" }, expectValid: false },

  // capability
  { label: "capability: valid minimal", kind: "capability", content: { title: "GitHub write", status: "implemented" }, expectValid: true },
  { label: "capability: valid with notes", kind: "capability", content: { title: "GitHub write", status: "planned", notes: "Not started." }, expectValid: true },
  { label: "capability: invalid status", kind: "capability", content: { title: "GitHub write", status: "bogus" }, expectValid: false },

  // candidate_action
  { label: "candidate_action: valid minimal", kind: "candidate_action", content: { summary: "Rotate credentials" }, expectValid: true },
  { label: "candidate_action: valid with rationale", kind: "candidate_action", content: { summary: "Rotate credentials", rationale: "Key was in a public commit." }, expectValid: true },
  { label: "candidate_action: rationale too long", kind: "candidate_action", content: { summary: "Rotate credentials", rationale: "x".repeat(1001) }, expectValid: false },
  { label: "candidate_action: missing summary", kind: "candidate_action", content: { rationale: "no summary" }, expectValid: false },
];

describe("context derivation validation equivalence (review finding F2)", () => {
  it.each(FIXTURES)("$label", ({ kind, content, expectValid }) => {
    const tsResult = validateInferredFieldContent(kind, content);
    const workerResult = normalizeCandidate(
      { kind, confidence: "medium", sourceEvidenceIds: [EVIDENCE_ID], content },
      VALID_EVIDENCE_IDS,
    );
    expect(tsResult.valid).toBe(expectValid);
    expect(workerResult !== null).toBe(expectValid);
  });

  it("exercises every InferredContextFieldKind at least once", () => {
    const kinds = new Set(FIXTURES.map((fixture) => fixture.kind));
    expect(kinds).toEqual(new Set(["objective", "milestone", "decision", "risk", "capability", "candidate_action"]));
  });

  it("both validators reject a candidate whose content is not a plain object", () => {
    const tsResult = validateInferredFieldContent("risk", "not-an-object" as never);
    const workerResult = normalizeCandidate(
      { kind: "risk", confidence: "medium", sourceEvidenceIds: [EVIDENCE_ID], content: "not-an-object" },
      VALID_EVIDENCE_IDS,
    );
    expect(tsResult.valid).toBe(false);
    expect(workerResult).toBeNull();
  });
});
