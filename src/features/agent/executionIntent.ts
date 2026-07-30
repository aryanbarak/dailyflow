import type { WorkspaceApprovalRiskLevel, WorkspaceApprovalScope, WorkspacePlanStep, WorkspaceStepApproval } from "../workspace/workspaceTypes";
import type { ExecutionPolicyDecision } from "./toolTypes";
import type { AgentToolDefinition, AgentToolSchemaField } from "./toolTypes";

export const EXECUTION_INTENT_CANONICAL_VERSION = "execution-intent-canonical-v1" as const;
export const EXECUTION_INTENT_HASH_ALGORITHM = "SHA-256" as const;

export type IntentCandidate = Readonly<{
  proposedToolId?: string;
  proposedOperation?: string;
  proposedArguments?: Record<string, unknown>;
  sourceProposalReference?: string;
  explanation?: string;
}>;

export type ExecutionIntentState =
  | "candidate"
  | "canonicalized"
  | "policy_allowed"
  | "policy_denied"
  | "approval_pending"
  | "approval_bound"
  | "execution_ready"
  | "executing"
  | "succeeded"
  | "failed"
  | "denied"
  | "expired"
  | "revoked";

export type CanonicalExecutionIntent = Readonly<{
  intentId: string;
  intentVersion: typeof EXECUTION_INTENT_CANONICAL_VERSION;
  actorId: string;
  scopeId: string;
  toolId: string;
  operation: string;
  normalizedArguments: Record<string, unknown>;
  targetScope: Record<string, string>;
  riskClass: WorkspaceApprovalRiskLevel;
  approvalRequirement: WorkspaceApprovalScope;
  createdAt: string;
  expiresAt?: string;
  idempotencyKey?: string;
  sourceProposalReference?: string;
  canonicalHash: string;
  hashAlgorithm: typeof EXECUTION_INTENT_HASH_ALGORITHM;
  state: "canonicalized";
}>;

export type IntentPolicyDecision = Readonly<{
  decisionId: string;
  intentId: string;
  canonicalHash: string;
  outcome: "allowed" | "denied" | "approval_required";
  reasonCodes: string[];
  evaluatedAt: string;
  policyVersion: ExecutionPolicyDecision["policyVersion"];
}>;

export type IntentApprovalBinding = Readonly<{
  approvalId: string;
  intentId: string;
  canonicalHash: string;
  canonicalizationVersion: typeof EXECUTION_INTENT_CANONICAL_VERSION;
  hashAlgorithm: typeof EXECUTION_INTENT_HASH_ALGORITHM;
  actorId: string;
  scope: WorkspaceApprovalScope;
  approvedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}>;

export type ExecutionAttempt = Readonly<{
  attemptId: string;
  intentId: string;
  canonicalHash: string;
  startedAt: string;
  completedAt?: string;
  status: "executing" | "succeeded" | "failed" | "denied" | "expired" | "revoked";
  runtimeTarget: string;
}>;

export type ExecutionResultReference = Readonly<{
  intentId: string;
  attemptId: string;
  status: "succeeded" | "failed" | "denied" | "expired" | "revoked";
  resultReference?: Record<string, unknown>;
  errorCode?: string;
  completedAt: string;
}>;

export type ExecutionIntentErrorCode =
  | "UNKNOWN_TOOL"
  | "UNSUPPORTED_OPERATION"
  | "MALFORMED_ARGUMENTS"
  | "MALFORMED_TARGET"
  | "TRUSTED_FIELD_SUPPLIED"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REVOKED"
  | "INTENT_EXPIRED"
  | "ILLEGAL_TRANSITION"
  | "ATTEMPT_MISMATCH"
  | "DUPLICATE_RECORD";

export class ExecutionIntentError extends Error {
  readonly code: ExecutionIntentErrorCode;

  constructor(code: ExecutionIntentErrorCode, message: string) {
    super(message);
    this.name = "ExecutionIntentError";
    this.code = code;
  }
}

const trustedCandidateFields = new Set([
  "intentId",
  "intentVersion",
  "actorId",
  "scopeId",
  "toolId",
  "operation",
  "targetScope",
  "riskClass",
  "approvalRequirement",
  "createdAt",
  "expiresAt",
  "idempotencyKey",
  "canonicalHash",
  "state",
  "approval",
  "approved",
  "approvedAt",
  "policyOutcome",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const unsafeCanonicalKeys = new Set(["__proto__", "prototype", "constructor"]);

function stableSerializeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerializeValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerializeValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableSerialize(value: unknown): string {
  return stableSerializeValue(value);
}

function cloneJsonValue<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null) return value;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return value;
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new ExecutionIntentError("MALFORMED_ARGUMENTS", "Execution intent numbers must be finite.");
    }
    return value;
  }
  if (valueType === "undefined") {
    throw new ExecutionIntentError("MALFORMED_ARGUMENTS", "Execution intent values cannot be undefined.");
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new ExecutionIntentError("MALFORMED_ARGUMENTS", "Execution intent values cannot be cyclic.");
    seen.add(value);
    const cloned = value.map((entry) => cloneJsonValue(entry, seen)) as T;
    seen.delete(value);
    return cloned;
  }
  if (valueType === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ExecutionIntentError("MALFORMED_ARGUMENTS", "Execution intent objects must be plain JSON-compatible objects.");
    }
    if (seen.has(value as object)) {
      throw new ExecutionIntentError("MALFORMED_ARGUMENTS", "Execution intent values cannot be cyclic.");
    }
    seen.add(value as object);
    const source = value as Record<string, unknown>;
    const entries = Object.entries(source).map(([key, entry]) => {
      if (unsafeCanonicalKeys.has(key)) {
        throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${key} is not allowed in execution intent values.`);
      }
      return [key, cloneJsonValue(entry, seen)] as const;
    });
    seen.delete(value as object);
    return Object.fromEntries(entries) as T;
  }
  throw new ExecutionIntentError("MALFORMED_ARGUMENTS", "Execution intent values must be JSON-compatible.");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(cloneJsonValue(value));
}

function assertSameStableRecord(left: unknown, right: unknown) {
  return stableSerialize(left) === stableSerialize(right);
}

export async function sha256Hex(text: string) {
  if (!globalThis.crypto?.subtle) {
    throw new ExecutionIntentError("POLICY_DENIED", "Standard SHA-256 crypto API is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashStable(value: unknown) {
  return sha256Hex(stableSerialize(value));
}

function normalizeField(value: unknown, field: AgentToolSchemaField): unknown {
  const source = value ?? field.defaultValue;
  if (source === undefined || source === null) {
    if (field.required) throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} is required.`);
    return undefined;
  }

  if (field.type === "string" || field.type === "date") {
    if (typeof source !== "string") throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} must be a string.`);
    const normalized = source.trim();
    if (field.required && normalized.length === 0) {
      throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} is required.`);
    }
    return normalized;
  }

  if (field.type === "number") {
    if (typeof source !== "number" || !Number.isFinite(source)) {
      throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} must be a number.`);
    }
    return source;
  }

  if (field.type === "boolean") {
    if (typeof source !== "boolean") throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} must be a boolean.`);
    return source;
  }

  if (field.type === "array") {
    if (!Array.isArray(source)) throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} must be an array.`);
    return cloneJsonValue(source);
  }

  if (field.type === "object") {
    if (!isRecord(source)) throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} must be an object.`);
    const cloned = cloneJsonValue(source);
    return Object.fromEntries(Object.entries(cloned).sort(([left], [right]) => left.localeCompare(right)));
  }

  if (field.type === "enum") {
    if (typeof source !== "string" || !field.enumValues?.includes(source)) {
      throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `${field.name} must be a supported enum value.`);
    }
    return source;
  }

  return source;
}

export function normalizeArguments(
  input: Record<string, unknown>,
  schema: readonly AgentToolSchemaField[],
): Record<string, unknown> {
  const allowed = new Set(schema.map((field) => field.name));
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ExecutionIntentError("MALFORMED_ARGUMENTS", `Unsupported argument field: ${unknown[0]}.`);
  }

  const normalized: Record<string, unknown> = {};
  for (const field of schema) {
    const value = normalizeField(input[field.name], field);
    if (value !== undefined) normalized[field.name] = value;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function targetScopeFor(step: WorkspacePlanStep, normalizedArguments: Record<string, unknown>) {
  const targetId = step.targetId?.trim();
  if (["complete", "update", "delete", "send"].includes(step.actionType) && !targetId) {
    throw new ExecutionIntentError("MALFORMED_TARGET", "A bounded target is required for this operation.");
  }
  const targetScope: Record<string, string> = {
    domain: step.domain,
    stepId: step.id,
  };
  if (targetId) targetScope.targetId = targetId;
  if (typeof normalizedArguments.repo === "string") targetScope.repo = normalizedArguments.repo;
  if (typeof normalizedArguments.path === "string") targetScope.path = normalizedArguments.path;
  if (typeof normalizedArguments.issueNumber === "number") targetScope.issueNumber = String(normalizedArguments.issueNumber);
  if (typeof normalizedArguments.taskId === "string") targetScope.taskId = normalizedArguments.taskId;
  return Object.fromEntries(Object.entries(targetScope).sort(([left], [right]) => left.localeCompare(right)));
}

export async function createCanonicalExecutionIntent(input: {
  candidate: IntentCandidate;
  tool: AgentToolDefinition | null | undefined;
  step: WorkspacePlanStep;
  actorId: string;
  scopeId: string;
  operation: string;
  arguments: Record<string, unknown>;
  sourceProposalReference?: string;
  idempotencyKey?: string;
  createdAt: string;
  expiresAt?: string;
}): Promise<CanonicalExecutionIntent> {
  for (const key of Object.keys(input.candidate.proposedArguments ?? {})) {
    if (trustedCandidateFields.has(key)) {
      throw new ExecutionIntentError("TRUSTED_FIELD_SUPPLIED", `${key} cannot be supplied by a candidate.`);
    }
  }
  if (!input.tool?.enabled) throw new ExecutionIntentError("UNKNOWN_TOOL", "A known enabled tool is required.");
  if (input.candidate.proposedToolId && input.candidate.proposedToolId !== input.tool.id) {
    throw new ExecutionIntentError("UNKNOWN_TOOL", "Candidate tool does not match the resolved tool.");
  }
  if (input.candidate.proposedOperation && input.candidate.proposedOperation !== input.operation) {
    throw new ExecutionIntentError("UNSUPPORTED_OPERATION", "Candidate operation does not match the resolved operation.");
  }

  const normalizedArguments = immutableCopy(normalizeArguments(input.arguments, input.tool.inputSchema));
  const targetScope = immutableCopy(targetScopeFor(input.step, normalizedArguments));
  const payloadWithoutIdentity = immutableCopy({
    intentVersion: EXECUTION_INTENT_CANONICAL_VERSION,
    hashAlgorithm: EXECUTION_INTENT_HASH_ALGORITHM,
    actorId: input.actorId,
    scopeId: input.scopeId,
    toolId: input.tool.id,
    operation: input.operation,
    normalizedArguments,
    targetScope,
    riskClass: input.tool.riskLevel,
    approvalRequirement: input.tool.approvalScope,
    ...((input.sourceProposalReference ?? input.candidate.sourceProposalReference)
      ? { sourceProposalReference: input.sourceProposalReference ?? input.candidate.sourceProposalReference }
      : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
  const canonicalHash = await hashStable(payloadWithoutIdentity);
  const intentId = `intent:${canonicalHash.slice(0, 32)}`;

  return immutableCopy({
    ...payloadWithoutIdentity,
    intentId,
    createdAt: input.createdAt,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    canonicalHash,
    hashAlgorithm: EXECUTION_INTENT_HASH_ALGORITHM,
    state: "canonicalized" as const,
  });
}

export function transitionExecutionIntentState(
  from: ExecutionIntentState,
  to: ExecutionIntentState,
): ExecutionIntentState {
  const allowed: Record<ExecutionIntentState, ExecutionIntentState[]> = {
    candidate: ["canonicalized"],
    canonicalized: ["policy_allowed", "policy_denied", "expired"],
    policy_allowed: ["approval_pending", "approval_bound", "execution_ready", "expired"],
    policy_denied: ["denied"],
    approval_pending: ["approval_bound", "denied", "expired", "revoked"],
    approval_bound: ["execution_ready", "expired", "revoked"],
    execution_ready: ["executing", "expired", "revoked", "denied"],
    executing: ["succeeded", "failed"],
    succeeded: [],
    failed: [],
    denied: [],
    expired: [],
    revoked: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ExecutionIntentError("ILLEGAL_TRANSITION", `Illegal execution intent transition: ${from} -> ${to}.`);
  }
  return to;
}

export function createIntentPolicyDecision(
  intent: CanonicalExecutionIntent,
  policyDecision: ExecutionPolicyDecision,
): IntentPolicyDecision {
  return immutableCopy({
    decisionId: `policy:${intent.intentId}:${policyDecision.evaluatedAt}`,
    intentId: intent.intentId,
    canonicalHash: intent.canonicalHash,
    outcome: policyDecision.allowed ? "allowed" : policyDecision.status === "approval_required" ? "approval_required" : "denied",
    reasonCodes: policyDecision.checks.filter((check) => !check.passed).map((check) => check.id),
    evaluatedAt: policyDecision.evaluatedAt,
    policyVersion: policyDecision.policyVersion,
  });
}

export function bindApprovalToIntent(input: {
  intent: CanonicalExecutionIntent;
  approval: IntentApprovalBinding | null | undefined;
  actorId: string;
  now: Date;
}): IntentApprovalBinding {
  const { intent, approval } = input;
  if (!approval) {
    throw new ExecutionIntentError("APPROVAL_REQUIRED", "Approved consent is required.");
  }
  if (approval.revokedAt) throw new ExecutionIntentError("APPROVAL_REVOKED", "Approval binding is revoked.");
  if (approval.expiresAt && new Date(approval.expiresAt).getTime() <= input.now.getTime()) {
    throw new ExecutionIntentError("APPROVAL_EXPIRED", "Approval binding is expired.");
  }
  if (approval.intentId !== intent.intentId) {
    throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval was issued for another intent.");
  }
  if (approval.canonicalHash !== intent.canonicalHash) {
    throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval canonical hash does not match intent.");
  }
  if (approval.canonicalizationVersion !== intent.intentVersion) {
    throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval canonicalization version does not match intent.");
  }
  if (approval.hashAlgorithm !== intent.hashAlgorithm) {
    throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval hash algorithm does not match intent.");
  }
  if (approval.actorId !== input.actorId) {
    throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval was issued for another actor.");
  }
  if (approval.scope !== intent.approvalRequirement) {
    throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval scope does not match.");
  }

  return immutableCopy(approval);
}

export function assertIntentExecutionReady(input: {
  intent: CanonicalExecutionIntent;
  policyDecision: IntentPolicyDecision;
  approvalBinding?: IntentApprovalBinding;
  now: Date;
}) {
  if (input.intent.expiresAt && new Date(input.intent.expiresAt).getTime() <= input.now.getTime()) {
    throw new ExecutionIntentError("INTENT_EXPIRED", "Expired intent cannot execute.");
  }
  if (input.policyDecision.intentId !== input.intent.intentId || input.policyDecision.canonicalHash !== input.intent.canonicalHash) {
    throw new ExecutionIntentError("POLICY_DENIED", "Policy decision does not match intent.");
  }
  if (input.policyDecision.outcome === "denied") {
    throw new ExecutionIntentError("POLICY_DENIED", "Denied intent cannot execute.");
  }
  if (input.intent.approvalRequirement !== "view_only") {
    if (!input.approvalBinding) throw new ExecutionIntentError("APPROVAL_REQUIRED", "Approval binding is required.");
    if (input.approvalBinding.intentId !== input.intent.intentId || input.approvalBinding.canonicalHash !== input.intent.canonicalHash) {
      throw new ExecutionIntentError("APPROVAL_MISMATCH", "Approval binding does not match intent.");
    }
  }
}

const intentStore = new Map<string, CanonicalExecutionIntent>();
const approvalStore = new Map<string, IntentApprovalBinding>();
const claimedIntentIds = new Set<string>();

export function clearExecutionIntentLifecycleRegistry() {
  intentStore.clear();
  approvalStore.clear();
  claimedIntentIds.clear();
}

export function storeCanonicalExecutionIntent(intent: CanonicalExecutionIntent) {
  const stored = intentStore.get(intent.intentId);
  if (stored && !assertSameStableRecord(stored, intent)) {
    throw new ExecutionIntentError("DUPLICATE_RECORD", "Canonical intent ID already belongs to another record.");
  }
  const immutableIntent = immutableCopy(intent);
  intentStore.set(immutableIntent.intentId, immutableIntent);
  return immutableCopy(immutableIntent);
}

export function getStoredCanonicalExecutionIntent(intentId: string | undefined) {
  const stored = intentId ? intentStore.get(intentId) : undefined;
  return stored ? immutableCopy(stored) : undefined;
}

export async function issueExecutionIntentApproval(input: {
  intent: CanonicalExecutionIntent;
  actorId: string;
  approvedAt: string;
  approvalId?: string;
  expiresAt?: string;
}): Promise<IntentApprovalBinding> {
  storeCanonicalExecutionIntent(input.intent);
  const approval = immutableCopy({
    approvalId: input.approvalId ?? `approval:${(await hashStable({
      intentId: input.intent.intentId,
      actorId: input.actorId,
      approvedAt: input.approvedAt,
    })).slice(0, 32)}`,
    intentId: input.intent.intentId,
    canonicalHash: input.intent.canonicalHash,
    canonicalizationVersion: input.intent.intentVersion,
    hashAlgorithm: input.intent.hashAlgorithm,
    actorId: input.actorId,
    scope: input.intent.approvalRequirement,
    approvedAt: input.approvedAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
  const stored = approvalStore.get(approval.approvalId);
  if (stored && !assertSameStableRecord(stored, approval)) {
    throw new ExecutionIntentError("DUPLICATE_RECORD", "Approval ID already belongs to another record.");
  }
  approvalStore.set(approval.approvalId, approval);
  return immutableCopy(approval);
}

export function resolveExecutionIntentApproval(approvalId: string | undefined) {
  const stored = approvalId ? approvalStore.get(approvalId) : undefined;
  return stored ? immutableCopy(stored) : undefined;
}

export function revokeExecutionIntentApproval(approvalId: string, revokedAt: string) {
  const approval = approvalStore.get(approvalId);
  if (!approval) return undefined;
  const revoked = immutableCopy({ ...approval, revokedAt });
  approvalStore.set(approvalId, revoked);
  return immutableCopy(revoked);
}

export function claimExecutionIntent(intentId: string) {
  if (claimedIntentIds.has(intentId)) return false;
  claimedIntentIds.add(intentId);
  return true;
}

export function createExecutionAttempt(input: {
  intent: CanonicalExecutionIntent;
  attemptId: string;
  startedAt: string;
  runtimeTarget: string;
}): ExecutionAttempt {
  return immutableCopy({
    attemptId: input.attemptId,
    intentId: input.intent.intentId,
    canonicalHash: input.intent.canonicalHash,
    startedAt: input.startedAt,
    status: "executing",
    runtimeTarget: input.runtimeTarget,
  });
}

export function createExecutionResultReference(input: {
  intent: CanonicalExecutionIntent;
  attempt: ExecutionAttempt;
  status: ExecutionResultReference["status"];
  completedAt: string;
  resultReference?: Record<string, unknown>;
  errorCode?: string;
}): ExecutionResultReference {
  if (input.attempt.intentId !== input.intent.intentId || input.attempt.canonicalHash !== input.intent.canonicalHash) {
    throw new ExecutionIntentError("ATTEMPT_MISMATCH", "Execution result cannot attach to another intent or attempt.");
  }
  return immutableCopy({
    intentId: input.intent.intentId,
    attemptId: input.attempt.attemptId,
    status: input.status,
    ...(input.resultReference ? { resultReference: input.resultReference } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    completedAt: input.completedAt,
  });
}
