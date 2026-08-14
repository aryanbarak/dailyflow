import type {
  WorkspaceApprovalRiskLevel,
  WorkspaceApprovalScope,
  WorkspacePlanActionType,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";
import type {
  AgentToolCapability,
  AgentToolDefinition,
  ExecutionPolicyCheck,
  ExecutionPolicyDecision,
  ExecutionPolicyInput,
  ExecutionPolicyStatus,
} from "./toolTypes";

export const EXECUTION_POLICY_VERSION = "execution-policy-v1" as const;

const riskOrder: Record<WorkspaceApprovalRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const approvalScopeOrder: Record<WorkspaceApprovalScope, number> = {
  view_only: 0,
  single_step: 1,
  multiple_steps: 2,
  entire_plan: 3,
};

const actionCapabilityMap: Record<WorkspacePlanActionType, AgentToolCapability[]> = {
  review: ["inspect", "search", "open", "analyze"],
  open: ["open", "inspect"],
  reflect: ["analyze", "recommend"],
  continue: ["open", "update", "complete", "inspect"],
  plan: ["inspect", "recommend", "schedule"],
  select: ["inspect", "update"],
  focus: ["inspect", "update"],
  inspect: ["inspect", "search", "analyze", "read"],
  // "schedule" added for Task 22 (calendar write slice):
  // calendar.create_event's own capability is "schedule" (predates this
  // task; kept as-is rather than renamed to "create" to avoid touching an
  // existing tool declaration's identity), so a create-actionType step
  // proposing it needs this policy allow-list widened, same as
  // writeRuntime.ts's own expectedCapabilityForToolId already was.
  create: ["create", "schedule"],
  update: ["update"],
  complete: ["complete"],
  delete: ["delete"],
  send: ["send"],
  pay: ["create"],
  share: ["send"],
  invite: ["send", "create"],
};

const targetRequiredActions = new Set<WorkspacePlanActionType>([
  "update",
  "delete",
  "send",
  "complete",
]);

export function compareRiskLevels(
  left: WorkspaceApprovalRiskLevel,
  right: WorkspaceApprovalRiskLevel,
) {
  return riskOrder[left] - riskOrder[right];
}

export function resolveEffectiveRisk(
  toolRisk: WorkspaceApprovalRiskLevel,
  approvalRisk: WorkspaceApprovalRiskLevel = "none",
  stepRisk: WorkspaceApprovalRiskLevel = "none",
): WorkspaceApprovalRiskLevel {
  return [toolRisk, approvalRisk, stepRisk].reduce<WorkspaceApprovalRiskLevel>(
    (max, risk) => (riskOrder[risk] > riskOrder[max] ? risk : max),
    "none",
  );
}

export function isApprovalScopeSufficient(
  approvalScope: WorkspaceApprovalScope,
  requiredScope: WorkspaceApprovalScope,
) {
  return approvalScopeOrder[approvalScope] >= approvalScopeOrder[requiredScope];
}

export function getRequiredApprovalScope(tool: AgentToolDefinition): WorkspaceApprovalScope {
  if (tool.mode === "read" && !tool.externalEffect) return "view_only";
  return "single_step";
}

export function isStepToolMappingValid(
  step: WorkspacePlanStep,
  tool: AgentToolDefinition,
) {
  const allowedCapabilities = actionCapabilityMap[step.actionType] ?? [];
  return step.domain === tool.domain && allowedCapabilities.includes(tool.capability);
}

function check(id: string, passed: boolean, reason: string): ExecutionPolicyCheck {
  return {
    id,
    passed,
    reason,
    severity: passed ? "info" : "blocking",
  };
}

function decision(
  status: ExecutionPolicyStatus,
  input: ExecutionPolicyInput,
  checks: ExecutionPolicyCheck[],
  effectiveRiskLevel: WorkspaceApprovalRiskLevel,
  requiredApprovalScope: WorkspaceApprovalScope,
): ExecutionPolicyDecision {
  const evaluatedAt = (input.currentTime ?? new Date()).toISOString();
  const reasons = checks
    .filter((item) => !item.passed || item.severity === "warning")
    .map((item) => item.reason);

  if (status === "allowed") {
    reasons.push("Execution Policy V1 allows this future execution request.");
  }

  return {
    status,
    allowed: status === "allowed",
    reasons,
    effectiveRiskLevel,
    requiredApprovalScope,
    matchedToolId: input.tool?.id,
    stepId: input.step?.id ?? "unknown-step",
    evaluatedAt,
    policyVersion: EXECUTION_POLICY_VERSION,
    checks,
  };
}

function firstBlockingStatus(
  checks: ExecutionPolicyCheck[],
  fallback: ExecutionPolicyStatus,
): ExecutionPolicyStatus {
  const failed = checks.find((item) => !item.passed);
  if (!failed) return fallback;
  switch (failed.id) {
    case "tool-present":
      return "tool_not_found";
    case "tool-enabled":
      return "tool_disabled";
    case "required-input":
    case "target-requirements":
      return "invalid_mapping";
    case "domain-match":
      return "domain_mismatch";
    case "capability-match":
      return "capability_mismatch";
    case "approval-present":
    case "approval-status":
    case "approval-step":
    case "approval-tool":
    case "external-effect-approval":
    case "irreversible-approval":
      return "approval_required";
    case "approval-risk":
      return "risk_mismatch";
    case "approval-scope":
      return "scope_insufficient";
    default:
      return fallback;
  }
}

function hasRequiredTarget(step: WorkspacePlanStep) {
  if (!targetRequiredActions.has(step.actionType)) return true;
  return Boolean(step.targetId || step.targetRoute);
}

function hasApprovedStatus(approval: WorkspaceStepApproval | null | undefined) {
  return approval?.status === "approved";
}

export function evaluateExecutionPolicy(input: ExecutionPolicyInput): ExecutionPolicyDecision {
  const checks: ExecutionPolicyCheck[] = [];
  const tool = input.tool;
  const step = input.step;

  checks.push(check("required-input", Boolean(step), "A workspace plan step is required."));
  checks.push(check("tool-present", Boolean(tool), "A registered agent tool is required."));

  if (!step || !tool) {
    return decision(
      firstBlockingStatus(checks, "denied"),
      input,
      checks,
      "none",
      "view_only",
    );
  }

  const approvalRisk = input.approval?.riskLevel ?? input.context?.approvalModel?.riskLevel ?? "none";
  const effectiveRiskLevel = resolveEffectiveRisk(
    tool.riskLevel,
    approvalRisk,
    input.context?.stepRiskLevel,
  );
  const requiredApprovalScope = getRequiredApprovalScope(tool);
  const allowedCapabilities = actionCapabilityMap[step.actionType] ?? [];
  const mappingValid = isStepToolMappingValid(step, tool);

  checks.push(check("tool-enabled", tool.enabled, "Tool must be enabled."));
  checks.push(check("domain-match", step.domain === tool.domain, "Step domain must match tool domain."));
  checks.push(
    check(
      "capability-match",
      allowedCapabilities.includes(tool.capability),
      "Step action type must explicitly allow the tool capability.",
    ),
  );
  checks.push(
    check(
      "target-requirements",
      hasRequiredTarget(step),
      "Target id or route is required for this action type.",
    ),
  );

  const requiresExplicitApproval =
    tool.requiresApproval ||
    tool.externalEffect ||
    !tool.reversible ||
    tool.mode !== "read" ||
    effectiveRiskLevel === "medium" ||
    effectiveRiskLevel === "high";

  if (requiresExplicitApproval) {
    checks.push(check("approval-present", Boolean(input.approval), "Explicit step approval is required."));
    checks.push(
      check(
        "approval-status",
        hasApprovedStatus(input.approval),
        "Step approval status must be approved.",
      ),
    );
    checks.push(
      check(
        "approval-step",
        input.approval?.stepId === step.id,
        "Approval must match the exact plan step.",
      ),
    );
    checks.push(
      check(
        "approval-tool",
        input.approval?.toolId === tool.id,
        "Approval must match the exact resolved tool.",
      ),
    );
    checks.push(
      check(
        "approval-scope",
        Boolean(input.approval && isApprovalScopeSufficient(input.approval.approvalScope, requiredApprovalScope)),
        "Approval scope is insufficient for this tool.",
      ),
    );
    checks.push(
      check(
        "approval-risk",
        Boolean(input.approval && compareRiskLevels(input.approval.riskLevel, effectiveRiskLevel) >= 0),
        "Approval risk level is lower than the effective execution risk.",
      ),
    );
  } else {
    checks.push(
      check(
        "approval-step",
        !input.approval || input.approval.stepId === step.id,
        "Approval must match the exact plan step.",
      ),
    );
    checks.push(
      check(
        "approval-tool",
        !input.approval?.toolId || input.approval.toolId === tool.id,
        "Approval must match the exact resolved tool.",
      ),
    );
    checks.push(
      check(
        "read-only-approval",
        !input.approval || input.approval.status === "not_required" || input.approval.status === "approved",
        "Read-only tool must not be blocked by a pending or rejected approval.",
      ),
    );
  }

  checks.push(
    check(
      "external-effect-approval",
      !tool.externalEffect || hasApprovedStatus(input.approval),
      "External-effect tools require explicit approved consent.",
    ),
  );
  checks.push(
    check(
      "irreversible-approval",
      tool.reversible || (hasApprovedStatus(input.approval) && compareRiskLevels(effectiveRiskLevel, "medium") >= 0),
      "Irreversible tools require explicit approval and medium/high effective risk.",
    ),
  );
  checks.push(
    check(
      "mapping-valid",
      mappingValid,
      "Step/tool mapping must be valid before future execution.",
    ),
  );

  const status = firstBlockingStatus(checks, "allowed");
  return decision(status, input, checks, effectiveRiskLevel, requiredApprovalScope);
}
