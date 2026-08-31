// Chat V2 Slice 2A: the canonicalization primitives behind
// agent_tool_executions' hash-verified request -> approve -> execute
// lifecycle. Shared with shared/writeIntentRegistry.ts's own convention
// (see that file's SHARED-MODULE CONSTRAINT comment): this file is
// imported by BOTH the Cloudflare Worker (agent/worker/*.ts) and the
// frontend (src/*.ts), two independently bundled runtimes with no other
// shared module between them besides writeIntentRegistry.ts -- so, same
// rule: no Supabase client, no React, no DOM, no worker-only bindings.
// Only globalThis.crypto.subtle, which both runtimes provide.
//
// WHY THIS IS A NEW FILE rather than reusing
// src/features/agent/executionIntent.ts's own stableSerialize/sha256Hex:
// that module's canonical hash preimage also carries frontend-only
// concepts (riskClass/approvalRequirement sourced from AgentToolDefinition,
// scopeId from Workspace) that have no Worker-side equivalent, and the
// module holds significant additional in-memory state (intentStore/
// approvalStore/claimedIntentIds) that must never be pulled into a
// Worker's per-request lifecycle. Only the two genuinely pure, stateless
// primitives are reusable across both runtimes -- those live here.
// executionIntent.ts is untouched by this slice; tasks.complete's existing
// client-side lifecycle keeps using its own copy unmodified (see this
// slice's own report for why: not weakening or duplicating it, just not
// routing it through a second implementation of the same two functions).

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const unsafeCanonicalKeys = new Set(["__proto__", "prototype", "constructor"]);

// Deterministic, key-sorted JSON serialization -- identical construction to
// executionIntent.ts's own stableSerializeValue (same algorithm, verified
// against literal fixtures in this file's own test, not imported).
function stableSerializeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerializeValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (unsafeCanonicalKeys.has(key)) {
        throw new Error(`${key} is not allowed in a canonicalized execution value.`);
      }
    }
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerializeValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableSerialize(value: unknown): string {
  return stableSerializeValue(value);
}

// `crypto` (not `globalThis.crypto`): the Worker's ambient types
// (@cloudflare/workers-types) declare a bare global `crypto: Crypto`, not a
// `crypto` property on `typeof globalThis` -- this file must type-check
// under both the Worker's tsconfig and the frontend's, per the
// SHARED-MODULE CONSTRAINT above.
export async function sha256Hex(text: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error("Standard SHA-256 crypto API is unavailable.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ToolExecutionCanonicalInput {
  readonly actorId: string;
  readonly toolId: string;
  readonly domain: string;
  readonly action: string;
  readonly normalizedArguments: Record<string, unknown>;
  readonly targetId?: string;
}

// The full, order-independent preimage for a tool-execution intent. Every
// field that participates in "is this the SAME immutable action" belongs
// here; nothing display-only (session/chat correlation, timestamps) does --
// those live only as plain columns on agent_tool_executions, never inside
// the hash, so they can be attached/read without affecting identity.
function canonicalPreimage(input: ToolExecutionCanonicalInput): Record<string, unknown> {
  if (!isRecord(input.normalizedArguments)) {
    throw new Error("normalizedArguments must be a plain object.");
  }
  return {
    actorId: input.actorId,
    toolId: input.toolId,
    domain: input.domain,
    action: input.action,
    normalizedArguments: input.normalizedArguments,
    ...(input.targetId ? { targetId: input.targetId } : {}),
  };
}

export async function computeToolExecutionCanonicalHash(input: ToolExecutionCanonicalInput): Promise<string> {
  return sha256Hex(stableSerialize(canonicalPreimage(input)));
}

export function toolExecutionIntentId(canonicalHash: string): string {
  return `intent:${canonicalHash.slice(0, 32)}`;
}
