import type {
  ExecutionAuditMetadata,
  ExecutionAuditMetadataValue,
  ExecutionAuditRecord,
} from "./executionAuditTypes";

export const EXECUTION_AUDIT_VERSION = "execution-audit-v1" as const;
const MAX_AUDIT_RECORDS = 200;
const MAX_STRING_LENGTH = 160;
const MAX_METADATA_KEYS = 20;
const MAX_ARRAY_ITEMS = 10;
const MAX_DEPTH = 1;

const sensitiveKeyPattern = /token|secret|password|authorization|cookie|apikey|key/i;
const auditRecords: ExecutionAuditRecord[] = [];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function cloneRecord(record: ExecutionAuditRecord): ExecutionAuditRecord {
  return {
    ...record,
    metadata: sanitizeAuditMetadata(record.metadata),
  };
}

export function sanitizeIdentifier(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  return raw.split(/[?#]/)[0].slice(0, MAX_STRING_LENGTH);
}

export function sanitizeErrorCode(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = sanitizeIdentifier(value)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  return raw || undefined;
}

function sanitizeMetadataValue(
  value: unknown,
  depth: number,
): ExecutionAuditMetadataValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    // TS doesn't carry this narrowing (verified null/boolean/number) through to a
    // return checked against the recursive ExecutionAuditMetadataValue type --
    // a known compiler limitation with self-referential unions, not a real gap.
    return Number.isNaN(value) ? undefined : (value as ExecutionAuditMetadataValue);
  }

  if (typeof value === "string") {
    return sanitizeIdentifier(value);
  }

  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return undefined;
    const output = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeMetadataValue(item, depth + 1))
      .filter((item): item is ExecutionAuditMetadataValue => item !== undefined);
    return output;
  }

  if (isPlainObject(value)) {
    if (depth >= MAX_DEPTH) return undefined;
    const output: ExecutionAuditMetadata = {};
    for (const [key, nested] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
      if (sensitiveKeyPattern.test(key)) continue;
      const sanitized = sanitizeMetadataValue(nested, depth + 1);
      if (sanitized !== undefined) output[sanitizeIdentifier(key)] = sanitized;
    }
    return output;
  }

  return undefined;
}

export function sanitizeAuditMetadata(metadata: unknown): ExecutionAuditMetadata {
  if (!isPlainObject(metadata)) return { redacted: true };

  const output: ExecutionAuditMetadata = {};
  for (const [key, value] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    if (sensitiveKeyPattern.test(key)) continue;
    const sanitized = sanitizeMetadataValue(value, 0);
    if (sanitized !== undefined) output[sanitizeIdentifier(key)] = sanitized;
  }

  return {
    ...output,
    redacted: true,
  };
}

export function appendExecutionAuditRecord(record: ExecutionAuditRecord): ExecutionAuditRecord {
  const sanitized: ExecutionAuditRecord = {
    ...record,
    auditId: sanitizeIdentifier(record.auditId),
    requestId: sanitizeIdentifier(record.requestId),
    stepId: sanitizeIdentifier(record.stepId),
    toolId: sanitizeIdentifier(record.toolId),
    errorCode: sanitizeErrorCode(record.errorCode),
    metadata: sanitizeAuditMetadata(record.metadata),
  };

  auditRecords.push(sanitized);
  if (auditRecords.length > MAX_AUDIT_RECORDS) {
    auditRecords.splice(0, auditRecords.length - MAX_AUDIT_RECORDS);
  }

  return cloneRecord(sanitized);
}

export function getExecutionAuditRecords(): ExecutionAuditRecord[] {
  return auditRecords.map(cloneRecord);
}

export function getExecutionAuditRecordsByRequestId(requestId: string): ExecutionAuditRecord[] {
  const sanitizedRequestId = sanitizeIdentifier(requestId);
  return auditRecords
    .filter((record) => record.requestId === sanitizedRequestId)
    .map(cloneRecord);
}

export function getExecutionAuditRecordsByToolId(toolId: string): ExecutionAuditRecord[] {
  const sanitizedToolId = sanitizeIdentifier(toolId);
  return auditRecords
    .filter((record) => record.toolId === sanitizedToolId)
    .map(cloneRecord);
}

export function getLatestExecutionAuditRecord(): ExecutionAuditRecord | undefined {
  const latest = auditRecords[auditRecords.length - 1];
  return latest ? cloneRecord(latest) : undefined;
}

export function clearExecutionAuditRecords() {
  auditRecords.splice(0, auditRecords.length);
}
