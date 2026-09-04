// Chat Runtime Truth / Tool Timeline V1 -- the smallest browser read
// abstraction over the current user's own `agent_tool_executions` rows.
//
// READ-ONLY BY CONSTRUCTION, twice over: this module only ever issues a
// SELECT, and the database itself revokes INSERT/UPDATE/DELETE on this
// table from the authenticated role entirely (see the migration's grant
// block) -- every lifecycle mutation happens exclusively through the
// Worker's service-role endpoints (agent/worker/agent-tool-execution.ts).
// There is no write fallback here to remove because none can exist: a
// browser write against this table is rejected at the database boundary.
// Owner scoping is RLS (`auth.uid() = user_id`); the explicit user_id
// filter below is belt-and-suspenders symmetry with loadSessionMessages'
// own agent_chat_messages query, not the security boundary.

import { supabase } from "@/integrations/supabase/client";
import {
  isAgentToolExecutionLifecycleStatus,
  type AgentToolExecutionRow,
} from "./chatToolExecutionProjection";

const ROW_SELECT =
  "id, session_id, chat_message_id, request_id, tool_id, domain, action, normalized_arguments, status, created_at, approval_requested_at, approved_at, execution_started_at, completed_at, target_type, target_id, error_code";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Session-scoped retrieval (slice section 7's preferred shape): the caller
// correlates the returned rows to its loaded chat messages via
// correlateExecutionsToMessages -- rows are returned as-is here, in
// deterministic (created_at, id) order, with no interpretation. A row
// whose status is outside the known lifecycle vocabulary (a future
// migration this build predates) is dropped rather than guessed at --
// rendering an unknown status as anything would be fabricating runtime
// truth.
export async function listSessionToolExecutions(
  userId: string,
  sessionId: string,
): Promise<AgentToolExecutionRow[]> {
  const { data, error } = await supabase
    .from("agent_tool_executions")
    .select(ROW_SELECT)
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) return [];

  const rows: AgentToolExecutionRow[] = [];
  for (const raw of data as unknown[]) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" || typeof raw.request_id !== "string" || typeof raw.tool_id !== "string") continue;
    if (!isAgentToolExecutionLifecycleStatus(raw.status)) continue;
    rows.push({
      id: raw.id,
      session_id: typeof raw.session_id === "string" ? raw.session_id : null,
      chat_message_id: typeof raw.chat_message_id === "string" ? raw.chat_message_id : null,
      request_id: raw.request_id,
      tool_id: raw.tool_id,
      domain: typeof raw.domain === "string" ? raw.domain : "",
      action: typeof raw.action === "string" ? raw.action : "",
      normalized_arguments: isRecord(raw.normalized_arguments) ? raw.normalized_arguments : {},
      status: raw.status,
      created_at: typeof raw.created_at === "string" ? raw.created_at : "",
      approval_requested_at: typeof raw.approval_requested_at === "string" ? raw.approval_requested_at : null,
      approved_at: typeof raw.approved_at === "string" ? raw.approved_at : null,
      execution_started_at: typeof raw.execution_started_at === "string" ? raw.execution_started_at : null,
      completed_at: typeof raw.completed_at === "string" ? raw.completed_at : null,
      target_type: typeof raw.target_type === "string" ? raw.target_type : null,
      target_id: typeof raw.target_id === "string" ? raw.target_id : null,
      error_code: typeof raw.error_code === "string" ? raw.error_code : null,
    });
  }
  return rows;
}
