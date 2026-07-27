import { executeAgentTool } from "./executionEngine";
import { getToolById } from "./toolRegistry";
import { presentReadOnlyResult } from "./readOnlyResultPresenter";
import { processReadOnlyReflection } from "./reflectionIntegration";
import type {
  ExecutionContext,
  ExecutionEngineDependencies,
  ExecutionRequest,
  ExecutionResult,
} from "./executionTypes";
import type { AgentReflectionResult } from "./reflectionTypes";
import type { ToolResolutionResult } from "./toolResolverTypes";
import type {
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

export const SUPPORTED_READ_ONLY_TOOL_IDS = Object.freeze([
  "tasks.list",
  "calendar.list_today",
  "learning.get_progress",
  "workspace.get_context",
  "github.repositories.list",
  "github.issues.list",
  "github.epics.list",
  "github.pulls.list",
  "github.workflow_runs.list",
] as const);

export type SupportedReadOnlyToolId = typeof SUPPORTED_READ_ONLY_TOOL_IDS[number];

export type ReadOnlyRuntimeStatus =
  | "success"
  | "unresolved"
  | "approval_required"
  | "rejected"
  | "policy_denied"
  | "invalid_input"
  | "timeout"
  | "failed";

export type ReadOnlyRunState =
  | "idle"
  | "ready"
  | "running"
  | "success"
  | "denied"
  | "failed";

export interface ReadOnlyRuntimeRequest {
  requestId?: string;
  step?: WorkspacePlanStep | null;
  toolResolution?: ToolResolutionResult | null;
  approval?: WorkspaceStepApproval | null;
  executionInput?: Record<string, unknown>;
  executionContext?: ExecutionContext;
  requestedAt?: string;
  currentTime?: Date;
  reflectionStorage?: Storage;
}

export interface ReadOnlyRuntimeResult {
  requestId: string;
  stepId: string;
  toolId?: string;
  status: ReadOnlyRuntimeStatus;
  success: boolean;
  executionResult?: ExecutionResult;
  reflection?: AgentReflectionResult;
  memoryEvidenceRetained: boolean;
  safeSummary: string;
  safePreviewItems: string[];
  reasons: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

function timestamp(currentTime?: Date) {
  return (currentTime ?? new Date()).toISOString();
}

function duration(startedAt: string, completedAt: string) {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function isSupportedReadOnlyToolId(toolId: string | undefined): toolId is SupportedReadOnlyToolId {
  return SUPPORTED_READ_ONLY_TOOL_IDS.includes(toolId as SupportedReadOnlyToolId);
}

export function canStartReadOnlyRun(status: ReadOnlyRunState) {
  return status !== "running";
}

function blocked(
  request: ReadOnlyRuntimeRequest,
  status: ReadOnlyRuntimeStatus,
  safeSummary: string,
  reasons: string[],
): ReadOnlyRuntimeResult {
  const startedAt = request.requestedAt ?? timestamp(request.currentTime);
  const completedAt = startedAt;
  return {
    requestId: request.requestId ?? `read-only:blocked:${startedAt}`,
    stepId: request.step?.id ?? request.toolResolution?.stepId ?? "unknown-step",
    toolId: request.toolResolution?.toolId,
    status,
    success: false,
    memoryEvidenceRetained: false,
    safeSummary,
    safePreviewItems: [],
    reasons,
    startedAt,
    completedAt,
    durationMs: 0,
  };
}

function approvalIsRequired(step: WorkspacePlanStep, approval: WorkspaceStepApproval | null | undefined) {
  return step.requiresApproval || approval?.requiresApproval === true;
}

function validateApprovalBoundary(request: ReadOnlyRuntimeRequest) {
  const step = request.step;
  const approval = request.approval;
  if (!step) return null;

  if (approval?.status === "rejected") {
    return blocked(request, "rejected", "The read-only action was rejected.", [
      "The approval decision rejected this exact step.",
    ]);
  }

  if (approvalIsRequired(step, approval) && approval?.status !== "approved") {
    return blocked(request, "approval_required", "Approval is required before running this read-only action.", [
      "The step requires explicit approval before execution.",
    ]);
  }

  return null;
}

function createExecutionRequest(
  request: ReadOnlyRuntimeRequest,
  toolId: SupportedReadOnlyToolId,
  requestedAt: string,
): ExecutionRequest {
  const step = request.step as WorkspacePlanStep;
  return {
    requestId: request.requestId ?? `read-only:${toolId}:${step.id}:${requestedAt}`,
    step,
    toolId,
    approval: request.approval,
    input: request.executionInput ?? {},
    requestedAt,
    context: {
      ...request.executionContext,
      currentTime: request.executionContext?.currentTime ?? requestedAt,
    },
  };
}

function mapExecutionStatus(result: ExecutionResult): ReadOnlyRuntimeStatus {
  switch (result.status) {
    case "success":
      return "success";
    case "policy_denied":
      return "policy_denied";
    case "invalid_input":
      return "invalid_input";
    case "timeout":
      return "timeout";
    default:
      return "failed";
  }
}

export async function runReadOnlyTool(
  request: ReadOnlyRuntimeRequest,
  dependencies: Partial<ExecutionEngineDependencies> = {},
): Promise<ReadOnlyRuntimeResult> {
  if (!request.step?.id || !request.toolResolution?.resolved) {
    return blocked(request, "unresolved", "No supported read-only action is available.", [
      "The plan step did not resolve to a supported tool.",
    ]);
  }

  if (request.toolResolution.stepId !== request.step.id) {
    return blocked(request, "unresolved", "No supported read-only action is available.", [
      "The resolved tool does not match the current plan step.",
    ]);
  }

  if (!isSupportedReadOnlyToolId(request.toolResolution.toolId)) {
    return blocked(request, "unresolved", "No supported read-only action is available.", [
      "The resolved tool is outside the read-only runtime boundary.",
    ]);
  }

  const toolId = request.toolResolution.toolId;
  const tool = (dependencies.getToolById ?? getToolById)(toolId);
  if (
    !tool ||
    !tool.enabled ||
    tool.mode !== "read" ||
    tool.externalEffect ||
    !tool.reversible
  ) {
    return blocked(request, "policy_denied", "Run blocked by safety policy.", [
      "The resolved tool is not eligible for the read-only runtime boundary.",
    ]);
  }

  const approvalBlock = validateApprovalBoundary(request);
  if (approvalBlock) return approvalBlock;

  const requestedAt = request.requestedAt ?? timestamp(request.currentTime);
  const executionRequest = createExecutionRequest(request, toolId, requestedAt);
  const executionResult = await executeAgentTool(executionRequest, dependencies);
  const presentation = presentReadOnlyResult(executionResult);
  let reflection: AgentReflectionResult | undefined;
  let memoryEvidenceRetained = false;

  try {
    const reflectionResult = processReadOnlyReflection({
      executionResult,
      step: request.step,
      toolResolution: request.toolResolution,
      workspace: request.executionContext?.workspace,
      reflectedAt: request.currentTime,
      storage: request.reflectionStorage,
    });
    reflection = reflectionResult.reflection;
    memoryEvidenceRetained = reflectionResult.memoryEvidenceRetained;
  } catch {
    memoryEvidenceRetained = false;
  }

  return {
    requestId: executionResult.requestId,
    stepId: executionResult.stepId,
    toolId: executionResult.toolId,
    status: mapExecutionStatus(executionResult),
    success: executionResult.success,
    executionResult,
    reflection,
    memoryEvidenceRetained,
    safeSummary: presentation.safeSummary,
    safePreviewItems: presentation.safePreviewItems,
    reasons: executionResult.success ? [] : [presentation.safeSummary],
    startedAt: executionResult.startedAt,
    completedAt: executionResult.completedAt,
    durationMs: duration(executionResult.startedAt, executionResult.completedAt),
  };
}
