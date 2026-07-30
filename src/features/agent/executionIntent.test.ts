import { beforeEach, describe, expect, it } from "vitest";
import { getToolById } from "./toolRegistry";
import {
  assertIntentExecutionReady,
  bindApprovalToIntent,
  clearExecutionIntentLifecycleRegistry,
  createCanonicalExecutionIntent,
  createExecutionAttempt,
  createExecutionResultReference,
  createIntentPolicyDecision,
  ExecutionIntentError,
  EXECUTION_INTENT_HASH_ALGORITHM,
  getStoredCanonicalExecutionIntent,
  issueExecutionIntentApproval,
  resolveExecutionIntentApproval,
  sha256Hex,
  stableSerialize,
  storeCanonicalExecutionIntent,
  transitionExecutionIntentState,
} from "./executionIntent";
import { evaluateExecutionPolicy } from "./executionPolicy";
import type { AgentToolDefinition } from "./toolTypes";
import type { WorkspacePlanStep, WorkspaceStepApproval } from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

function step(overrides: Partial<WorkspacePlanStep> = {}): WorkspacePlanStep {
  return {
    id: "step:complete-task",
    order: 1,
    title: "Complete task",
    description: "Mark a task complete.",
    domain: "tasks",
    estimatedMinutes: 1,
    status: "proposed",
    actionType: "complete",
    targetId: "task-1",
    reason: "Ready.",
    requiresApproval: true,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function approval(
  sourceStep = step(),
  overrides: Partial<WorkspaceStepApproval> = {},
): WorkspaceStepApproval {
  return {
    stepId: sourceStep.id,
    targetId: sourceStep.targetId,
    toolId: "tasks.complete",
    status: "approved",
    requiresApproval: true,
    approvalReason: "Completing a task changes user data.",
    riskLevel: "medium",
    reversible: true,
    externalEffect: true,
    dataDomains: ["tasks"],
    approvalScope: "single_step",
    ...overrides,
  };
}

async function canonical(overrides: {
  sourceStep?: WorkspacePlanStep;
  args?: Record<string, unknown>;
  actorId?: string;
} = {}) {
  const sourceStep = overrides.sourceStep ?? step();
  const tool = getToolById("tasks.complete");
  return createCanonicalExecutionIntent({
    candidate: {
      proposedToolId: "tasks.complete",
      proposedOperation: "complete",
      proposedArguments: overrides.args ?? { taskId: "task-1" },
      sourceProposalReference: sourceStep.id,
    },
    tool,
    step: sourceStep,
    actorId: overrides.actorId ?? "user-1",
    scopeId: "user:user-1",
    operation: "complete",
    arguments: overrides.args ?? { taskId: "task-1" },
    sourceProposalReference: sourceStep.id,
    idempotencyKey: "write:test",
    createdAt: now.toISOString(),
  });
}

function jsonTool(): AgentToolDefinition {
  return {
    id: "system.json_test",
    name: "JSON test",
    description: "Test-only JSON canonicalization tool.",
    domain: "system",
    capability: "inspect",
    mode: "read",
    riskLevel: "none",
    requiresApproval: false,
    approvalScope: "view_only",
    reversible: true,
    externalEffect: false,
    inputSchema: [
      { name: "payload", type: "object", required: false, description: "Payload." },
      { name: "items", type: "array", required: false, description: "Items." },
      { name: "count", type: "number", required: false, description: "Count." },
      { name: "flag", type: "boolean", required: false, description: "Flag." },
      { name: "label", type: "string", required: false, description: "Label." },
    ],
    outputSchema: { type: "object", description: "Output." },
    enabled: true,
    version: "test",
    tags: [],
    examples: [],
    constraints: [],
  };
}

async function canonicalJson(args: Record<string, unknown>) {
  const sourceStep = step({ id: "step:json", domain: "workspace", actionType: "review", targetId: undefined });
  return createCanonicalExecutionIntent({
    candidate: {
      proposedToolId: "system.json_test",
      proposedOperation: "review",
      proposedArguments: args,
      sourceProposalReference: sourceStep.id,
    },
    tool: jsonTool(),
    step: sourceStep,
    actorId: "user-1",
    scopeId: "user:user-1",
    operation: "review",
    arguments: args,
    sourceProposalReference: sourceStep.id,
    createdAt: now.toISOString(),
  });
}

describe("executionIntent", () => {
  beforeEach(() => {
    clearExecutionIntentLifecycleRegistry();
  });

  it("rejects unknown tools and unsupported operations", async () => {
    await expect(
      createCanonicalExecutionIntent({
        candidate: { proposedToolId: "missing.tool" },
        tool: undefined,
        step: step(),
        actorId: "user-1",
        scopeId: "user:user-1",
        operation: "complete",
        arguments: {},
        createdAt: now.toISOString(),
      }),
    ).rejects.toThrow(ExecutionIntentError);

    await expect(
      createCanonicalExecutionIntent({
        candidate: { proposedToolId: "tasks.complete", proposedOperation: "delete" },
        tool: getToolById("tasks.complete"),
        step: step(),
        actorId: "user-1",
        scopeId: "user:user-1",
        operation: "complete",
        arguments: { userId: "user-1", taskId: "task-1" },
        createdAt: now.toISOString(),
      }),
    ).rejects.toThrow(/operation/);
  });

  it("rejects unrecognized and trusted candidate fields", async () => {
    await expect(canonical({ args: { taskId: "task-1", extra: true } })).rejects.toThrow(/Unsupported argument/);
    await expect(canonical({ args: { taskId: "task-1", state: "succeeded" } })).rejects.toThrow(/cannot be supplied/);
  });

  it("normalizes equivalent arguments to the same canonical payload and hash", async () => {
    const first = await canonical({ args: { taskId: " task-1 " } });
    const second = await canonical({ args: { taskId: "task-1" } });
    const changed = await canonical({ args: { taskId: "task-2" }, sourceStep: step({ targetId: "task-2" }) });

    expect(first.normalizedArguments).toEqual({ taskId: "task-1" });
    expect(first.canonicalHash).toBe(second.canonicalHash);
    expect(first.canonicalHash).not.toBe(changed.canonicalHash);
    expect(stableSerialize({ b: 1, a: { d: 2, c: 3 } })).toBe(stableSerialize({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("enforces explicit lifecycle transitions", () => {
    expect(transitionExecutionIntentState("candidate", "canonicalized")).toBe("canonicalized");
    expect(() => transitionExecutionIntentState("candidate", "executing")).toThrow(/Illegal/);
    expect(() => transitionExecutionIntentState("policy_denied", "execution_ready")).toThrow(/Illegal/);
    expect(() => transitionExecutionIntentState("succeeded", "failed")).toThrow(/Illegal/);
  });

  it("requires matching non-expired approval binding before write execution", async () => {
    const intent = await canonical();
    const policy = createIntentPolicyDecision(intent, evaluateExecutionPolicy({
      step: step(),
      tool: getToolById("tasks.complete"),
      approval: approval(),
      currentTime: now,
    }));
    const binding = bindApprovalToIntent({
      intent,
      approval: await issueExecutionIntentApproval({
        intent,
        actorId: "user-1",
        approvedAt: now.toISOString(),
      }),
      actorId: "user-1",
      now,
    });

    expect(() => assertIntentExecutionReady({ intent, policyDecision: policy, approvalBinding: binding, now })).not.toThrow();
    expect(() => bindApprovalToIntent({
      intent,
      approval: {
        approvalId: "approval:old",
        intentId: intent.intentId,
        canonicalHash: "old-hash",
        canonicalizationVersion: intent.intentVersion,
        hashAlgorithm: intent.hashAlgorithm,
        actorId: "user-1",
        scope: "single_step",
        approvedAt: now.toISOString(),
      },
      actorId: "user-1",
      now,
    })).toThrow(/hash/);
    expect(() => bindApprovalToIntent({
      intent,
      approval: {
        approvalId: "approval:other-user",
        intentId: intent.intentId,
        canonicalHash: intent.canonicalHash,
        canonicalizationVersion: intent.intentVersion,
        hashAlgorithm: intent.hashAlgorithm,
        actorId: "user-2",
        scope: "single_step",
        approvedAt: now.toISOString(),
      },
      actorId: "user-1",
      now,
    })).toThrow(/actor/);
  });

  it("rejects expired and revoked approvals and mismatched result attachment", async () => {
    const intent = await canonical();
    expect(() => bindApprovalToIntent({
      intent,
      approval: {
        approvalId: "approval:expired",
        intentId: intent.intentId,
        canonicalHash: intent.canonicalHash,
        canonicalizationVersion: intent.intentVersion,
        hashAlgorithm: intent.hashAlgorithm,
        actorId: "user-1",
        scope: "single_step",
        approvedAt: "2026-07-10T08:00:00.000Z",
        expiresAt: "2026-07-10T08:30:00.000Z",
      },
      actorId: "user-1",
      now,
    })).toThrow(/expired/);

    expect(() => bindApprovalToIntent({
      intent,
      approval: {
        approvalId: "approval:revoked",
        intentId: intent.intentId,
        canonicalHash: intent.canonicalHash,
        canonicalizationVersion: intent.intentVersion,
        hashAlgorithm: intent.hashAlgorithm,
        actorId: "user-1",
        scope: "single_step",
        approvedAt: now.toISOString(),
        revokedAt: now.toISOString(),
      },
      actorId: "user-1",
      now,
    })).toThrow(/revoked/);

    const attempt = createExecutionAttempt({
      intent,
      attemptId: "attempt:1",
      startedAt: now.toISOString(),
      runtimeTarget: "tasks.complete",
    });
    const otherIntent = await canonical({ args: { taskId: "task-2" }, sourceStep: step({ targetId: "task-2" }) });
    expect(() => createExecutionResultReference({
      intent: otherIntent,
      attempt,
      status: "succeeded",
      completedAt: now.toISOString(),
    })).toThrow(/another intent/);
  });

  it("uses explicit SHA-256 canonical hashes", async () => {
    const intent = await canonical();

    expect(intent.hashAlgorithm).toBe(EXECUTION_INTENT_HASH_ALGORITHM);
    expect(intent.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("defensively stores and resolves immutable intent and approval records", async () => {
    const intent = await canonical();
    storeCanonicalExecutionIntent(intent);
    expect(() => {
      (intent.normalizedArguments as Record<string, unknown>).taskId = "mutated";
    }).toThrow();
    expect(getStoredCanonicalExecutionIntent(intent.intentId)?.normalizedArguments).toEqual({ taskId: "task-1" });

    const returnedIntent = getStoredCanonicalExecutionIntent(intent.intentId);
    expect(() => {
      (returnedIntent?.normalizedArguments as Record<string, unknown>).taskId = "mutated-again";
    }).toThrow();
    expect(getStoredCanonicalExecutionIntent(intent.intentId)?.normalizedArguments).toEqual({ taskId: "task-1" });

    const approval = await issueExecutionIntentApproval({
      intent: getStoredCanonicalExecutionIntent(intent.intentId)!,
      actorId: "user-1",
      approvedAt: now.toISOString(),
    });
    const returnedApproval = resolveExecutionIntentApproval(approval.approvalId) as typeof approval & { actorId: string };
    expect(() => {
      returnedApproval.actorId = "mutated-user";
    }).toThrow();
    expect(resolveExecutionIntentApproval(approval.approvalId)?.actorId).toBe("user-1");
  });

  it("accepts the strict JSON-compatible canonical value domain", async () => {
    const intent = await canonicalJson({
      payload: {
        nested: { value: null },
        values: [true, "label", 42, 3.14],
      },
      items: [null, false, "item", 1],
      count: 2.5,
      flag: true,
      label: "ok",
    });

    expect(intent.normalizedArguments).toMatchObject({
      count: 2.5,
      flag: true,
      label: "ok",
    });
    expect(intent.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["Date", () => ({ payload: { value: new Date("2026-07-10T09:00:00Z") } })],
    ["Map", () => ({ payload: { value: new Map([["a", 1]]) } })],
    ["Set", () => ({ payload: { value: new Set([1]) } })],
    ["class instance", () => ({ payload: { value: new (class Custom { value = 1; })() } })],
    ["function", () => ({ payload: { value: () => undefined } })],
    ["symbol", () => ({ payload: { value: Symbol("x") } })],
    ["bigint", () => ({ payload: { value: BigInt(1) } })],
    ["undefined", () => ({ payload: { value: undefined } })],
    ["NaN", () => ({ count: Number.NaN })],
    ["Infinity", () => ({ count: Number.POSITIVE_INFINITY })],
    ["unsafe key", () => ({ payload: Object.fromEntries([["__proto__", "x"]]) })],
    ["nested unsafe key", () => ({ payload: { nested: Object.fromEntries([["constructor", "x"]]) } })],
    ["custom prototype", () => {
      const custom = Object.create({ inherited: true });
      custom.value = 1;
      return { payload: custom };
    }],
  ])("rejects unsupported canonical value: %s", async (_label, buildArgs) => {
    await expect(canonicalJson(buildArgs())).rejects.toThrow(ExecutionIntentError);
  });

  it("rejects cyclic canonical values without mutating the registry", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(canonicalJson({ payload: cyclic })).rejects.toThrow(/cyclic/);
    expect(getStoredCanonicalExecutionIntent("intent:cycle")).toBeUndefined();
  });
});
