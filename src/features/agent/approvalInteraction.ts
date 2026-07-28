import { compareRiskLevels } from "./executionPolicy";
import { resolveToolForStep } from "./toolResolver";
import type { AgentToolDefinition } from "./toolTypes";
import type {
  WorkspaceApprovalRiskLevel,
  WorkspaceApprovalScope,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

export const APPROVAL_INTERACTION_VERSION = "approval-interaction-v1" as const;

export type ApprovalInteractionDecision = "approved" | "rejected" | "closed";

export type ApprovalInteractionErrorCode =
  | "MISSING_STEP"
  | "MISSING_APPROVAL"
  | "STEP_MISMATCH"
  | "TARGET_MISMATCH"
  | "TOOL_MISMATCH"
  | "UNSUPPORTED_SCOPE"
  | "SCOPE_ESCALATION"
  | "RISK_UNDERSTATEMENT";

export interface ApprovalInteractionInput {
  step?: WorkspacePlanStep | null;
  stepApproval?: WorkspaceStepApproval | null;
  tool?: AgentToolDefinition | null;
  requestedApprovalScope?: WorkspaceApprovalScope;
  requestedRiskLevel?: WorkspaceApprovalRiskLevel;
  now?: Date;
}

export interface ApprovalInteractionSuccess {
  ok: true;
  decision: ApprovalInteractionDecision;
  approval: WorkspaceStepApproval | null;
  decidedAt: string;
  interactionVersion: typeof APPROVAL_INTERACTION_VERSION;
}

export interface ApprovalInteractionFailure {
  ok: false;
  decision: "failed";
  errorCode: ApprovalInteractionErrorCode;
  reason: string;
  decidedAt: string;
  interactionVersion: typeof APPROVAL_INTERACTION_VERSION;
}

export type ApprovalInteractionResult =
  | ApprovalInteractionSuccess
  | ApprovalInteractionFailure;

const approvalScopeOrder: Record<WorkspaceApprovalScope, number> = {
  view_only: 0,
  single_step: 1,
  multiple_steps: 2,
  entire_plan: 3,
};

const supportedScopes = new Set<WorkspaceApprovalScope>([
  "view_only",
  "single_step",
  "multiple_steps",
  "entire_plan",
]);

function timestamp(now?: Date) {
  return (now ?? new Date()).toISOString();
}

function failure(
  input: ApprovalInteractionInput,
  errorCode: ApprovalInteractionErrorCode,
  reason: string,
): ApprovalInteractionFailure {
  return {
    ok: false,
    decision: "failed",
    errorCode,
    reason,
    decidedAt: timestamp(input.now),
    interactionVersion: APPROVAL_INTERACTION_VERSION,
  };
}

function cloneApproval(
  source: WorkspaceStepApproval,
  status: WorkspaceStepApproval["status"],
  riskLevel: WorkspaceApprovalRiskLevel,
  approvalScope: WorkspaceApprovalScope,
  tool?: AgentToolDefinition | null,
): WorkspaceStepApproval {
  return Object.freeze({
    stepId: source.stepId,
    ...(source.targetId ? { targetId: source.targetId } : {}),
    toolId: source.toolId ?? tool?.id,
    toolName: source.toolName ?? tool?.name,
    toolDescription: source.toolDescription ?? tool?.description,
    toolCapability: source.toolCapability ?? tool?.capability,
    toolMode: source.toolMode ?? tool?.mode,
    status,
    requiresApproval: source.requiresApproval,
    approvalReason: source.approvalReason,
    riskLevel,
    reversible: source.reversible,
    externalEffect: source.externalEffect,
    dataDomains: [...source.dataDomains],
    approvalScope,
    ...(source.previewText ? { previewText: source.previewText } : {}),
    ...(source.codeProposalBinding ? { codeProposalBinding: source.codeProposalBinding } : {}),
  });
}

function maxRisk(
  left: WorkspaceApprovalRiskLevel,
  right: WorkspaceApprovalRiskLevel,
): WorkspaceApprovalRiskLevel {
  return compareRiskLevels(left, right) >= 0 ? left : right;
}

interface ValidatedApprovalInteraction {
  stepApproval: WorkspaceStepApproval;
  requestedScope: WorkspaceApprovalScope;
  requestedRisk: WorkspaceApprovalRiskLevel;
}

function validateInteraction(
  input: ApprovalInteractionInput,
): ApprovalInteractionFailure | ValidatedApprovalInteraction {
  const step = input.step;
  const stepApproval = input.stepApproval;

  if (!step?.id) {
    return failure(input, "MISSING_STEP", "Approval requires an exact plan step id.");
  }

  if (!stepApproval?.stepId) {
    return failure(input, "MISSING_APPROVAL", "Approval requires a matching step approval contract.");
  }

  if (stepApproval.stepId !== step.id) {
    return failure(input, "STEP_MISMATCH", "Approval must match the exact plan step.");
  }

  if (stepApproval.targetId && step.targetId && stepApproval.targetId !== step.targetId) {
    return failure(input, "TARGET_MISMATCH", "Approval must match the exact step target.");
  }

  if (stepApproval.toolId && input.tool?.id && stepApproval.toolId !== input.tool.id) {
    return failure(input, "TOOL_MISMATCH", "Approval must match the exact resolved tool.");
  }

  const requestedScope = input.requestedApprovalScope ?? stepApproval.approvalScope;
  if (!supportedScopes.has(requestedScope)) {
    return failure(input, "UNSUPPORTED_SCOPE", "Approval scope is not supported.");
  }

  if (approvalScopeOrder[requestedScope] > approvalScopeOrder[stepApproval.approvalScope]) {
    return failure(input, "SCOPE_ESCALATION", "Approval scope cannot exceed the planned step scope.");
  }

  const effectiveRisk = maxRisk(stepApproval.riskLevel, input.tool?.riskLevel ?? "none");
  const requestedRisk = input.requestedRiskLevel ?? effectiveRisk;
  if (compareRiskLevels(requestedRisk, effectiveRisk) < 0) {
    return failure(input, "RISK_UNDERSTATEMENT", "Approval risk cannot be lower than effective risk.");
  }

  return {
    stepApproval,
    requestedScope,
    requestedRisk,
  };
}

export function approveWorkspaceStep(
  input: ApprovalInteractionInput,
): ApprovalInteractionResult {
  const validation = validateInteraction(input);
  if ("ok" in validation) return validation;

  return {
    ok: true,
    decision: "approved",
    approval: cloneApproval(
      validation.stepApproval,
      "approved",
      validation.requestedRisk,
      validation.requestedScope,
      input.tool,
    ),
    decidedAt: timestamp(input.now),
    interactionVersion: APPROVAL_INTERACTION_VERSION,
  };
}

export function rejectWorkspaceStep(
  input: ApprovalInteractionInput,
): ApprovalInteractionResult {
  const validation = validateInteraction(input);
  if ("ok" in validation) return validation;

  return {
    ok: true,
    decision: "rejected",
    approval: cloneApproval(
      validation.stepApproval,
      "rejected",
      validation.requestedRisk,
      validation.requestedScope,
      input.tool,
    ),
    decidedAt: timestamp(input.now),
    interactionVersion: APPROVAL_INTERACTION_VERSION,
  };
}

export function closeWorkspaceStepApproval(
  input: Pick<ApprovalInteractionInput, "now"> = {},
): ApprovalInteractionResult {
  return {
    ok: true,
    decision: "closed",
    approval: null,
    decidedAt: timestamp(input.now),
    interactionVersion: APPROVAL_INTERACTION_VERSION,
  };
}

export function findApprovalPresentationTool(
  step?: WorkspacePlanStep | null,
): AgentToolDefinition | null {
  if (!step) return null;
  const result = resolveToolForStep({ step });
  return result.resolved ? result.tool ?? null : null;
}
