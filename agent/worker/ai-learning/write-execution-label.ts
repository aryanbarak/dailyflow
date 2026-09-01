// ALF-1A correction (item 5): the auto-write execution lane's outcome
// statuses, and the single, tested source of truth for whether a given
// outcome represents an actual production clarification request.
//
// 'provider_unavailable' means the AI provider used to resolve a title
// was unreachable -- production never asked the user a clarifying
// question in that case; it returned an honest "the assistant is
// temporarily unavailable" reply instead (see index.ts's
// PROVIDER_UNAVAILABLE_WRITE_REPLY). No clarification flow was ever
// shown, so this must never be captured as requiresClarification=true.
// Only 'clarify' represents a genuine case where the deterministic parser
// itself asked the user a follow-up question.
export type WriteExecutionStatus = 'executed' | 'clarify' | 'failed' | 'provider_unavailable'

export function requiresClarificationForWriteExecutionStatus(status: WriteExecutionStatus): boolean {
  return status === 'clarify'
}
