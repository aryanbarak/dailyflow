import { describe, expect, it } from "vitest";
import { buildProjectContext } from "./projectContextBuilder";
import type {
  CandidateProjectAction,
  ProjectCapability,
  ProjectContextInput,
  ProjectDecision,
  ProjectMilestone,
  ProjectObjective,
  ProjectRisk,
  ProjectSource,
} from "./projectContextTypes";

const GENERATED_AT = "2026-07-30T00:00:00.000Z";

function baseSources(): ProjectSource[] {
  return [
    { id: "source:status", kind: "project_status_document", title: "Status", reference: "PROJECT_STATUS.md" },
    {
      id: "source:architecture",
      kind: "architecture_document",
      title: "Architecture",
      reference: "docs/architecture/current-architecture.md",
    },
  ];
}

function baseObjectives(): ProjectObjective[] {
  return [{ id: "objective:main", summary: "Ship the loop.", status: "active", sourceIds: ["source:status"] }];
}

function baseMilestones(): ProjectMilestone[] {
  return [
    { id: "milestone:done", title: "Done thing", status: "completed", sourceIds: ["source:status"], order: 1 },
    { id: "milestone:now", title: "Now thing", status: "active", sourceIds: ["source:status"], order: 2 },
    { id: "milestone:later", title: "Later thing", status: "planned", sourceIds: ["source:status"], order: 3 },
  ];
}

function baseDecisions(): ProjectDecision[] {
  return [{ id: "decision:one", title: "Decision one", status: "accepted", sourceIds: ["source:architecture"] }];
}

function baseCapabilities(): ProjectCapability[] {
  return [
    { id: "capability:impl", title: "Implemented thing", status: "implemented", sourceIds: ["source:architecture"] },
    { id: "capability:deferred", title: "Deferred thing", status: "deferred", sourceIds: ["source:status"] },
  ];
}

function baseRisks(): ProjectRisk[] {
  return [{ id: "risk:one", summary: "In-memory state.", severity: "medium", sourceIds: ["source:status"] }];
}

function baseCandidateActions(): CandidateProjectAction[] {
  return [
    {
      id: "candidate:one",
      kind: "candidate_action",
      authority: "non_authoritative",
      summary: "Consider doing the next thing.",
      sourceIds: ["source:status"],
      relatedRiskId: "risk:one",
      relatedCapabilityId: "capability:impl",
    },
  ];
}

function baseInput(overrides: Partial<ProjectContextInput> = {}): ProjectContextInput {
  return {
    generatedAt: GENERATED_AT,
    project: { id: "project:demo", type: "software_project", name: "Demo Project" },
    sources: baseSources(),
    objectives: baseObjectives(),
    milestones: baseMilestones(),
    decisions: baseDecisions(),
    capabilities: baseCapabilities(),
    risks: baseRisks(),
    candidateActions: baseCandidateActions(),
    ...overrides,
  };
}

describe("buildProjectContext - happy path", () => {
  it("builds a valid Software Project context", () => {
    const result = buildProjectContext(baseInput());
    expect(result.valid).toBe(true);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.project.type).toBe("software_project");
    expect(result.context.contextVersion).toBe("project-context-v1");
  });

  it("exposes exactly one current objective", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.currentObjective?.id).toBe("objective:main");
  });

  it("separates completed, active, and planned/deferred milestones", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.completedMilestones.map((m) => m.id)).toEqual(["milestone:done"]);
    expect(result.context.activeMilestone?.id).toBe("milestone:now");
    expect(result.context.plannedOrDeferredMilestones.map((m) => m.id)).toEqual(["milestone:later"]);
  });

  it("separates implemented and deferred capabilities without a boolean flag", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.implementedCapabilities.map((c) => c.id)).toEqual(["capability:impl"]);
    expect(result.context.plannedOrDeferredCapabilities.map((c) => c.id)).toEqual(["capability:deferred"]);
    expect(result.context.implementedCapabilities[0]).not.toHaveProperty("isImplemented");
  });

  it("only surfaces accepted decisions", () => {
    const input = baseInput({
      decisions: [
        ...baseDecisions(),
        { id: "decision:pending", title: "Still discussed", status: "proposed", sourceIds: ["source:status"] },
      ],
    });
    const result = buildProjectContext(input);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.acceptedDecisions.map((d) => d.id)).toEqual(["decision:one"]);
  });

  it("carries risks with their source references", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.risks[0].sourceIds).toContain("source:status");
  });

  it("keeps candidate actions non-authoritative", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    const [action] = result.context.candidateActions;
    expect(action.kind).toBe("candidate_action");
    expect(action.authority).toBe("non_authoritative");
    expect(action).not.toHaveProperty("status");
  });

  it("is JSON-serializable", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    const json = JSON.stringify(result.context);
    expect(JSON.parse(json)).toEqual(result.context);
  });
});

describe("buildProjectContext - determinism", () => {
  it("produces equal output regardless of collection array order", () => {
    const forward = buildProjectContext(baseInput());
    const reversed = buildProjectContext(
      baseInput({
        sources: [...baseSources()].reverse(),
        objectives: [...baseObjectives()].reverse(),
        milestones: [...baseMilestones()].reverse(),
        decisions: [...baseDecisions()].reverse(),
        capabilities: [...baseCapabilities()].reverse(),
        risks: [...baseRisks()].reverse(),
        candidateActions: [...baseCandidateActions()].reverse(),
      }),
    );
    expect(forward).toEqual(reversed);
  });

  it("produces equal output across repeated builds", () => {
    const first = buildProjectContext(baseInput());
    const second = buildProjectContext(baseInput());
    expect(first).toEqual(second);
  });

  it("depends only on injected generatedAt, never the real clock", () => {
    const result = buildProjectContext(baseInput({ generatedAt: "2020-01-01T00:00:00.000Z" }));
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.metadata.generatedAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("orders milestones by explicit order then id, not input order", () => {
    const shuffled = [...baseMilestones()].sort(() => 0.5 - Math.random());
    const result = buildProjectContext(baseInput({ milestones: shuffled }));
    if (result.valid !== true) throw new Error("expected valid result");
    const allIds = [
      ...result.context.completedMilestones,
      ...(result.context.activeMilestone ? [result.context.activeMilestone] : []),
      ...result.context.plannedOrDeferredMilestones,
    ].map((m) => m.id);
    expect(allIds).toEqual(["milestone:done", "milestone:now", "milestone:later"]);
  });

  it("orders multiple planned milestones within the same bucket by order, independent of input order", () => {
    const plannedMilestones: ProjectMilestone[] = [
      { id: "milestone:z-third", title: "Third", status: "planned", sourceIds: ["source:status"], order: 3 },
      { id: "milestone:a-first", title: "First", status: "planned", sourceIds: ["source:status"], order: 1 },
      { id: "milestone:m-second", title: "Second", status: "planned", sourceIds: ["source:status"], order: 2 },
    ];
    const forward = buildProjectContext(baseInput({ milestones: plannedMilestones }));
    const shuffled = buildProjectContext(baseInput({ milestones: [...plannedMilestones].reverse() }));
    if (forward.valid !== true || shuffled.valid !== true) throw new Error("expected valid results");
    const expectedOrder = ["milestone:a-first", "milestone:m-second", "milestone:z-third"];
    expect(forward.context.plannedOrDeferredMilestones.map((m) => m.id)).toEqual(expectedOrder);
    expect(shuffled.context.plannedOrDeferredMilestones.map((m) => m.id)).toEqual(expectedOrder);
  });
});

describe("buildProjectContext - validation failures", () => {
  it("fails closed on missing project identity", () => {
    const result = buildProjectContext(baseInput({ project: { id: "", type: "software_project", name: "" } }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MISSING_PROJECT_IDENTITY")).toBe(true);
  });

  it("fails closed on an unsupported project type", () => {
    const result = buildProjectContext(
      baseInput({ project: { id: "project:demo", type: "learning_project" as never, name: "Demo" } }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNSUPPORTED_PROJECT_TYPE")).toBe(true);
  });

  it("fails closed on duplicate stable identifiers", () => {
    const result = buildProjectContext(
      baseInput({ milestones: [...baseMilestones(), { ...baseMilestones()[0] }] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "DUPLICATE_MILESTONE_ID")).toBe(true);
  });

  it("fails closed on multiple active objectives instead of guessing one", () => {
    const result = buildProjectContext(
      baseInput({
        objectives: [
          { id: "objective:a", summary: "A", status: "active", sourceIds: ["source:status"] },
          { id: "objective:b", summary: "B", status: "active", sourceIds: ["source:status"] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MULTIPLE_ACTIVE_OBJECTIVES")).toBe(true);
  });

  it("fails closed on multiple active milestones", () => {
    const result = buildProjectContext(
      baseInput({
        milestones: [
          { id: "milestone:a", title: "A", status: "active", sourceIds: ["source:status"] },
          { id: "milestone:b", title: "B", status: "active", sourceIds: ["source:status"] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MULTIPLE_ACTIVE_MILESTONES")).toBe(true);
  });

  it("rejects an invalid lifecycle status", () => {
    const result = buildProjectContext(
      baseInput({ milestones: [{ id: "milestone:x", title: "X", status: "in_progress" as never, sourceIds: ["source:status"] }] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "INVALID_MILESTONE_STATUS")).toBe(true);
  });

  it("rejects an invalid or ambiguous decision status string (the model has no separate accepted/proposed flags to actually collide)", () => {
    const result = buildProjectContext(
      baseInput({
        decisions: [
          { id: "decision:ambiguous", title: "Ambiguous", status: "accepted-and-proposed" as never, sourceIds: ["source:status"] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "INVALID_DECISION_STATUS")).toBe(true);
  });

  it("rejects contradictory implemented/deferred state for the same capability id", () => {
    const result = buildProjectContext(
      baseInput({
        capabilities: [
          { id: "capability:dup", title: "Dup", status: "implemented", sourceIds: ["source:status"] },
          { id: "capability:dup", title: "Dup", status: "deferred", sourceIds: ["source:status"] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "DUPLICATE_CAPABILITY_ID")).toBe(true);
  });

  it("requires a source reference for an accepted decision", () => {
    const result = buildProjectContext(
      baseInput({ decisions: [{ id: "decision:no-source", title: "No source", status: "accepted", sourceIds: [] }] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MISSING_SOURCE_REFERENCE")).toBe(true);
  });

  it("rejects a reference to an unknown source id", () => {
    const result = buildProjectContext(
      baseInput({ risks: [{ id: "risk:bad-ref", summary: "Bad ref", severity: "low", sourceIds: ["source:does-not-exist"] }] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNKNOWN_SOURCE_ID")).toBe(true);
  });

  it("rejects an invalid risk severity", () => {
    const result = buildProjectContext(
      baseInput({ risks: [{ id: "risk:bad", summary: "Bad", severity: "critical" as never, sourceIds: ["source:status"] }] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "INVALID_RISK_SEVERITY")).toBe(true);
  });

  it("rejects a malformed candidate action missing required fields", () => {
    const result = buildProjectContext(
      baseInput({
        candidateActions: [{ id: "candidate:bad", kind: "candidate_action", authority: "non_authoritative", summary: "", sourceIds: [] }],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MALFORMED_CANDIDATE_ACTION")).toBe(true);
  });

  it("rejects non-serializable/unsafe input (a function value)", () => {
    const unsafeInput = baseInput();
    (unsafeInput as unknown as Record<string, unknown>).unsafeHandler = () => "nope";
    const result = buildProjectContext(unsafeInput);
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNSAFE_VALUE")).toBe(true);
  });

  it("rejects a __proto__ key anywhere in the input", () => {
    const input = baseInput();
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}');
    (input as unknown as Record<string, unknown>).extra = polluted;
    const result = buildProjectContext(input);
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNSAFE_VALUE")).toBe(true);
  });

  it("rejects an unsupported source kind", () => {
    const result = buildProjectContext(
      baseInput({ sources: [{ id: "source:bad", kind: "tweet" as never, title: "Bad", reference: "somewhere.md" }] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "INVALID_SOURCE_KIND")).toBe(true);
  });

  it("rejects a document source reference that is not a safe repository-relative path", () => {
    const result = buildProjectContext(
      baseInput({
        sources: [
          { id: "source:bad-path", kind: "architecture_document", title: "Bad", reference: "../../etc/passwd" },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "INVALID_SOURCE_REFERENCE")).toBe(true);
  });

  it("accepts a verified-evidence source reference using the verified: prefix", () => {
    const result = buildProjectContext(
      baseInput({
        sources: [
          ...baseSources(),
          {
            id: "source:verified-runtime",
            kind: "verified_integration_evidence",
            title: "Verified runtime evidence",
            reference: "verified:github.repositories.list production runtime",
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a decision that supersedes an unknown decision id", () => {
    const result = buildProjectContext(
      baseInput({
        decisions: [
          { id: "decision:new", title: "New", status: "accepted", sourceIds: ["source:status"], supersedesId: "decision:missing" },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "DECISION_SUPERSEDES_UNKNOWN")).toBe(true);
  });

  it("collects multiple independent validation errors in one pass", () => {
    const result = buildProjectContext(
      baseInput({
        project: { id: "", type: "software_project", name: "" },
        risks: [{ id: "risk:bad", summary: "Bad", severity: "critical" as never, sourceIds: [] }],
      }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe("buildProjectContext - immutability", () => {
  it("does not mutate its input", () => {
    const input = baseInput();
    const snapshotBefore = JSON.parse(JSON.stringify(input));
    buildProjectContext(input);
    expect(input).toEqual(snapshotBefore);
  });

  it("returns a frozen context that cannot be mutated after construction", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(() => {
      (result.context as { project: unknown }).project = { id: "hacked" };
    }).toThrow();
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(Object.isFrozen(result.context.risks)).toBe(true);
  });

  it("does not let mutating the returned context affect a later rebuild from the same input", () => {
    const input = baseInput();
    const first = buildProjectContext(input);
    if (first.valid !== true) throw new Error("expected valid result");
    try {
      (first.context.risks as unknown as ProjectRisk[]).push({
        id: "risk:injected",
        summary: "Injected",
        severity: "high",
        sourceIds: ["source:status"],
      });
    } catch {
      // Frozen arrays throw in strict mode; either way the input is untouched.
    }
    const second = buildProjectContext(input);
    if (second.valid !== true) throw new Error("expected valid result");
    expect(second.context.risks.map((r) => r.id)).toEqual(["risk:one"]);
  });
});

describe("buildProjectContext - authority boundaries", () => {
  it("rejects a candidate action smuggling an execution-authority field", () => {
    const smuggled = {
      id: "candidate:smuggled",
      kind: "candidate_action",
      authority: "non_authoritative",
      summary: "Looks like a recommendation",
      sourceIds: ["source:status"],
      toolId: "github.files.update",
      approved: true,
    };
    const result = buildProjectContext(
      baseInput({ candidateActions: [smuggled as unknown as CandidateProjectAction] }),
    );
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MALFORMED_CANDIDATE_ACTION")).toBe(true);
  });

  it("never surfaces a proposed decision inside acceptedDecisions", () => {
    const result = buildProjectContext(
      baseInput({
        decisions: [
          ...baseDecisions(),
          { id: "decision:proposed-only", title: "Proposed", status: "proposed", sourceIds: ["source:status"] },
        ],
      }),
    );
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.acceptedDecisions.some((d) => d.id === "decision:proposed-only")).toBe(false);
  });

  it("candidate actions carry no status field and cannot be mistaken for a decision", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    for (const action of result.context.candidateActions) {
      expect(action).not.toHaveProperty("status");
      expect(action).not.toHaveProperty("decidedAt");
    }
  });

  it("has no execution handler, tool, or approval fields anywhere in the built context", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    const serialized = JSON.stringify(result.context);
    expect(serialized).not.toMatch(/toolId|approvalId|executionIntent|approved":true/);
  });
});

// Regression coverage for the three confirmed independent-review blockers:
// (1) input mutation through shared nested references, (2) malformed
// collection entries crashing the builder, (3) repository document path
// traversal. Each test below reproduces the exact adversarial shape that
// was previously either mutated, crashed, or incorrectly accepted.
describe("buildProjectContext - input ownership regression (blocker 1)", () => {
  function inputWithSharedReferences() {
    const sharedSourceIds = ["source:status"];
    const sharedRepository = { provider: "github" as const, owner: "me", name: "repo", connectionStatus: "connected" as const };
    const input: ProjectContextInput = {
      generatedAt: GENERATED_AT,
      project: { id: "project:demo", type: "software_project", name: "Demo Project", repository: sharedRepository },
      sources: baseSources(),
      objectives: [{ id: "objective:main", summary: "Ship the loop.", status: "active", sourceIds: sharedSourceIds }],
      milestones: [],
      decisions: [],
      capabilities: [],
      risks: [],
      candidateActions: [],
    };
    return { input, sharedSourceIds, sharedRepository };
  }

  it("leaves a caller-owned sourceIds array unfrozen after a successful build", () => {
    const { input, sharedSourceIds } = inputWithSharedReferences();
    const result = buildProjectContext(input);
    expect(result.valid).toBe(true);
    expect(Object.isFrozen(sharedSourceIds)).toBe(false);
  });

  it("leaves a caller-owned nested project.repository object unfrozen after a successful build", () => {
    const { input, sharedRepository } = inputWithSharedReferences();
    const result = buildProjectContext(input);
    expect(result.valid).toBe(true);
    expect(Object.isFrozen(sharedRepository)).toBe(false);
  });

  it("allows the caller to mutate its original nested array after the build", () => {
    const { input, sharedSourceIds } = inputWithSharedReferences();
    buildProjectContext(input);
    expect(() => sharedSourceIds.push("source:extra")).not.toThrow();
    expect(sharedSourceIds).toEqual(["source:status", "source:extra"]);
  });

  it("allows the caller to mutate its original nested repository object after the build", () => {
    const { input, sharedRepository } = inputWithSharedReferences();
    buildProjectContext(input);
    expect(() => {
      (sharedRepository as { owner: string }).owner = "someone-else";
    }).not.toThrow();
    expect(sharedRepository.owner).toBe("someone-else");
  });

  it("does not let a post-build caller mutation change the already-returned frozen context", () => {
    const { input, sharedSourceIds } = inputWithSharedReferences();
    const result = buildProjectContext(input);
    if (result.valid !== true) throw new Error("expected valid result");
    const objectiveSourceIdsBefore = [...result.context.objectives[0].sourceIds];
    sharedSourceIds.push("source:mutated-after-build");
    expect(result.context.objectives[0].sourceIds).toEqual(objectiveSourceIdsBefore);
    expect(result.context.objectives[0].sourceIds).not.toContain("source:mutated-after-build");
  });

  it("still deep-freezes the output's own nested values", () => {
    const { input } = inputWithSharedReferences();
    const result = buildProjectContext(input);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(Object.isFrozen(result.context.objectives[0].sourceIds)).toBe(true);
    expect(Object.isFrozen(result.context.project.repository)).toBe(true);
  });

  it("safely reuses shared input fragments across multiple independent builds", () => {
    const sharedSourceIds = ["source:status"];
    const objectiveA = { id: "objective:a", summary: "A", status: "active" as const, sourceIds: sharedSourceIds };
    const objectiveB = { id: "objective:b", summary: "B", status: "achieved" as const, sourceIds: sharedSourceIds };
    const resultA = buildProjectContext(baseInput({ objectives: [objectiveA] }));
    const resultB = buildProjectContext(baseInput({ objectives: [objectiveB] }));
    expect(resultA.valid).toBe(true);
    expect(resultB.valid).toBe(true);
    expect(Object.isFrozen(sharedSourceIds)).toBe(false);
    expect(() => sharedSourceIds.push("source:reused")).not.toThrow();
  });

  it("does not retain the exact array/object references the caller passed in", () => {
    const { input, sharedSourceIds, sharedRepository } = inputWithSharedReferences();
    const result = buildProjectContext(input);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.objectives[0].sourceIds).not.toBe(sharedSourceIds);
    expect(result.context.project.repository).not.toBe(sharedRepository);
  });
});

describe("buildProjectContext - malformed collection entries regression (blocker 2)", () => {
  const malformedEntries: Array<{ label: string; value: unknown }> = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "string", value: "not-an-entity" },
    { label: "number", value: 42 },
    { label: "boolean", value: true },
    { label: "array", value: [] },
  ];

  function expectNoThrowAndTypedMalformedError(build: () => ReturnType<typeof buildProjectContext>) {
    let result: ReturnType<typeof buildProjectContext> | undefined;
    expect(() => {
      result = build();
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    if (!result || result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MALFORMED_ENTITY")).toBe(true);
    return result.errors;
  }

  for (const { label, value } of malformedEntries) {
    it(`objectives: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() =>
        buildProjectContext(baseInput({ objectives: [value as never] })),
      );
      expect(errors.some((e) => e.path === "objectives[0]")).toBe(true);
    });

    it(`milestones: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() =>
        buildProjectContext(baseInput({ milestones: [value as never] })),
      );
      expect(errors.some((e) => e.path === "milestones[0]")).toBe(true);
    });

    it(`decisions: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() =>
        buildProjectContext(baseInput({ decisions: [value as never] })),
      );
      expect(errors.some((e) => e.path === "decisions[0]")).toBe(true);
    });

    it(`capabilities: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() =>
        buildProjectContext(baseInput({ capabilities: [value as never] })),
      );
      expect(errors.some((e) => e.path === "capabilities[0]")).toBe(true);
    });

    it(`risks: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() => buildProjectContext(baseInput({ risks: [value as never] })));
      expect(errors.some((e) => e.path === "risks[0]")).toBe(true);
    });

    it(`sources: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() => buildProjectContext(baseInput({ sources: [value as never] })));
      expect(errors.some((e) => e.path === "sources[0]")).toBe(true);
    });

    it(`candidateActions: a ${label} entry does not throw and is reported as a typed malformed-entity error`, () => {
      const errors = expectNoThrowAndTypedMalformedError(() =>
        buildProjectContext(baseInput({ candidateActions: [value as never] })),
      );
      expect(errors.some((e) => e.path === "candidateActions[0]")).toBe(true);
    });
  }

  it("continues validating and reports additional errors alongside a malformed entry", () => {
    const errors = expectNoThrowAndTypedMalformedError(() =>
      buildProjectContext(
        baseInput({
          milestones: [null as never, ...baseMilestones()],
          risks: [{ id: "risk:bad", summary: "Bad", severity: "critical" as never, sourceIds: [] }],
        }),
      ),
    );
    expect(errors.some((e) => e.code === "MALFORMED_ENTITY")).toBe(true);
    expect(errors.some((e) => e.code === "INVALID_RISK_SEVERITY")).toBe(true);
    expect(errors.length).toBeGreaterThan(1);
  });

  it("does not silently discard a malformed entry without emitting an error", () => {
    const result = buildProjectContext(baseInput({ candidateActions: [null as never] }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not throw when an entire collection is not an array", () => {
    let result: ReturnType<typeof buildProjectContext> | undefined;
    expect(() => {
      result = buildProjectContext(baseInput({ milestones: "not-an-array" as never }));
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    if (!result || result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "MALFORMED_ENTITY" && e.path === "milestones")).toBe(true);
  });
});

describe("buildProjectContext - repository document path traversal regression (blocker 3)", () => {
  function sourceWithReference(reference: string): ProjectContextInput {
    return baseInput({
      sources: [{ id: "source:candidate", kind: "architecture_document", title: "Candidate", reference }],
      objectives: [],
      milestones: [],
      decisions: [],
      capabilities: [],
      risks: [],
      candidateActions: [],
    });
  }

  const rejectedReferences = [
    "docs/../../../etc/passwd.md",
    "docs/../architecture/current-architecture.md",
    "docs/..//secret.md",
    "C:\\temp\\file.md",
    "\\\\server\\share\\file.md",
    "/docs/file.md",
    "docs\\..\\secret.md",
    "docs/%2e%2e/secret.md",
  ];

  for (const reference of rejectedReferences) {
    it(`rejects traversal-shaped reference: ${reference}`, () => {
      const result = buildProjectContext(sourceWithReference(reference));
      expect(result.valid).toBe(false);
      if (result.valid !== false) throw new Error("expected invalid result");
      expect(result.errors.some((e) => e.code === "INVALID_SOURCE_REFERENCE")).toBe(true);
    });
  }

  const acceptedReferences = [
    "PROJECT_STATUS.md",
    "docs/architecture/current-architecture.md",
    "docs/roadmap/project-workspace-implementation-roadmap-v1.md",
    "config/project-context.json",
  ];

  for (const reference of acceptedReferences) {
    it(`accepts a genuinely safe repository-relative reference: ${reference}`, () => {
      const result = buildProjectContext(sourceWithReference(reference));
      expect(result.valid).toBe(true);
    });
  }
});

// Regression coverage for a residual crash found during the second
// independent re-review: a collection-entry object with an accessor
// (getter/setter) property caused an uncaught exception when
// scanForUnsafeValues read it via Object.entries, since ordinary property
// access invokes getters. Fixed by inspecting property descriptors
// (Object.getOwnPropertyDescriptors) and rejecting accessor properties as
// UNSAFE_VALUE before ever reading their value.
describe("buildProjectContext - accessor property regression", () => {
  it("rejects a throwing getter without throwing itself", () => {
    const hostile = {
      id: "milestone:evil-getter",
      title: "Evil",
      sourceIds: ["source:status"],
      get status(): string {
        throw new Error("evil getter fired during enumeration");
      },
    };
    let result: ReturnType<typeof buildProjectContext> | undefined;
    expect(() => {
      result = buildProjectContext(baseInput({ milestones: [hostile as unknown as ProjectMilestone] }));
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    if (!result || result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNSAFE_VALUE")).toBe(true);
  });

  it("rejects a setter-only property without invoking it or throwing", () => {
    const hostile: Record<string, unknown> = {
      id: "milestone:evil-setter",
      title: "Evil",
      status: "planned",
      sourceIds: ["source:status"],
    };
    let setterInvoked = false;
    Object.defineProperty(hostile, "extra", {
      enumerable: true,
      configurable: true,
      set(_value: unknown) {
        setterInvoked = true;
      },
    });
    let result: ReturnType<typeof buildProjectContext> | undefined;
    expect(() => {
      result = buildProjectContext(baseInput({ milestones: [hostile as unknown as ProjectMilestone] }));
    }).not.toThrow();
    expect(setterInvoked).toBe(false);
    expect(result?.valid).toBe(false);
    if (!result || result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNSAFE_VALUE")).toBe(true);
  });

  it("rejects a nested accessor property (one level below the top-level entity) without throwing", () => {
    const hostileRepository: Record<string, unknown> = {
      provider: "github",
      name: "repo",
      connectionStatus: "connected",
    };
    Object.defineProperty(hostileRepository, "owner", {
      enumerable: true,
      configurable: true,
      get(): string {
        throw new Error("evil nested getter fired during enumeration");
      },
    });
    const input = baseInput({
      project: {
        id: "project:demo",
        type: "software_project",
        name: "Demo Project",
        repository: hostileRepository as never,
      },
    });
    let result: ReturnType<typeof buildProjectContext> | undefined;
    expect(() => {
      result = buildProjectContext(input);
    }).not.toThrow();
    expect(result?.valid).toBe(false);
    if (!result || result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((e) => e.code === "UNSAFE_VALUE")).toBe(true);
  });

  it("does not invoke a non-hostile getter either -- accessors are rejected purely by shape", () => {
    let readCount = 0;
    const benign = {
      id: "milestone:benign-getter",
      title: "Benign",
      sourceIds: ["source:status"],
      get status(): string {
        readCount += 1;
        return "planned";
      },
    };
    const result = buildProjectContext(baseInput({ milestones: [benign as unknown as ProjectMilestone] }));
    expect(readCount).toBe(0);
    expect(result.valid).toBe(false);
  });

  it("still accepts an ordinary plain-data milestone defined via Object.defineProperty with a plain value descriptor", () => {
    const plain: Record<string, unknown> = {};
    Object.defineProperty(plain, "id", { value: "milestone:plain", enumerable: true, configurable: true, writable: true });
    Object.defineProperty(plain, "title", { value: "Plain", enumerable: true, configurable: true, writable: true });
    Object.defineProperty(plain, "status", { value: "planned", enumerable: true, configurable: true, writable: true });
    Object.defineProperty(plain, "sourceIds", { value: ["source:status"], enumerable: true, configurable: true, writable: true });
    const result = buildProjectContext(baseInput({ milestones: [plain as unknown as ProjectMilestone] }));
    expect(result.valid).toBe(true);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.plannedOrDeferredMilestones.map((m) => m.id)).toContain("milestone:plain");
  });

  it("still accepts every ordinary base-input entity (no accessors anywhere in the happy path)", () => {
    const result = buildProjectContext(baseInput());
    expect(result.valid).toBe(true);
  });
});

describe("buildProjectContext - inferredProvenance (ADR-0009 widening)", () => {
  it("accepts an entity with a well-formed inferredProvenance marker and carries it through to the built context", () => {
    const objectives = [
      {
        ...baseObjectives()[0],
        inferredProvenance: {
          stateCategory: "user_declared" as const,
          inferredFieldId: "field:1",
          confidence: "high" as const,
          modelIdentity: "gemini-test",
          derivationRunId: "run:1",
        },
      },
    ];
    const result = buildProjectContext(baseInput({ objectives }));
    expect(result.valid).toBe(true);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.currentObjective?.inferredProvenance).toMatchObject({
      stateCategory: "user_declared",
      inferredFieldId: "field:1",
    });
  });

  it("omits inferredProvenance entirely on an entity that never carried one -- absence is preserved, never defaulted", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.currentObjective?.inferredProvenance).toBeUndefined();
  });

  it("rejects an unsupported stateCategory rather than silently accepting it", () => {
    const objectives = [
      { ...baseObjectives()[0], inferredProvenance: { stateCategory: "authoritative", inferredFieldId: "field:1", confidence: "high", modelIdentity: "m" } },
    ] as never;
    const result = buildProjectContext(baseInput({ objectives }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((error) => error.code === "INVALID_INFERRED_PROVENANCE")).toBe(true);
  });

  it("rejects a malformed (non-object) inferredProvenance", () => {
    const risks = [{ ...baseRisks()[0], inferredProvenance: "not-an-object" }];
    const result = buildProjectContext(baseInput({ risks: risks as never }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((error) => error.code === "INVALID_INFERRED_PROVENANCE")).toBe(true);
  });

  it("rejects inferredProvenance missing a required field (inferredFieldId)", () => {
    const risks = [{ ...baseRisks()[0], inferredProvenance: { stateCategory: "inferred_unconfirmed", confidence: "low", modelIdentity: "m" } }];
    const result = buildProjectContext(baseInput({ risks: risks as never }));
    expect(result.valid).toBe(false);
  });

  it("carries inferredProvenance through on milestones, decisions, capabilities, risks, and candidate actions alike", () => {
    const provenance = {
      stateCategory: "inferred_unconfirmed" as const,
      inferredFieldId: "field:x",
      confidence: "medium" as const,
      modelIdentity: "gemini-test",
    };
    const result = buildProjectContext(
      baseInput({
        milestones: [{ ...baseMilestones()[0], inferredProvenance: provenance }],
        decisions: [{ ...baseDecisions()[0], inferredProvenance: provenance }],
        capabilities: [{ ...baseCapabilities()[0], inferredProvenance: provenance }],
        risks: [{ ...baseRisks()[0], inferredProvenance: provenance }],
        candidateActions: [{ ...baseCandidateActions()[0], inferredProvenance: provenance }],
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.completedMilestones[0]?.inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
    expect(result.context.acceptedDecisions[0]?.inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
    expect(result.context.implementedCapabilities[0]?.inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
    expect(result.context.risks[0]?.inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
    expect(result.context.candidateActions[0]?.inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
  });
});

describe("buildProjectContext - precedenceConflicts (review finding F1)", () => {
  it("defaults to an empty array when the input omits precedenceConflicts entirely -- backward compatible with every pre-F1 caller", () => {
    const result = buildProjectContext(baseInput());
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.precedenceConflicts).toEqual([]);
  });

  it("carries a well-formed precedenceConflicts array through to the built context unchanged", () => {
    const precedenceConflicts = [
      {
        kind: "risk" as const,
        slotKey: "risk:summary:data loss risk",
        winners: [{ id: "risk:one", tier: "user_declared" as const }],
        superseded: [{ id: "risk:two", tier: "inferred_unconfirmed" as const }],
        reason: "higher_tier_precedence" as const,
      },
    ];
    const result = buildProjectContext(baseInput({ precedenceConflicts }));
    expect(result.valid).toBe(true);
    if (result.valid !== true) throw new Error("expected valid result");
    expect(result.context.precedenceConflicts).toEqual(precedenceConflicts);
  });

  it("rejects an unsupported kind rather than silently accepting it", () => {
    const precedenceConflicts = [
      { kind: "not-a-kind", slotKey: "x", winners: [{ id: "a", tier: "evidence_extracted" }], superseded: [], reason: "higher_tier_precedence" },
    ];
    const result = buildProjectContext(baseInput({ precedenceConflicts: precedenceConflicts as never }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((error) => error.code === "INVALID_PRECEDENCE_CONFLICT")).toBe(true);
  });

  it("rejects an unsupported reason rather than silently accepting it", () => {
    const precedenceConflicts = [
      { kind: "risk", slotKey: "x", winners: [{ id: "a", tier: "evidence_extracted" }], superseded: [], reason: "arbitrary_pick" },
    ];
    const result = buildProjectContext(baseInput({ precedenceConflicts: precedenceConflicts as never }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((error) => error.code === "INVALID_PRECEDENCE_CONFLICT")).toBe(true);
  });

  it("rejects a winners/superseded entry with an unsupported tier", () => {
    const precedenceConflicts = [
      { kind: "risk", slotKey: "x", winners: [{ id: "a", tier: "authoritative" }], superseded: [], reason: "higher_tier_precedence" },
    ];
    const result = buildProjectContext(baseInput({ precedenceConflicts: precedenceConflicts as never }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((error) => error.code === "INVALID_PRECEDENCE_CONFLICT")).toBe(true);
  });

  it("rejects a malformed (non-array) precedenceConflicts", () => {
    const result = buildProjectContext(baseInput({ precedenceConflicts: "not-an-array" as never }));
    expect(result.valid).toBe(false);
    if (result.valid !== false) throw new Error("expected invalid result");
    expect(result.errors.some((error) => error.code === "INVALID_PRECEDENCE_CONFLICT")).toBe(true);
  });
});
