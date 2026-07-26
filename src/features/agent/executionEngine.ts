import {
  appendExecutionAuditRecord,
  clearExecutionAuditRecords,
  getExecutionAuditRecords,
} from "./executionAudit";
import { EXECUTION_AUDIT_VERSION } from "./executionAudit";
import { evaluateExecutionPolicy } from "./executionPolicy";
import { getHandlerByToolId } from "./handlers";
import { getToolById } from "./toolRegistry";
import type {
  AgentToolHandler,
  ExecutionEngineDependencies,
  ExecutionError,
  ExecutionRecord,
  ExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
} from "./executionTypes";
import type { ExecutionAuditMetadata, ExecutionAuditRecord, ExecutionAuditStatus } from "./executionAuditTypes";
import type { AgentToolDefinition, ExecutionPolicyDecision } from "./toolTypes";

export const EXECUTION_ENGINE_VERSION = "execution-engine-v1" as const;

const defaultDependencies: ExecutionEngineDependencies = {
  getToolById,
  getHandlerByToolId,
  now: () => new Date(),
  appendExecutionAuditRecord,
};

function duration(startedAt: string, completedAt: string) {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function error(code: string, message: string, retryable = false, details?: Record<string, unknown>): ExecutionError {
  return {
    code,
    message,
    retryable,
    details,
  };
}

function appendAuditSafely(
  deps: ExecutionEngineDependencies,
  record: ExecutionAuditRecord,
) {
  try {
    deps.appendExecutionAuditRecord(record);
  } catch {
    // Audit failures must not block execution result delivery.
  }
}

function auditId(requestId: string, status: ExecutionAuditStatus, timestamp: string) {
  return `audit:${requestId}:${status}:${timestamp}`;
}

function createAuditRecord(
  request: ExecutionRequest,
  status: ExecutionAuditStatus,
  startedAt: string,
  options: {
    policyDecision?: ExecutionPolicyDecision;
    completedAt?: string;
    errorCode?: string;
    handler?: AgentToolHandler;
    retryable?: boolean;
    data?: unknown;
  } = {},
): ExecutionAuditRecord {
  const completedAt = options.completedAt;
  const policyDecision = options.policyDecision;
  const metadata: ExecutionAuditMetadata = {
    redacted: true,
    handlerId: options.handler?.toolId,
    retryable: options.retryable,
  };

  if (options.data && typeof options.data === "object") {
    metadata.resultShape = Array.isArray(options.data) ? "array" : "object";
    const values = Object.values(options.data as Record<string, unknown>);
    const arrayValue = values.find(Array.isArray);
    if (arrayValue) metadata.itemCount = arrayValue.length;
  }

  return {
    auditId: auditId(request.requestId, status, completedAt ?? startedAt),
    requestId: request.requestId,
    stepId: request.step.id,
    toolId: request.toolId,
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
    executionVersion: EXECUTION_ENGINE_VERSION,
    policyVersion: policyDecision?.policyVersion ?? "execution-policy-v1",
    auditVersion: EXECUTION_AUDIT_VERSION,
    metadata,
  };
}

function result(
  request: ExecutionRequest,
  status: ExecutionStatus,
  policyDecision: ExecutionPolicyDecision,
  startedAt: string,
  completedAt: string,
  options: {
    data?: unknown;
    error?: ExecutionError;
    handler?: AgentToolHandler;
  } = {},
): ExecutionResult {
  const output: ExecutionResult = {
    requestId: request.requestId,
    stepId: request.step.id,
    toolId: request.toolId,
    status,
    success: status === "success",
    data: options.data,
    error: options.error,
    policyDecision,
    startedAt,
    completedAt,
    durationMs: duration(startedAt, completedAt),
    executionVersion: EXECUTION_ENGINE_VERSION,
    metadata: {
      readOnly: options.handler?.readOnly ?? false,
      handlerId: options.handler?.toolId,
      effectiveRiskLevel: policyDecision.effectiveRiskLevel,
    },
  };

  return output;
}

function isSupportedReadOnlyHandler(handler: AgentToolHandler) {
  return handler.readOnly === true;
}

function isSupportedReadOnlyTool(
  tool: AgentToolDefinition,
  policyDecision: ExecutionPolicyDecision,
) {
  return (
    tool.mode === "read" &&
    tool.externalEffect === false &&
    tool.reversible === true &&
    (policyDecision.effectiveRiskLevel === "none" ||
      policyDecision.effectiveRiskLevel === "low")
  );
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(error("TIMEOUT", "Handler execution timed out.", true));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function executeAgentTool(
  request: ExecutionRequest,
  dependencies: Partial<ExecutionEngineDependencies> = {},
): Promise<ExecutionResult> {
  const deps = { ...defaultDependencies, ...dependencies };
  const startedAt = deps.now().toISOString();
  appendAuditSafely(deps, createAuditRecord(request, "started", startedAt));

  const tool = deps.getToolById(request.toolId);
  const policyDecision = evaluateExecutionPolicy({
    step: request.step,
    tool,
    approval: request.approval,
    currentTime: deps.now(),
    context: request.context?.policyContext,
  });

  if (!tool) {
    const completedAt = deps.now().toISOString();
    appendAuditSafely(
      deps,
      createAuditRecord(request, "tool_not_found", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "TOOL_NOT_FOUND",
      }),
    );
    return result(request, "tool_not_found", policyDecision, startedAt, completedAt, {
      error: error("TOOL_NOT_FOUND", "Tool is not registered."),
    });
  }

  if (!policyDecision.allowed) {
    const completedAt = deps.now().toISOString();
    appendAuditSafely(
      deps,
      createAuditRecord(request, "policy_denied", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "POLICY_DENIED",
      }),
    );
    return result(request, "policy_denied", policyDecision, startedAt, completedAt, {
      error: error("POLICY_DENIED", "Execution policy denied this request.", false, {
        policyStatus: policyDecision.status,
      }),
    });
  }

  const handler = deps.getHandlerByToolId(request.toolId);
  if (!handler || !isSupportedReadOnlyHandler(handler) || !isSupportedReadOnlyTool(tool, policyDecision)) {
    const completedAt = deps.now().toISOString();
    appendAuditSafely(
      deps,
      createAuditRecord(request, "handler_not_found", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "HANDLER_NOT_FOUND",
      }),
    );
    return result(request, "handler_not_found", policyDecision, startedAt, completedAt, {
      error: error("HANDLER_NOT_FOUND", "No supported read-only handler is registered for this tool."),
    });
  }

  const validation = handler.validateInput(request.input, tool.inputSchema);
  if (!validation.valid) {
    const completedAt = deps.now().toISOString();
    appendAuditSafely(
      deps,
      createAuditRecord(request, "invalid_input", startedAt, {
        completedAt,
        policyDecision,
        errorCode: "INVALID_INPUT",
        handler,
      }),
    );
    return result(request, "invalid_input", policyDecision, startedAt, completedAt, {
      handler,
      error: error("INVALID_INPUT", "Tool input failed validation.", false, {
        errors: validation.errors,
      }),
    });
  }

  try {
    const data = await withTimeout(
      Promise.resolve(handler.execute(request.input, {
        ...request.context,
        currentTime: request.context?.currentTime ?? request.requestedAt,
      })),
      handler.timeoutMs,
    );
    const completedAt = deps.now().toISOString();
    appendAuditSafely(
      deps,
      createAuditRecord(request, "success", startedAt, {
        completedAt,
        policyDecision,
        handler,
        data,
      }),
    );
    return result(request, "success", policyDecision, startedAt, completedAt, {
      data,
      handler,
    });
  } catch (caught) {
    const completedAt = deps.now().toISOString();
    const normalizedError =
      typeof caught === "object" && caught && "code" in caught
        ? (caught as ExecutionError)
        : error("HANDLER_FAILED", "Handler execution failed.", false);
    const status = normalizedError.code === "TIMEOUT" ? "timeout" : "failed";
    appendAuditSafely(
      deps,
      createAuditRecord(request, status, startedAt, {
        completedAt,
        policyDecision,
        handler,
        errorCode: normalizedError.code,
        retryable: normalizedError.retryable,
      }),
    );
    return result(request, status, policyDecision, startedAt, completedAt, {
      handler,
      error: normalizedError,
    });
  }
}

export function getExecutionRecords(): ExecutionRecord[] {
  return getExecutionAuditRecords()
    .filter((record) => record.status !== "started")
    .slice(-100)
    .map((record) => ({
      requestId: record.requestId,
      stepId: record.stepId,
      toolId: record.toolId,
      status: record.status as ExecutionStatus,
      startedAt: record.startedAt,
      completedAt: record.completedAt ?? record.startedAt,
      durationMs: record.durationMs ?? 0,
      policyStatus: record.policyStatus,
      errorCode: record.errorCode,
    }));
}

export function clearExecutionRecords() {
  clearExecutionAuditRecords();
}
