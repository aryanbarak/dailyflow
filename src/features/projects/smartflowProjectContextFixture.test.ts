import { describe, expect, it } from "vitest";
import { buildProjectContext } from "./projectContextBuilder";
import { getSmartFlowProjectContext, SMARTFLOW_PROJECT_CONTEXT_INPUT } from "./smartflowProjectContextFixture";

describe("SmartFlow project context fixture", () => {
  it("builds successfully from the committed fixture input", () => {
    const context = getSmartFlowProjectContext();
    expect(context.project.name).toBe("SmartFlow");
    expect(context.project.type).toBe("software_project");
  });

  it("reports the Software Project Context Foundation as the current objective focus", () => {
    const context = getSmartFlowProjectContext();
    expect(context.currentObjective?.id).toBe("objective:software-project-proving-ground");
    expect(context.currentObjective?.status).toBe("active");
  });

  it("reports Software Project Context Foundation as the active milestone", () => {
    const context = getSmartFlowProjectContext();
    expect(context.activeMilestone?.id).toBe("milestone:software-project-context-foundation");
  });

  it("reports the execution-intent lifecycle and GitHub read-only integration as completed milestones", () => {
    const context = getSmartFlowProjectContext();
    const completedIds = context.completedMilestones.map((m) => m.id);
    expect(completedIds).toContain("milestone:execution-intent-lifecycle-slice-1");
    expect(completedIds).toContain("milestone:github-read-only-integration-slice-1");
  });

  it("reports the Project Workspace roadmap slices as planned, not active or completed", () => {
    const context = getSmartFlowProjectContext();
    const planned = context.plannedOrDeferredMilestones.find((m) => m.id === "milestone:project-workspace-roadmap-slices");
    expect(planned?.status).toBe("planned");
  });

  it("reports durable persistence, scheduling, and autonomous execution as deferred capabilities, never implemented", () => {
    const context = getSmartFlowProjectContext();
    const deferredIds = context.plannedOrDeferredCapabilities.map((c) => c.id);
    expect(deferredIds).toContain("capability:durable-execution-persistence");
    expect(deferredIds).toContain("capability:scheduling-and-retries");
    expect(deferredIds).toContain("capability:autonomous-execution");
    expect(deferredIds).toContain("capability:additional-project-types");
    const implementedIds = context.implementedCapabilities.map((c) => c.id);
    for (const deferredId of deferredIds) {
      expect(implementedIds).not.toContain(deferredId);
    }
  });

  it("reports the execution-intent lifecycle and GitHub read-only integration as implemented capabilities", () => {
    const context = getSmartFlowProjectContext();
    const implementedIds = context.implementedCapabilities.map((c) => c.id);
    expect(implementedIds).toContain("capability:execution-intent-lifecycle");
    expect(implementedIds).toContain("capability:github-read-only-integration");
  });

  it("carries every accepted decision with a source reference", () => {
    const context = getSmartFlowProjectContext();
    expect(context.acceptedDecisions.length).toBeGreaterThan(0);
    for (const decision of context.acceptedDecisions) {
      expect(decision.sourceIds.length).toBeGreaterThan(0);
    }
  });

  it("carries the in-memory lifecycle persistence risk with source evidence", () => {
    const context = getSmartFlowProjectContext();
    const risk = context.risks.find((r) => r.id === "risk:in-memory-lifecycle-persistence");
    expect(risk).toBeDefined();
    expect(risk?.sourceIds.length).toBeGreaterThan(0);
  });

  it("keeps candidate actions as non-authoritative recommendations only", () => {
    const context = getSmartFlowProjectContext();
    expect(context.candidateActions.length).toBeGreaterThan(0);
    for (const action of context.candidateActions) {
      expect(action.authority).toBe("non_authoritative");
      expect(action).not.toHaveProperty("status");
    }
  });

  it("is deterministic across repeated builds of the same fixture input", () => {
    const first = buildProjectContext(SMARTFLOW_PROJECT_CONTEXT_INPUT);
    const second = buildProjectContext(SMARTFLOW_PROJECT_CONTEXT_INPUT);
    expect(first).toEqual(second);
  });

  it("is JSON-serializable end to end", () => {
    const context = getSmartFlowProjectContext();
    expect(() => JSON.parse(JSON.stringify(context))).not.toThrow();
  });
});
