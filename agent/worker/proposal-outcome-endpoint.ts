// Task 40, ADR-0016 Slice 2: request-shape validation for
// POST /agent/proposal-outcome (the ask-lane's reporting mechanism named in
// ADR-0016 Decision item 7). Deliberately pure -- no fetch, no auth, no
// CORS, no env -- so it can be unit-tested directly without constructing a
// Request/Response or standing up the Worker dispatcher. The actual HTTP
// handler lives in index.ts, reusing that file's own requireAuth/
// corsHeaders/json exactly (not a copy), per this task's explicit
// instruction not to introduce a second, independent CORS mechanism the
// way github-integration.ts's GITHUB_ALLOWED_ORIGINS once did (task 32).
//
// user_id is intentionally NOT a field this module ever parses from the
// request body -- it is derived server-side from the authenticated bearer
// token by the caller (index.ts's requireAuth), the same convention every
// other endpoint in this Worker already follows. A body-supplied user_id
// would let one authenticated user write proposal-outcome rows under
// another user's identity.
//
// write_mode is likewise NOT accepted from the request body: this endpoint
// exists specifically for the ask-lane (ADR-0016), so write_mode is always
// 'ask', hardcoded by the caller -- a client cannot claim 'auto_executed'
// via this HTTP surface, which only ever makes sense as a direct byproduct
// of the Worker's own deterministic auto-write path recording in-process.

const MAX_INTENT_TYPE_LENGTH = 64
const MAX_TOOL_ID_LENGTH = 100
const MAX_REQUEST_ID_LENGTH = 200
const MAX_TARGET_FIELDS = 40
const MAX_TARGET_FIELD_NAME_LENGTH = 100

const ALLOWED_DOMAINS = new Set(['tasks', 'calendar', 'finance', 'github'])
// Deliberately narrower than the ledger's full outcome CHECK
// ('auto_executed' | 'approved' | 'rejected') -- see this file's header
// comment on write_mode above for why 'auto_executed' can never arrive via
// this HTTP surface.
const ALLOWED_OUTCOMES = new Set(['approved', 'rejected'])
const ALLOWED_RISK_LEVELS = new Set(['none', 'low', 'medium', 'high'])

export interface ProposalOutcomeRequestBody {
  requestId?: string
  intentType: string
  toolId: string
  domain: 'tasks' | 'calendar' | 'finance' | 'github'
  outcome: 'approved' | 'rejected'
  succeeded: boolean | null
  riskLevel?: 'none' | 'low' | 'medium' | 'high'
  targetFields: string[]
}

export type ProposalOutcomeRequestValidation =
  | { ok: true; value: ProposalOutcomeRequestBody }
  | { ok: false; error: string }

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined
}

export function parseProposalOutcomeRequestBody(raw: unknown): ProposalOutcomeRequestValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be an object.' }
  }
  const record = raw as Record<string, unknown>

  const intentType = boundedString(record.intentType, MAX_INTENT_TYPE_LENGTH)
  if (!intentType) return { ok: false, error: 'intentType is required.' }

  const toolId = boundedString(record.toolId, MAX_TOOL_ID_LENGTH)
  if (!toolId) return { ok: false, error: 'toolId is required.' }

  const domain = typeof record.domain === 'string' ? record.domain : ''
  if (!ALLOWED_DOMAINS.has(domain)) {
    return { ok: false, error: 'domain must be one of tasks, calendar, finance, github.' }
  }

  const outcome = typeof record.outcome === 'string' ? record.outcome : ''
  if (!ALLOWED_OUTCOMES.has(outcome)) {
    return { ok: false, error: 'outcome must be one of approved, rejected.' }
  }

  if (record.succeeded !== null && typeof record.succeeded !== 'boolean') {
    return { ok: false, error: 'succeeded must be a boolean or null.' }
  }
  // Mirrors the migration's own succeeded-requires-attempt CHECK
  // constraint: 'rejected' means nothing was attempted, so succeeded must
  // be null. Validated here too so a malformed request gets a clear 400
  // instead of an opaque, only-logged insert failure downstream.
  if (outcome === 'rejected' && record.succeeded !== null && record.succeeded !== undefined) {
    return { ok: false, error: 'succeeded must be null when outcome is rejected.' }
  }
  const succeeded = outcome === 'rejected' ? null : (record.succeeded as boolean | null | undefined) ?? null

  let riskLevel: ProposalOutcomeRequestBody['riskLevel']
  if (record.riskLevel !== undefined) {
    if (typeof record.riskLevel !== 'string' || !ALLOWED_RISK_LEVELS.has(record.riskLevel)) {
      return { ok: false, error: 'riskLevel must be one of none, low, medium, high.' }
    }
    riskLevel = record.riskLevel as ProposalOutcomeRequestBody['riskLevel']
  }

  if (!Array.isArray(record.targetFields)) {
    return { ok: false, error: 'targetFields must be an array.' }
  }
  if (record.targetFields.length > MAX_TARGET_FIELDS) {
    return { ok: false, error: 'targetFields has too many entries.' }
  }
  const targetFields: string[] = []
  for (const entry of record.targetFields) {
    const field = boundedString(entry, MAX_TARGET_FIELD_NAME_LENGTH)
    if (!field) return { ok: false, error: 'targetFields entries must be non-empty strings.' }
    targetFields.push(field)
  }

  const requestId = record.requestId !== undefined ? boundedString(record.requestId, MAX_REQUEST_ID_LENGTH) : undefined
  if (record.requestId !== undefined && !requestId) {
    return { ok: false, error: 'requestId must be a non-empty string when present.' }
  }

  return {
    ok: true,
    value: {
      requestId,
      intentType,
      toolId,
      domain: domain as ProposalOutcomeRequestBody['domain'],
      outcome: outcome as ProposalOutcomeRequestBody['outcome'],
      succeeded,
      riskLevel,
      targetFields,
    },
  }
}
