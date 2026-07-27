import {
  appendExecutionAuditRecord,
  getExecutionAuditRecordsByRequestId,
} from "./executionAudit";
import { EXECUTION_AUDIT_VERSION } from "./executionAudit";
import { evaluateExecutionPolicy } from "./executionPolicy";
import { getToolById } from "./toolRegistry";
import { getWriteHandlerByToolId } from "./writeHandlers";
import { processReadOnlyReflection } from "./reflectionIntegration";
import type { ExecutionAuditRecord, ExecutionAuditStatus } from "./executionAuditTypes";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionResult,
  ExecutionStatus,
} from "./executionTypes";
import type { AgentReflectionResult } from "./reflectionTypes";
import type { ToolResolutionResult } from "./toolResolverTypes";
import type { AgentToolCapability, AgentToolDefinition, ExecutionPolicyDecision } from "./toolTypes";
import type {
  Workspace,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

export const WRITE_RUNTIME_VERSION = "write-runtime-v1" as const;
export const SUPPORTED_WRITE_TOOL_IDS = Object.freeze([
  "tasks.complete",
  "github.issues.comment",
  "github.issues.update",
] as const);

export type SupportedWriteToolId = typeof SUPPORTED_WRITE_TOOL_IDS[number];

export type WriteRuntimeStatus =
  | "success"
  | "unresolved"
  | "unsupported_tool"
  | "approval_required"
  | "rejected"
  | "policy_denied"
  | "invalid_input"
  | "handler_not_found"
  | "duplicate_request"
  | "verification_failed"
  | "timeout"
  | "failed";

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// Deliberately a local, narrower shape rather than importing reasoning's
// AgentIntentTarget -- the execution layer shouldn't depend on the reasoning
// layer's types, only on the specific fields a write handler actually needs.
export interface WriteRuntimeProposalTarget {
  repo?: string;
  issueNumber?: number;
  commentBody?: string;
  updateTitle?: string;
  updateBody?: string;
  updateLabels?: string[];
}

export interface WriteRuntimeRequest {
  requestId: string;
  step?: WorkspacePlanStep | null;
  toolResolution?: ToolResolutionResult | null;
  approval?: WorkspaceStepApproval | null;
  // The proposal's validated target fields (repo/issueNumber/commentBody/...)
  // for tools whose handler input isn't fully derivable from step.targetId
  // alone. tasks.complete doesn't need this -- its target is just the task id.
  target?: WriteRuntimeProposalTarget | null;
  executionContext?: ExecutionContext & { workspace?: Workspace | null };
  requestedAt?: string;
  currentTime?: Date;
  reflectionStorage?: Storage;
}

export interface WriteRuntimeAuditCorrelation {
  requestId: string;
  startedAuditId?: string;
  terminalAuditId?: string;
}

export interface WriteRuntimeResult {
  requestId: string;
  stepId: string;
  toolId?: string;
  status: WriteRuntimeStatus;
  success: boolean;
  verified: boolean;
  alreadyCompleted?: boolean;
  reflection?: AgentReflectionResult;
  auditCorrelation: WriteRuntimeAuditCorrelation;
  safeSummary: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  runtimeVersion: typeof WRITE_RUNTIME_VERSION;
}

export interface WriteRuntimeDependencies {
  getAuthenticatedUserId(): string | null | undefined | Promise<string | null | undefined>;
  getToolById(toolId: string): AgentToolDefinition | undefined;
  getWriteHandlerByToolId(toolId: string): AgentWriteToolHandler | undefined;
  appendExecutionAuditRecord(record: ExecutionAuditRecord): ExecutionAuditRecord;
  processReflection(input: Parameters<typeof processReadOnlyReflection>[0]): ReturnType<typeof processReadOnlyReflection>;
  now(): Date;
}

const completedRequestIds = new Set<string>();

const defaultDependencies: WriteRuntimeDependencies = {
  getAuthenticatedUserId: getStoredSupabaseUserId,
  getToolById,
  getWriteHandlerByToolId,
  appendExecutionAuditRecord,
  processReflection: processReadOnlyReflection,
  now: () => new Date(),
};

function getStoredSupabaseUserId() {
  const storage = globalThis.localStorage;
  if (!storage) return undefined;

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

    try {
      const parsed = JSON.parse(storage.getItem(key) ?? "null") as {
        user?: { id?: unknown };
        currentSession?: { user?: { id?: unknown } };
      } | null;
      const userId = parsed?.user?.id ?? parsed?.currentSession?.user?.id;
      if (typeof userId === "string" && userId.trim()) return userId.trim();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function timestamp(currentTime?: Date) {
  return (currentTime ?? new Date()).toISOString();
}

function duration(startedAt: string, completedAt: string) {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function isSupportedWriteToolId(toolId: string | undefined): toolId is SupportedWriteToolId {
  return SUPPORTED_WRITE_TOOL_IDS.includes(toolId as SupportedWriteToolId);
}

// Each supported write tool has its own capability -- this used to be a bare
// `tool.capability !== "complete"` check that only tasks.complete could ever
// satisfy, silently rejecting every github write tool as "unsupported".
function expectedCapabilityForToolId(toolId: SupportedWriteToolId): AgentToolCapability {
  switch (toolId) {
    case "tasks.complete":
      return "complete";
    case "github.issues.comment":
      return "create";
    case "github.issues.update":
      return "update";
  }
}

// Same shape of bug as the capability check above: the step's actionType/
// domain combination is specific to each write tool, not just tasks.complete.
function expectedStepShapeForToolId(
  toolId: SupportedWriteToolId,
): { actionType: WorkspacePlanStep["actionType"]; domain: WorkspacePlanStep["domain"] } {
  switch (toolId) {
    case "tasks.complete":
      return { actionType: "complete", domain: "tasks" };
    case "github.issues.comment":
      return { actionType: "create", domain: "github" };
    case "github.issues.update":
      return { actionType: "update", domain: "github" };
  }
}

function auditId(requestId: string, status: ExecutionAuditStatus, timestampValue: string) {
  return `audit:${requestId}:${status}:${timestampValue}`;
}

function appendAuditSafely(
  deps: WriteRuntimeDependencies,
  record: ExecutionAuditRecord,
) {
  try {
    return deps.appendExecutionAuditRecord(record);
  } catch {
    return undefined;
  }
}

function createAuditRecord(
  request: WriteRuntimeRequest,
  status: ExecutionAuditStatus,
  startedAt: string,
  options: {
    policyDecision?: ExecutionPolicyDecision;
    completedAt?: string;
    errorCode?: string;
    handler?: AgentWriteToolHandler;
    data?: AgentWriteToolExecutionResult["auditMetadata"];
  } = {},
): ExecutionAuditRecord {
  const completedAt = options.completedAt;
  const policyDecision = options.policyDecision;
  const metadata = {
    redacted: true,
    handlerId: options.handler?.toolId,
    ...(options.data ?? {
      verified: false,
      resultShape: "object" as const,
    }),
  };

  return {
    auditId: auditId(request.requestId, status, completedAt ?? startedAt),
    requestId: request.requestId,
    stepId: request.step?.id ?? "unknown-step",
    toolId: request.toolResolution?.toolId ?? "unknown-tool",
    status,
    policyStatus: policyDecision?.status ?? "denied",
    startedAt,
    completedAt,
    durationMs: completedAt ? duration(startedAt, completedAt) : undefined,
    errorCode: options.errorCode,
    riskLevel: policyDecision?.effectiveRiskLevel ?? "none",
    approvalStatus: request.approval?.status,
    approvalScope: request.approval?.approvalScope,
    source: "agent",
    executionVersion: "execution-engine-v1",
    policyVersion: policyDecision?.policyVersion ?? "execution-policy-v1",
    auditVersion: EXECUTION_AUDIT_VERSION,
    metadata,
  };
}

function blocked(
  request: WriteRuntimeRequest,
  status: WriteRuntimeStatus,
  safeSummary: string,
  startedAt: string,
  toolId?: string,
): WriteRuntimeResult {
  const completedAt = timestamp(request.currentTime);
  return {
    requestId: request.requestId || `write:blocked:${completedAt}`,
    stepId: request.step?.id ?? request.toolResolution?.stepId ?? "unknown-step",
    toolId,
    status,
    success: false,
    verified: false,
    auditCorrelation: {
      requestId: request.requestId || `write:blocked:${completedAt}`,
    },
    safeSummary,
    startedAt,
    completedAt,
    durationMs: duration(startedAt, completedAt),
    runtimeVersion: WRITE_RUNTIME_VERSION,
  };
}

function statusFromPolicy(policyStatus: ExecutionPolicyDecision["status"]): WriteRuntimeStatus {
  switch (policyStatus) {
    case "approval_required":
    case "risk_mismatch":
    case "scope_insufficient":
      return "approval_required";
    case "tool_not_found":
    case "tool_disabled":
    case "domain_mismatch":
    case "capability_mismatch":
    case "invalid_mapping":
      return "policy_denied";
    default:
      return "policy_denied";
  }
}

function executionStatusFromHandler(
  handlerResult: AgentWriteToolExecutionResult,
): ExecutionStatus {
  switch (handlerResult.status) {
    case "success":
      return "success";
    case "invalid_input":
      return "invalid_input";
    case "verification_failed":
      return "verification_failed";
    default:
      return "failed";
  }
}

function writeStatusFromHandler(
  handlerResult: AgentWriteToolExecutionResult,
): WriteRuntimeStatus {
  if (handlerResult.status === "verification_failed") return "verification_failed";
  if (handlerResult.status === "invalid_input") return "invalid_input";
  if (handlerResult.status === "success") return "success";
  return "failed";
}

function safeSummaryFor(
  status: WriteRuntimeStatus,
  toolId?: string,
  alreadyCompleted?: boolean,
) {
  if (status === "success") {
    if (toolId === "github.issues.comment") return "Comment added.";
    if (toolId === "github.issues.update") return "Issue updated.";
    return alreadyCompleted
      ? "Task was already complete."
      : "Task was marked complete.";
  }
  if (status === "verification_failed") return "Task completion could not be verified.";
  if (status === "timeout") return "Write action timed out.";
  if (status === "duplicate_request") return "Duplicate write request was rejected.";
  if (status === "unsupported_tool") return "Write runtime does not support this tool.";
  if (status === "approval_required" || status === "rejected") return "Write action requires explicit approval.";
  return "Write action was blocked.";
}

function timeoutResult(toolId: SupportedWriteToolId): AgentWriteToolExecutionResult {
  return {
    status: "failed",
    success: false,
    error: executionError(
      "WRITE_TIMEOUT",
      `${toolId} did not finish within the allowed time.`,
      false,
    ),
    auditMetadata: {
      verified: false,
      resultShape: "object",
      redacted: true,
    },
  };
}

function executeWithTimeout(
  handler: AgentWriteToolHandler,
  input: Record<string, unknown>,
  context: Parameters<AgentWriteToolHandler["execute"]>[1],
): Promise<AgentWriteToolExecutionResult & { timedOut?: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ...timeoutResult(handler.toolId as SupportedWriteToolId),
        timedOut: true,
      });
    }, handler.timeoutMs);

    handler.execute(input, context)
      .then((result) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(result);
      })
      .catch((caught) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve({
          status: "failed",
          success: false,
          error: executionError(
            "WRITE_HANDLER_FAILED",
            "Write handler failed.",
            false,
          ),
          auditMetadata: {
            verified: false,
            resultShape: "object",
            redacted: true,
          },
        });
      });
  });
}

function executionResultFor(
  request: WriteRuntimeRequest,
  policyDecision: ExecutionPolicyDecision,
  handler: AgentWriteToolHandler,
  handlerResult: AgentWriteToolExecutionResult,
  startedAt: string,
  completedAt: string,
): ExecutionResult {
  const status = executionStatusFromHandler(handlerResult);
  return {
    requestId: request.requestId,
    stepId: request.step?.id ?? "unknown-step",
    toolId: handler.toolId,
    status,
    success: status === "success",
    data: handlerResult.data,
    error: handlerResult.error,
    policyDecision,
    startedAt,
    completedAt,
    durationMs: duration(startedAt, completedAt),
    executionVersion: "execution-engine-v1",
    metadata: {
      readOnly: false,
      handlerId: handler.toolId,
      effectiveRiskLevel: policyDecision.effectiveRiskLevel,
    },
  };
}

function validateApprovalBoundary(request: WriteRuntimeRequest, toolId: SupportedWriteToolId) {
  const approval = request.approval;
  const step = request.step;
  if (!approval) return "approval_required";
  if (approval.status === "rejected") return "rejected";
  if (approval.status !== "approved") return "approval_required";
  if (!step?.id || approval.stepId !== step.id) return "approval_required";
  if (!step.targetId || approval.targetId !== step.targetId) return "approval_required";
  if (approval.toolId !== toolId) return "approval_required";
  if (approval.approvalScope !== "single_step") return "approval_required";
  if (approval.riskLevel !== "medium") return "approval_required";
  return null;
}

function validateResolvedTool(
  request: WriteRuntimeRequest,
  deps: WriteRuntimeDependencies,
): { status?: WriteRuntimeStatus; tool?: AgentToolDefinition; toolId?: SupportedWriteToolId } {
  const resolution = request.toolResolution;
  if (!request.step?.id || !resolution?.resolved || resolution.stepId !== request.step.id || !resolution.toolId) {
    return { status: "unresolved" };
  }
  if (!isSupportedWriteToolId(resolution.toolId)) {
    return { status: "unsupported_tool" };
  }
  const tool = deps.getToolById(resolution.toolId);
  if (
    !tool ||
    resolution.tool?.id && resolution.tool.id !== resolution.toolId ||
    tool.id !== resolution.toolId ||
    !tool.enabled ||
    tool.mode !== "write" ||
    tool.externalEffect !== true ||
    tool.capability !== expectedCapabilityForToolId(resolution.toolId)
  ) {
    return { status: "unsupported_tool" };
  }
  return { tool, toolId: resolution.toolId };
}

function writeTargetIsValid(request: WriteRuntimeRequest, toolId: SupportedWriteToolId) {
  const expected = expectedStepShapeForToolId(toolId);
  return request.step?.actionType === expected.actionType &&
    request.step.domain === expected.domain &&
    typeof request.step.targetId === "string" &&
    request.step.targetId.trim().length > 0;
}

// Each write handler has a completely different input shape (tasks.complete
// takes {userId, taskId}; the github handlers take {repo, issueNumber, ...}
// and reject any other field, including userId -- GitHub auth is carried by
// the client's access token, not a userId parameter). This used to be a
// single hardcoded {userId, taskId} object that every write tool shared,
// which meant the github handlers' own validateInput always failed on
// unrecognized/missing fields.
function buildHandlerInput(
  toolId: SupportedWriteToolId,
  authenticatedUserId: string,
  request: WriteRuntimeRequest,
): Record<string, unknown> {
  if (toolId === "tasks.complete") {
    return {
      userId: authenticatedUserId,
      taskId: request.step?.targetId?.trim(),
    };
  }

  const target = request.target;
  if (toolId === "github.issues.comment") {
    return {
      repo: target?.repo,
      issueNumber: target?.issueNumber,
      body: target?.commentBody,
    };
  }

  return {
    repo: target?.repo,
    issueNumber: target?.issueNumber,
    ...(target?.updateTitle !== undefined ? { title: target.updateTitle } : {}),
    ...(target?.updateBody !== undefined ? { body: target.updateBody } : {}),
    ...(target?.updateLabels !== undefined ? { labels: target.updateLabels } : {}),
  };
}

export function clearWriteRuntimeRequestHistory() {
  completedRequestIds.clear();
}

export async function runWriteTool(
  request: WriteRuntimeRequest,
  dependencies: Partial<WriteRuntimeDependencies> = {},
): Promise<WriteRuntimeResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  const startedAt = request.requestedAt ?? timestamp(request.currentTime ?? deps.now());

  if (!request.requestId?.trim()) {
    return blocked(request, "failed", "Write request is missing an id.", startedAt);
  }

  if (completedRequestIds.has(request.requestId)) {
    return blocked(request, "duplicate_request", safeSummaryFor("duplicate_request"), startedAt, request.toolResolution?.toolId);
  }
  completedRequestIds.add(request.requestId);

  const resolved = validateResolvedTool(request, deps);
  if (resolved.status || !resolved.tool || !resolved.toolId) {
    return blocked(request, resolved.status ?? "unresolved", safeSummaryFor(resolved.status ?? "unresolved"), startedAt, request.toolResolution?.toolId);
  }

  if (!writeTargetIsValid(request, resolved.toolId)) {
    return blocked(request, "invalid_input", "Write action requires an exact target.", startedAt, resolved.toolId);
  }

  const approvalStatus = validateApprovalBoundary(request, resolved.toolId);
  if (approvalStatus) {
    return blocked(request, approvalStatus, safeSummaryFor(approvalStatus), startedAt, resolved.toolId);
  }

  const authenticatedUserId = await deps.getAuthenticatedUserId();
  if (!authenticatedUserId?.trim()) {
    return blocked(request, "failed", "Authenticated runtime user is required.", startedAt, resolved.toolId);
  }

  const policyDecision = evaluateExecutionPolicy({
    step: request.step,
    tool: resolved.tool,
    approval: request.approval,
    currentTime: deps.now(),
    context: request.executionContext?.policyContext,
  });

  if (!policyDecision.allowed) {
    const completedAt = timestamp(deps.now());
    const terminal = appendAuditSafely(
      deps,
      createAuditRecord(request, "policy_denied", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "POLICY_DENIED",
      }),
    );
    const status = statusFromPolicy(policyDecision.status);
    return {
      ...blocked(request, status, safeSummaryFor(status), startedAt, resolved.toolId),
      completedAt,
      durationMs: duration(startedAt, completedAt),
      auditCorrelation: {
        requestId: request.requestId,
        terminalAuditId: terminal?.auditId,
      },
    };
  }

  const started = appendAuditSafely(
    deps,
    createAuditRecord(request, "started", startedAt, {
      policyDecision,
    }),
  );

  const handler = deps.getWriteHandlerByToolId(resolved.toolId);
  if (
    !handler ||
    handler.toolId !== resolved.toolId ||
    handler.mode !== "write" ||
    handler.readOnly !== false ||
    handler.externalEffect !== true ||
    handler.requiresVerification !== true
  ) {
    const completedAt = timestamp(deps.now());
    const terminal = appendAuditSafely(
      deps,
      createAuditRecord(request, "handler_not_found", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "HANDLER_NOT_FOUND",
      }),
    );
    return {
      ...blocked(request, "handler_not_found", "No supported write handler is registered for this tool.", startedAt, resolved.toolId),
      completedAt,
      durationMs: duration(startedAt, completedAt),
      auditCorrelation: {
        requestId: request.requestId,
        startedAuditId: started?.auditId,
        terminalAuditId: terminal?.auditId,
      },
    };
  }

  const handlerInput = buildHandlerInput(resolved.toolId, authenticatedUserId.trim(), request);
  const validation = handler.validateInput(handlerInput, resolved.tool.inputSchema);
  if (!validation.valid) {
    const completedAt = timestamp(deps.now());
    const terminal = appendAuditSafely(
      deps,
      createAuditRecord(request, "invalid_input", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "INVALID_INPUT",
        handler,
      }),
    );
    return {
      ...blocked(request, "invalid_input", "Write handler input failed validation.", startedAt, resolved.toolId),
      completedAt,
      durationMs: duration(startedAt, completedAt),
      auditCorrelation: {
        requestId: request.requestId,
        startedAuditId: started?.auditId,
        terminalAuditId: terminal?.auditId,
      },
    };
  }

  const handlerResult = await executeWithTimeout(handler, handlerInput, {
    ...request.executionContext,
    currentTime: request.executionContext?.currentTime ?? startedAt,
  });
  const completedAt = timestamp(deps.now());
  const executionStatus: ExecutionStatus = handlerResult.timedOut
    ? "timeout"
    : executionStatusFromHandler(handlerResult);
  const writeStatus: WriteRuntimeStatus = handlerResult.timedOut
    ? "timeout"
    : writeStatusFromHandler(handlerResult);
  const terminal = appendAuditSafely(
    deps,
    createAuditRecord(request, executionStatus, startedAt, {
      completedAt,
      policyDecision,
      errorCode: handlerResult.error?.code,
      handler,
      data: handlerResult.auditMetadata,
    }),
  );

  const executionResult = executionResultFor(
    request,
    policyDecision,
    handler,
    handlerResult,
    startedAt,
    completedAt,
  );

  let reflection: AgentReflectionResult | undefined;
  try {
    reflection = deps.processReflection({
      executionResult,
      step: request.step as WorkspacePlanStep,
      toolResolution: request.toolResolution as ToolResolutionResult,
      workspace: request.executionContext?.workspace,
      auditRecords: getExecutionAuditRecordsByRequestId(request.requestId),
      reflectedAt: deps.now(),
      storage: request.reflectionStorage,
    }).reflection;
  } catch {
    reflection = undefined;
  }

  return {
    requestId: request.requestId,
    stepId: request.step?.id ?? "unknown-step",
    toolId: resolved.toolId,
    status: writeStatus,
    success: writeStatus === "success",
    verified: handlerResult.auditMetadata.verified === true,
    alreadyCompleted: handlerResult.auditMetadata.alreadyCompleted,
    reflection,
    auditCorrelation: {
      requestId: request.requestId,
      startedAuditId: started?.auditId,
      terminalAuditId: terminal?.auditId,
    },
    safeSummary: safeSummaryFor(writeStatus, resolved.toolId, handlerResult.auditMetadata.alreadyCompleted),
    startedAt,
    completedAt,
    durationMs: duration(startedAt, completedAt),
    runtimeVersion: WRITE_RUNTIME_VERSION,
  };
}
