import { describe, expect, it } from "vitest";
import {
  resolveAllPrecedence,
  resolveCandidateActionPrecedence,
  resolveCapabilityPrecedence,
  resolveDecisionPrecedence,
  resolveMilestonePrecedence,
  resolveObjectivePrecedence,
  resolveRiskPrecedence,
} from "./contextPrecedenceResolver";
import type {
  CandidateProjectAction,
  InferredElementProvenance,
  ProjectCapability,
  ProjectDecision,
  ProjectMilestone,
  ProjectObjective,
  ProjectRisk,
} from "./projectContextTypes";

function userDeclared(fieldId: string): InferredElementProvenance {
  return { stateCategory: "user_declared", inferredFieldId: fieldId, confidence: "high", modelIdentity: "gemini-test" };
}

function proposed(fieldId: string): InferredElementProvenance {
  return { stateCategory: "inferred_unconfirmed", inferredFieldId: fieldId, confidence: "medium", modelIdentity: "gemini-test" };
}

function objective(overrides: Partial<ProjectObjective>): ProjectObjective {
  return { id: "obj-1", summary: "Ship v1", status: "active", sourceIds: ["ev-1"], ...overrides };
}

function milestone(overrides: Partial<ProjectMilestone>): ProjectMilestone {
  return { id: "ms-1", title: "Beta launch", status: "active", sourceIds: ["ev-1"], ...overrides };
}

function decision(overrides: Partial<ProjectDecision>): ProjectDecision {
  return { id: "dec-1", title: "Use Postgres", status: "accepted", sourceIds: ["ev-1"], ...overrides };
}

function capability(overrides: Partial<ProjectCapability>): ProjectCapability {
  return { id: "cap-1", title: "GitHub write", status: "implemented", sourceIds: ["ev-1"], ...overrides };
}

function risk(overrides: Partial<ProjectRisk>): ProjectRisk {
  return { id: "risk-1", summary: "Data loss risk", severity: "high", sourceIds: ["ev-1"], ...overrides };
}

function candidateAction(overrides: Partial<CandidateProjectAction>): CandidateProjectAction {
  return { id: "act-1", kind: "candidate_action", authority: "non_authoritative", summary: "Rotate credentials", sourceIds: ["ev-1"], ...overrides };
}

describe("contextPrecedenceResolver", () => {
  describe("no-collision passthrough", () => {
    it("keeps every element unchanged and reports no conflicts when every slot key is unique", () => {
      const result = resolveObjectivePrecedence([
        objective({ id: "obj-1", status: "achieved", summary: "Ship v0" }),
        objective({ id: "obj-2", status: "active", summary: "Ship v1" }),
      ]);
      expect(result.kept).toHaveLength(2);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe("cross-tier precedence: evidence_extracted vs user_declared", () => {
    it("objective: evidence-extracted (no inferredProvenance) wins over a conflicting user_confirmed candidate", () => {
      const evidenceExtracted = objective({ id: "obj-evidence", status: "active", summary: "Ship v1" });
      const userConfirmed = objective({ id: "obj-confirmed", status: "active", summary: "Ship v2", inferredProvenance: userDeclared("field-1") });
      const result = resolveObjectivePrecedence([evidenceExtracted, userConfirmed]);
      expect(result.kept.map((o) => o.id)).toEqual(["obj-evidence"]);
      expect(result.conflicts).toEqual([
        {
          kind: "objective",
          slotKey: "objective:active",
          winners: [{ id: "obj-evidence", tier: "evidence_extracted" }],
          superseded: [{ id: "obj-confirmed", tier: "user_declared" }],
          reason: "higher_tier_precedence",
        },
      ]);
    });
  });

  describe("cross-tier precedence: evidence_extracted vs inferred_unconfirmed", () => {
    it("risk: evidence-extracted wins over a conflicting still-proposed candidate with the same normalized summary", () => {
      const evidenceExtracted = risk({ id: "risk-evidence", summary: "Data Loss Risk", severity: "low" });
      const proposedRisk = risk({ id: "risk-proposed", summary: "data loss risk", severity: "high", inferredProvenance: proposed("field-2") });
      const result = resolveRiskPrecedence([evidenceExtracted, proposedRisk]);
      expect(result.kept.map((r) => r.id)).toEqual(["risk-evidence"]);
      expect(result.conflicts[0]).toMatchObject({ reason: "higher_tier_precedence", winners: [{ id: "risk-evidence", tier: "evidence_extracted" }] });
    });
  });

  describe("cross-tier precedence: user_declared vs inferred_unconfirmed", () => {
    it("milestone: user_confirmed wins over a conflicting still-proposed candidate for the active slot", () => {
      const confirmed = milestone({ id: "ms-confirmed", status: "active", title: "Beta launch", inferredProvenance: userDeclared("field-3") });
      const stillProposed = milestone({ id: "ms-proposed", status: "active", title: "GA launch", inferredProvenance: proposed("field-4") });
      const result = resolveMilestonePrecedence([confirmed, stillProposed]);
      expect(result.kept.map((m) => m.id)).toEqual(["ms-confirmed"]);
      expect(result.conflicts[0]).toMatchObject({
        reason: "higher_tier_precedence",
        winners: [{ id: "ms-confirmed", tier: "user_declared" }],
        superseded: [{ id: "ms-proposed", tier: "inferred_unconfirmed" }],
      });
    });

    it("decision: user_corrected (also user_declared) wins over a still-proposed candidate with the same normalized title", () => {
      const corrected = decision({ id: "dec-corrected", title: "Use Postgres", status: "accepted", inferredProvenance: userDeclared("field-5") });
      const stillProposed = decision({ id: "dec-proposed", title: "use postgres", status: "rejected", inferredProvenance: proposed("field-6") });
      const result = resolveDecisionPrecedence([corrected, stillProposed]);
      expect(result.kept.map((d) => d.id)).toEqual(["dec-corrected"]);
    });

    it("capability: user_confirmed wins over a still-proposed candidate with the same normalized title", () => {
      const confirmed = capability({ id: "cap-confirmed", title: "GitHub write", status: "implemented", inferredProvenance: userDeclared("field-7") });
      const stillProposed = capability({ id: "cap-proposed", title: "GITHUB WRITE", status: "planned", inferredProvenance: proposed("field-8") });
      const result = resolveCapabilityPrecedence([confirmed, stillProposed]);
      expect(result.kept.map((c) => c.id)).toEqual(["cap-confirmed"]);
    });

    it("candidate_action: user_confirmed wins over a still-proposed candidate with the same normalized summary", () => {
      const confirmed = candidateAction({ id: "act-confirmed", summary: "Rotate credentials", inferredProvenance: userDeclared("field-9") });
      const stillProposed = candidateAction({ id: "act-proposed", summary: "rotate credentials", inferredProvenance: proposed("field-10") });
      const result = resolveCandidateActionPrecedence([confirmed, stillProposed]);
      expect(result.kept.map((a) => a.id)).toEqual(["act-confirmed"]);
    });
  });

  describe("same-tier conflict: never silently narrowed to one (project-domain.md section 15)", () => {
    it("two evidence-extracted objectives both claiming the active slot are both kept, and the conflict is recorded", () => {
      const first = objective({ id: "obj-a", status: "active", summary: "Ship v1" });
      const second = objective({ id: "obj-b", status: "active", summary: "Ship v2" });
      const result = resolveObjectivePrecedence([first, second]);
      expect(result.kept.map((o) => o.id).sort()).toEqual(["obj-a", "obj-b"]);
      expect(result.conflicts).toEqual([
        {
          kind: "objective",
          slotKey: "objective:active",
          winners: [
            { id: "obj-a", tier: "evidence_extracted" },
            { id: "obj-b", tier: "evidence_extracted" },
          ],
          superseded: [],
          reason: "same_tier_conflict",
        },
      ]);
    });

    it("two still-proposed risks with the same normalized summary are both kept as an unresolved same-tier conflict", () => {
      const first = risk({ id: "risk-a", summary: "Data loss risk", severity: "low", inferredProvenance: proposed("field-11") });
      const second = risk({ id: "risk-b", summary: "data loss risk", severity: "high", inferredProvenance: proposed("field-12") });
      const result = resolveRiskPrecedence([first, second]);
      expect(result.kept.map((r) => r.id).sort()).toEqual(["risk-a", "risk-b"]);
      expect(result.conflicts[0].reason).toBe("same_tier_conflict");
    });

    it("a same-tier conflict among the top tier still supersedes a strictly lower tier third candidate", () => {
      const winnerA = risk({ id: "risk-a", summary: "Data loss risk", inferredProvenance: userDeclared("field-13") });
      const winnerB = risk({ id: "risk-b", summary: "data loss risk", inferredProvenance: userDeclared("field-14") });
      const loser = risk({ id: "risk-c", summary: "DATA LOSS RISK", inferredProvenance: proposed("field-15") });
      const result = resolveRiskPrecedence([winnerA, winnerB, loser]);
      expect(result.kept.map((r) => r.id).sort()).toEqual(["risk-a", "risk-b"]);
      expect(result.conflicts[0]).toMatchObject({
        reason: "same_tier_conflict",
        winners: [
          { id: "risk-a", tier: "user_declared" },
          { id: "risk-b", tier: "user_declared" },
        ],
        superseded: [{ id: "risk-c", tier: "inferred_unconfirmed" }],
      });
    });
  });

  describe("slot-key independence: different normalized text never collides", () => {
    it("two risks with genuinely different summaries never conflict, regardless of tier", () => {
      const a = risk({ id: "risk-a", summary: "Data loss risk", inferredProvenance: proposed("field-16") });
      const b = risk({ id: "risk-b", summary: "Vendor lock-in risk", inferredProvenance: userDeclared("field-17") });
      const result = resolveRiskPrecedence([a, b]);
      expect(result.kept).toHaveLength(2);
      expect(result.conflicts).toHaveLength(0);
    });

    it("a non-active objective never competes with the active-slot objective", () => {
      const active = objective({ id: "obj-active", status: "active", summary: "Ship v1" });
      const achieved = objective({ id: "obj-achieved", status: "achieved", summary: "Ship v0" });
      const result = resolveObjectivePrecedence([active, achieved]);
      expect(result.kept).toHaveLength(2);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe("determinism", () => {
    it("produces byte-identical output across repeated calls with the same input", () => {
      const input = {
        objectives: [objective({ id: "obj-evidence" }), objective({ id: "obj-confirmed", inferredProvenance: userDeclared("field-1") })],
        milestones: [milestone({})],
        decisions: [decision({})],
        capabilities: [capability({})],
        risks: [risk({})],
        candidateActions: [candidateAction({})],
      };
      const first = resolveAllPrecedence(input);
      const second = resolveAllPrecedence(input);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });

  describe("resolveAllPrecedence orchestration", () => {
    it("flattens conflicts from every kind into a single array", () => {
      const result = resolveAllPrecedence({
        objectives: [objective({ id: "obj-a", status: "active" }), objective({ id: "obj-b", status: "active", inferredProvenance: proposed("field-1") })],
        milestones: [],
        decisions: [],
        capabilities: [],
        risks: [risk({ id: "risk-a" }), risk({ id: "risk-b", inferredProvenance: proposed("field-2") })],
        candidateActions: [],
      });
      expect(result.conflicts).toHaveLength(2);
      expect(result.conflicts.map((c) => c.kind).sort()).toEqual(["objective", "risk"]);
      expect(result.objectives.map((o) => o.id)).toEqual(["obj-a"]);
      expect(result.risks.map((r) => r.id)).toEqual(["risk-a"]);
    });
  });
});
