// Chat Runtime Truth / Tool Timeline V1 -- the pure projection layer
// between the authoritative `agent_tool_executions` runtime rows and the
// one shared Chat execution card (ChatToolExecutionCard.tsx):
//
//   AgentToolExecutionRow  ->  ChatToolExecutionViewModel  ->  card
//
// Execution TRUTH lives exclusively in `agent_tool_executions` (see
// agent/worker/agent-tool-execution.ts's lifecycle header and the
// migration's own comments). This module never decides, advances, or
// stores lifecycle state -- it only shapes what the row already says into
// something renderable, plus the same shaping for the LIVE pre-row /
// in-flight states ChatPage tracks transiently around network operations
// ('requesting'/'approving'/'revoking'/'error'), so live and reconstructed
// cards render through one code path instead of two drifting ones.
//
// TRUTH DISTINCTION (slice section 12): `normalized_arguments` are the
// authoritative bound INPUTS of the action -- what was requested and (for
// an approved row) approved -- never proof those values were persisted.
// argumentLines below therefore render under a "Requested" label on the
// card, and a succeeded card's success claim comes ONLY from the row's own
// durable status, never from these lines.

import { formatDateTime } from "@/lib/date";

// The durable lifecycle statuses agent_tool_executions can hold -- must
// stay in sync with the migration's status CHECK constraint and the
// Worker's own ExecutionLifecycleStatus.
export type AgentToolExecutionLifecycleStatus =
  | "approval_pending"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "denied"
  | "expired"
  | "revoked"
  | "uncertain";

const LIFECYCLE_STATUSES: ReadonlySet<string> = new Set([
  "approval_pending", "approved", "executing", "succeeded", "failed", "denied", "expired", "revoked", "uncertain",
]);

export function isAgentToolExecutionLifecycleStatus(value: unknown): value is AgentToolExecutionLifecycleStatus {
  return typeof value === "string" && LIFECYCLE_STATUSES.has(value);
}

// The browser-side read model of one agent_tool_executions row, exactly as
// the owner-scoped SELECT returns it (agentToolExecutionReader.ts). Field
// names deliberately match the database columns one-to-one -- this is a
// projection of server truth, not a new client shape with its own
// interpretation layer.
export interface AgentToolExecutionRow {
  id: string;
  session_id: string | null;
  chat_message_id: string | null;
  request_id: string;
  tool_id: string;
  domain: string;
  action: string;
  normalized_arguments: Record<string, unknown>;
  status: AgentToolExecutionLifecycleStatus;
  created_at: string;
  approval_requested_at: string | null;
  approved_at: string | null;
  execution_started_at: string | null;
  completed_at: string | null;
  target_type: string | null;
  target_id: string | null;
  error_code: string | null;
}

// Card status = the nine durable lifecycle statuses, plus the client-only
// TRANSIENT states that exist only around an in-flight network operation
// ('requesting' before the initial requestExecution() resolves,
// 'approving'/'revoking' while that explicit user action is in flight) and
// one client-only failure state ('error': could not reach the Worker at
// all -- never a domain outcome). Once a durable row exists, presentation
// always reconciles back to the row's own status.
export type ChatToolExecutionStatus =
  | AgentToolExecutionLifecycleStatus
  | "requesting"
  | "approving"
  | "revoking"
  | "error";

export interface ChatToolExecutionViewModel {
  // Stable render key: the durable execution id when one exists, else the
  // request id (a live card before its requestExecution() call resolves).
  key: string;
  executionId?: string;
  requestId: string;
  chatMessageId: string | null;
  toolId: string;
  domain: string;
  action: string;
  status: ChatToolExecutionStatus;
  // arguments.title verbatim when present -- display headline only.
  title?: string;
  // The bound inputs, labelled -- see the TRUTH DISTINCTION note above.
  argumentLines: string[];
  // The Worker's own bounded outcome text for a terminal live result
  // (approve/request responses). Reconstructed rows have none -- the
  // Worker's reply text is not persisted on the row, and nothing here
  // fabricates one.
  resultReply?: string;
  errorCode: string | null;
  targetType: string | null;
  targetId: string | null;
  completedAt: string | null;
}

// Same labels-injection convention shared/writeIntentRegistry.ts's
// previewLines already uses, so this module needs no i18n dependency of
// its own.
export interface ExecutionPreviewLabels {
  title: string;
  due: string;
  reminder: string;
  notes: string;
  start: string;
  end: string;
}

// The exact line-building rules Chat V2 2B.2's pending card established
// (ChatPage.tsx's twoActionPendingPreviewLines, which now delegates here):
// dueDate/timeOfDay shown VERBATIM (a date-only string must never pass
// through `new Date()` at an approval boundary); dateTimeStart/dateTimeEnd
// are UTC ISO instants rendered via the same formatDateTime helper every
// other approval preview uses. tasks.update/calendar.update_event bind the
// same argument fields as their create siblings, so they share the same
// lines; tasks.complete binds no arguments at all (its target is the whole
// story) and gets none.
export function executionArgumentLines(
  toolId: string,
  args: Record<string, unknown>,
  labels: ExecutionPreviewLabels,
): string[] {
  const title = typeof args.title === "string" ? args.title : undefined;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  if (toolId === "tasks.create" || toolId === "tasks.update") {
    const dueDate = typeof args.dueDate === "string" ? args.dueDate : undefined;
    const timeOfDay = typeof args.timeOfDay === "string" ? args.timeOfDay : undefined;
    return [
      title ? `${labels.title}: ${title}` : null,
      dueDate ? `${labels.due}: ${dueDate}` : null,
      timeOfDay ? `${labels.reminder}: ${timeOfDay}` : null,
      notes ? `${labels.notes}: ${notes}` : null,
    ].filter((line): line is string => Boolean(line));
  }
  if (toolId === "calendar.create_event" || toolId === "calendar.update_event") {
    const dateTimeStart = typeof args.dateTimeStart === "string" ? args.dateTimeStart : undefined;
    const dateTimeEnd = typeof args.dateTimeEnd === "string" ? args.dateTimeEnd : undefined;
    return [
      title ? `${labels.title}: ${title}` : null,
      dateTimeStart ? `${labels.start}: ${formatDateTime(dateTimeStart)}` : null,
      dateTimeEnd ? `${labels.end}: ${formatDateTime(dateTimeEnd)}` : null,
      notes ? `${labels.notes}: ${notes}` : null,
    ].filter((line): line is string => Boolean(line));
  }
  // tasks.complete (and any future tool this projection does not know):
  // no argument lines rather than guessed ones.
  return [];
}

// One durable row -> one view model. Status comes from the row VERBATIM --
// never inferred from timestamps, targets, argument presence, or message
// prose (slice section 12's explicit prohibition).
export function projectExecutionRow(
  row: AgentToolExecutionRow,
  labels: ExecutionPreviewLabels,
): ChatToolExecutionViewModel {
  const args = row.normalized_arguments ?? {};
  return {
    key: row.id,
    executionId: row.id,
    requestId: row.request_id,
    chatMessageId: row.chat_message_id,
    toolId: row.tool_id,
    domain: row.domain,
    action: row.action,
    status: row.status,
    title: typeof args.title === "string" ? args.title : undefined,
    argumentLines: executionArgumentLines(row.tool_id, args, labels),
    errorCode: row.error_code,
    targetType: row.target_type,
    targetId: row.target_id,
    completedAt: row.completed_at,
  };
}

// Reload reconstruction (slice section 8): correlate this session's
// execution rows to the loaded chat messages, keyed by the message id each
// row's chat_message_id names. Rules:
//   - zero, one, or MANY rows per message -- each becomes its own
//     independent card, never collapsed into one synthetic status;
//   - deterministic ordering: created_at ascending, id as tiebreak;
//   - orphaned rows (chat_message_id null, or naming a message that is no
//     longer part of the loaded conversation -- chat retention and
//     execution retention can differ) are dropped, never rendered as
//     free-floating transcript content.
export function correlateExecutionsToMessages(
  messageIds: readonly string[],
  rows: readonly AgentToolExecutionRow[],
  labels: ExecutionPreviewLabels,
): Record<string, ChatToolExecutionViewModel[]> {
  const loaded = new Set(messageIds);
  const byMessage: Record<string, ChatToolExecutionViewModel[]> = {};
  const ordered = [...rows].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const row of ordered) {
    if (!row.chat_message_id || !loaded.has(row.chat_message_id)) continue;
    (byMessage[row.chat_message_id] ??= []).push(projectExecutionRow(row, labels));
  }
  return byMessage;
}

// Pure per-card state transition for the reconstructed map -- matched by
// executionId ONLY, so acting on one card can structurally never touch a
// sibling's entry (the multi-action independence guarantee, same
// discipline as ChatPage's applyTwoAction* helpers).
export function applyProjectedExecutionUpdate(
  prev: Record<string, ChatToolExecutionViewModel[]>,
  executionId: string,
  patch: Partial<Pick<ChatToolExecutionViewModel, "status" | "resultReply" | "errorCode">>,
): Record<string, ChatToolExecutionViewModel[]> {
  const next: Record<string, ChatToolExecutionViewModel[]> = {};
  for (const [messageId, cards] of Object.entries(prev)) {
    next[messageId] = cards.map((card) => (card.executionId === executionId ? { ...card, ...patch } : card));
  }
  return next;
}
