import {
  appendExecutionAuditRecord,
  getExecutionAuditRecordsByRequestId,
} from "./executionAudit";
import { EXECUTION_AUDIT_VERSION } from "./executionAudit";
import { compareRiskLevels, evaluateExecutionPolicy } from "./executionPolicy";
import {
  assertIntentExecutionReady,
  bindApprovalToIntent,
  claimExecutionIntent,
  createCanonicalExecutionIntent,
  createExecutionAttempt,
  createExecutionResultReference,
  createIntentPolicyDecision,
  ExecutionIntentError,
  getStoredCanonicalExecutionIntent,
  resolveExecutionIntentApproval,
} from "./executionIntent";
import { defaultExecutionAuthorityContext, type ExecutionAuthorityContext } from "./authority";
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
  WorkspaceApprovalRiskLevel,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";
import {
  findWriteIntentDescriptorByToolId,
  writeIntentRegistry,
} from "../../../shared/writeIntentRegistry";

export const WRITE_RUNTIME_VERSION = "write-runtime-v1" as const;
// Task 23: the four task/calendar tool ids are spliced in from the shared
// registry, in its own array order, at the exact position the hand-written
// literals used to occupy.
export const SUPPORTED_WRITE_TOOL_IDS = Object.freeze([
  "tasks.complete",
  ...writeIntentRegistry.map((entry) => entry.toolId),
  "github.issues.comment",
  "github.issues.update",
  "github.files.update",
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
  title?: string;
  notes?: string;
  dueDate?: string | null;
  // Task 22 (calendar write slice).
  eventTitle?: string;
  eventReference?: string;
  eventId?: string;
  start?: string;
  end?: string;
  repo?: string;
  issueNumber?: number;
  commentBody?: string;
  updateTitle?: string;
  updateBody?: string;
  updateLabels?: string[];
  // EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
  // No baseBlobSha/baseCommitSha/proposedContentDigest/riskLevel/expiresAt --
  // those are never trusted request fields; the Worker sources them from its
  // own server-verifiable approval record (ADR-0005 Decision 7).
  proposalId?: string;
  path?: string;
  proposedContent?: string;
  commitMessage?: string;
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
  executionIntent?: {
    intentId: string;
    canonicalHash: string;
    policyDecisionId?: string;
    approvalId?: string;
    attemptId?: string;
    resultStatus?: string;
  };
}

export interface WriteRuntimeDependencies {
  authorityContext: ExecutionAuthorityContext;
  getToolById(toolId: string): AgentToolDefinition | undefined;
  getWriteHandlerByToolId(toolId: string): AgentWriteToolHandler | undefined;
  getStoredCanonicalExecutionIntent(intentId: string | undefined): ReturnType<typeof getStoredCanonicalExecutionIntent>;
  resolveExecutionIntentApproval(approvalId: string | undefined): ReturnType<typeof resolveExecutionIntentApproval>;
  claimExecutionIntent(intentId: string): boolean;
  appendExecutionAuditRecord(record: ExecutionAuditRecord): ExecutionAuditRecord;
  processReflection(input: Parameters<typeof processReadOnlyReflection>[0]): ReturnType<typeof processReadOnlyReflection>;
  now(): Date;
}

const completedRequestIds = new Set<string>();

const defaultDependencies: WriteRuntimeDependencies = {
  authorityContext: defaultExecutionAuthorityContext,
  getToolById,
  getWriteHandlerByToolId,
  getStoredCanonicalExecutionIntent,
  resolveExecutionIntentApproval,
  claimExecutionIntent,
  appendExecutionAuditRecord,
  processReflection: processReadOnlyReflection,
  now: () => new Date(),
};

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
// Task 23: the four task/calendar cases now read their value from the
// shared registry (entry.capability -- e.g. calendar.create_event's
// "schedule", matching calendarTools.ts's own capability field, an
// asymmetry the registry preserves as data rather than normalizing) instead
// of repeating it here; tasks.complete/github.* are outside this task's
// scope and stay literal.
function expectedCapabilityForToolId(toolId: SupportedWriteToolId): AgentToolCapability {
  switch (toolId) {
    case "tasks.complete":
      return "complete";
    case "tasks.create":
      return findWriteIntentDescriptorByToolId(toolId)!.capability;
    case "tasks.update":
      return findWriteIntentDescriptorByToolId(toolId)!.capability;
    case "calendar.create_event":
      return findWriteIntentDescriptorByToolId(toolId)!.capability;
    case "calendar.update_event":
      return findWriteIntentDescriptorByToolId(toolId)!.capability;
    case "github.issues.comment":
      return "create";
    case "github.issues.update":
      return "update";
    case "github.files.update":
      return "update";
  }
}

// Same shape of bug as the capability check above: the step's actionType/
// domain combination is specific to each write tool, not just tasks.complete.
// Task 23: the four task/calendar cases now read domain/action from the
// shared registry.
function expectedStepShapeForToolId(
  toolId: SupportedWriteToolId,
): { actionType: WorkspacePlanStep["actionType"]; domain: WorkspacePlanStep["domain"] } {
  switch (toolId) {
    case "tasks.complete":
      return { actionType: "complete", domain: "tasks" };
    case "tasks.create":
    case "tasks.update":
    case "calendar.create_event":
    case "calendar.update_event": {
      const entry = findWriteIntentDescriptorByToolId(toolId)!;
      return { actionType: entry.action, domain: entry.domain };
    }
    case "github.issues.comment":
      return { actionType: "create", domain: "github" };
    case "github.issues.update":
      return { actionType: "update", domain: "github" };
    case "github.files.update":
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
    if (toolId === "github.files.update") return "File updated.";
    // Task 23: the four task/calendar summaries come from the shared registry.
    const writeEntry = toolId ? findWriteIntentDescriptorByToolId(toolId) : undefined;
    if (writeEntry) return writeEntry.successSummary;
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

// EPIC-08 Slice 2 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Exported (not just used internally) so the risk-comparison fix below can be
// unit tested directly against a required risk level higher than any
// currently-registered write tool uses, without needing to register a real
// high-risk tool -- see writeRuntime.test.ts's "high-risk code-tool" tests.
//
// This used to hardcode `approval.riskLevel !== "medium"`, which happened to
// work only because every currently-supported write tool's registered
// riskLevel is exactly "medium". A future write tool with a higher registered
// risk (e.g. a code-mutation tool) would have required an approval whose
// riskLevel is the exact string "medium" -- rejecting a "high" approval,
// which is strictly *more* authorization than required. executionPolicy.ts's
// own approval-risk check already compared with >=; this boundary did not.
export function validateApprovalBoundary(
  request: WriteRuntimeRequest,
  toolId: string,
  requiredRiskLevel: WorkspaceApprovalRiskLevel,
) {
  const approval = request.approval;
  const step = request.step;
  if (!approval) return "approval_required";
  if (approval.status === "rejected") return "rejected";
  if (approval.status !== "approved") return "approval_required";
  if (!step?.id || approval.stepId !== step.id) return "approval_required";
  if (!step.targetId || approval.targetId !== step.targetId) return "approval_required";
  if (approval.toolId !== toolId) return "approval_required";
  if (approval.approvalScope !== "single_step") return "approval_required";
  if (compareRiskLevels(approval.riskLevel, requiredRiskLevel) < 0) return "approval_required";
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

// Task 23: tasks.create/calendar.create_event's bespoke field checks now
// come from the shared registry's createRequiredTargetFields (['title'] /
// ['eventTitle', 'start'] respectively, same fields/same non-empty-string
// check as before). tasks.update/calendar.update_event have no
// createRequiredTargetFields (matching their pre-refactor behaviour, which
// never had a bespoke check either) and fall through to the same generic
// step.targetId check every other write tool already used.
function writeTargetIsValid(request: WriteRuntimeRequest, toolId: SupportedWriteToolId) {
  const expected = expectedStepShapeForToolId(toolId);
  const writeEntry = findWriteIntentDescriptorByToolId(toolId);
  if (writeEntry?.createRequiredTargetFields) {
    const target = request.target as Record<string, unknown> | null | undefined;
    return request.step?.actionType === expected.actionType &&
      request.step.domain === expected.domain &&
      writeEntry.createRequiredTargetFields.every((field) => {
        const value = target?.[field];
        return typeof value === "string" && value.trim().length > 0;
      });
  }
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
  runtimeActorId: string,
  request: WriteRuntimeRequest,
): Record<string, unknown> {
  if (toolId === "tasks.complete") {
    return {
      userId: runtimeActorId,
      taskId: request.step?.targetId?.trim(),
    };
  }

  // Task 23: the four task/calendar handler-input shapes come from the
  // shared registry's buildHandlerInput hook (ported verbatim from the
  // per-toolId branches this replaced).
  const writeEntry = findWriteIntentDescriptorByToolId(toolId);
  if (writeEntry) {
    return writeEntry.buildHandlerInput({
      actorId: runtimeActorId,
      targetId: request.step?.targetId?.trim(),
      target: (request.target as Record<string, unknown> | null | undefined) ?? {},
    });
  }

  const target = request.target;
  if (toolId === "github.issues.comment") {
    return {
      repo: target?.repo,
      issueNumber: target?.issueNumber,
      body: target?.commentBody,
    };
  }

  if (toolId === "github.files.update") {
    return {
      proposalId: target?.proposalId,
      repo: target?.repo,
      path: target?.path,
      proposedContent: target?.proposedContent,
      ...(target?.commitMessage !== undefined ? { commitMessage: target.commitMessage } : {}),
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

function shouldUseExecutionIntentLifecycle(toolId: SupportedWriteToolId) {
  return toolId === "tasks.complete";
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

  const approvalStatus = validateApprovalBoundary(request, resolved.toolId, resolved.tool.riskLevel);
  if (approvalStatus) {
    return blocked(request, approvalStatus, safeSummaryFor(approvalStatus), startedAt, resolved.toolId);
  }

  let trustedActorId: string | undefined;
  try {
    trustedActorId = (await deps.authorityContext.getAuthenticatedActor())?.id.trim();
  } catch {
    trustedActorId = undefined;
  }
  if (!trustedActorId) {
    return blocked(request, "failed", "Authenticated runtime user is required.", startedAt, resolved.toolId);
  }
  const actorId = trustedActorId;

  let lifecycleIntent:
    | Awaited<ReturnType<typeof createCanonicalExecutionIntent>>
    | undefined;
  let lifecyclePolicy:
    | ReturnType<typeof createIntentPolicyDecision>
    | undefined;
  let lifecycleApproval:
    | ReturnType<typeof bindApprovalToIntent>
    | undefined;
  let lifecycleAttempt:
    | ReturnType<typeof createExecutionAttempt>
    | undefined;
  let canonicalHandlerInput: Record<string, unknown> | undefined;

  if (shouldUseExecutionIntentLifecycle(resolved.toolId)) {
    try {
      const candidateArguments = {
        taskId: request.step.targetId?.trim(),
      };
      const requestIntent = await createCanonicalExecutionIntent({
        candidate: {
          proposedToolId: resolved.toolId,
          proposedOperation: request.step.actionType,
          proposedArguments: candidateArguments,
          sourceProposalReference: request.step.id,
        },
        tool: resolved.tool,
        step: request.step,
        actorId,
        scopeId: `user:${actorId}`,
        operation: request.step.actionType,
        arguments: candidateArguments,
        sourceProposalReference: request.step.id,
        idempotencyKey: request.requestId,
        createdAt: startedAt,
      });
      const approvalId = request.approval?.executionIntentApprovalId;
      const storedApproval = deps.resolveExecutionIntentApproval(approvalId);
      if (!storedApproval) {
        return blocked(request, "approval_required", "Write action requires server-owned execution intent approval.", startedAt, resolved.toolId);
      }
      const storedIntent = deps.getStoredCanonicalExecutionIntent(storedApproval.intentId);
      if (!storedIntent) {
        return blocked(request, "approval_required", "Approved execution intent was not found.", startedAt, resolved.toolId);
      }
      const currentScopeId = await deps.authorityContext.resolveAuthoritativeScope({ actor: { id: actorId }, step: request.step });
      if (!currentScopeId?.trim()) {
        return blocked(request, "approval_required", "Runtime authority scope could not be validated.", startedAt, resolved.toolId);
      }
      if (
        storedIntent.intentId !== requestIntent.intentId ||
        storedIntent.canonicalHash !== requestIntent.canonicalHash ||
        storedIntent.actorId !== actorId ||
        storedApproval.actorId !== actorId ||
        storedIntent.scopeId !== currentScopeId.trim() ||
        storedIntent.toolId !== resolved.toolId ||
        storedIntent.operation !== request.step.actionType ||
        storedIntent.targetScope.targetId !== request.step.targetId?.trim()
      ) {
        return blocked(request, "approval_required", "Run request does not match the approved execution intent.", startedAt, resolved.toolId);
      }
      lifecycleIntent = storedIntent;
      lifecycleApproval = bindApprovalToIntent({
        intent: lifecycleIntent,
        approval: storedApproval,
        actorId,
        now: deps.now(),
      });
      canonicalHandlerInput = {
        userId: actorId,
        ...lifecycleIntent.normalizedArguments,
      };
    } catch (caught) {
      const summary = caught instanceof ExecutionIntentError
        ? caught.message
        : "Execution intent canonicalization failed.";
      return blocked(request, "policy_denied", summary, startedAt, resolved.toolId);
    }
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

  if (lifecycleIntent && lifecycleApproval) {
    try {
      lifecyclePolicy = createIntentPolicyDecision(lifecycleIntent, policyDecision);
      assertIntentExecutionReady({
        intent: lifecycleIntent,
        policyDecision: lifecyclePolicy,
        approvalBinding: lifecycleApproval,
        now: deps.now(),
      });
    } catch (caught) {
      const status = caught instanceof ExecutionIntentError && caught.code === "APPROVAL_REVOKED"
        ? "rejected"
        : "approval_required";
      const summary = caught instanceof ExecutionIntentError
        ? caught.message
        : safeSummaryFor(status);
      return blocked(request, status, summary, startedAt, resolved.toolId);
    }
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

  const handlerInput = canonicalHandlerInput ?? buildHandlerInput(resolved.toolId, actorId, request);
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

  if (lifecycleIntent) {
    if (!deps.claimExecutionIntent(lifecycleIntent.intentId)) {
      return blocked(request, "duplicate_request", safeSummaryFor("duplicate_request"), startedAt, resolved.toolId);
    }
    lifecycleAttempt = createExecutionAttempt({
      intent: lifecycleIntent,
      attemptId: request.requestId,
      startedAt,
      runtimeTarget: resolved.toolId,
    });
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
  if (lifecycleIntent && lifecycleAttempt && lifecyclePolicy) {
    const resultReference = createExecutionResultReference({
      intent: lifecycleIntent,
      attempt: lifecycleAttempt,
      status: writeStatus === "success" ? "succeeded" : "failed",
      completedAt,
      resultReference: { requestId: request.requestId, toolId: resolved.toolId },
      errorCode: handlerResult.error?.code,
    });
    executionResult.metadata.executionIntent = {
      intentId: lifecycleIntent.intentId,
      canonicalHash: lifecycleIntent.canonicalHash,
      policyDecisionId: lifecyclePolicy.decisionId,
      attemptId: lifecycleAttempt.attemptId,
      resultStatus: resultReference.status,
    };
  }

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
    ...(lifecycleIntent
      ? {
          executionIntent: {
            intentId: lifecycleIntent.intentId,
            canonicalHash: lifecycleIntent.canonicalHash,
            policyDecisionId: lifecyclePolicy?.decisionId,
            approvalId: lifecycleApproval?.approvalId,
            attemptId: lifecycleAttempt?.attemptId,
            resultStatus: writeStatus === "success" ? "succeeded" : "failed",
          },
        }
      : {}),
  };
}
