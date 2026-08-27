import { supabase } from "@/integrations/supabase/client";
import { writeIntentRegistry } from "../../../shared/writeIntentRegistry";

export type FlowWritePermissionDomain = "tasks" | "calendar" | "finance";
export type FlowWritePermissionAction = "create" | "update" | "delete";
export type FlowWritePermissionMode = "auto" | "ask" | "off";

export interface FlowWritePermissionKey {
  domain: string;
  action: string;
}

export interface FlowWritePermissionRow extends FlowWritePermissionKey {
  mode: FlowWritePermissionMode;
  userId?: string;
  isUserSet: boolean;
}

// Task 23: derived from the shared registry -- one (domain, action) pair per
// write intent, in registry order (tasks.create, tasks.update,
// calendar.create_event, calendar.update_event), matching the pre-refactor
// literal list exactly. The domain/default-mode logic below already
// special-cases "calendar" generically (not per-entry), so a new registry
// entry surfaces in Settings with no further edit here.
export const WIRED_FLOW_WRITE_CAPABILITIES: readonly FlowWritePermissionKey[] = Object.freeze(
  writeIntentRegistry.map((entry) => ({ domain: entry.domain, action: entry.action })),
);

// INC-02 (GitHub #188) TEMPORARY CLAMP -- tasks/calendar
// create+update return 'ask' here, not 'auto'.
//
// WHY: a client-side timeout abandons the browser's wait but does not
// cancel the request (no AbortController anywhere on this path), so the
// Worker runs to completion and PERFORMS THE WRITE while the user is told
// the turn timed out. 'auto' is what makes that silent: no approval card
// means nothing for the user to notice not happening. Clamping to 'ask'
// does not fix the abandoned-write race -- it removes the unattended
// execution that makes the race invisible.
//
// WHY HERE and not a flow_write_permissions row: that table is EMPTY in
// production (zero rows, verified 2026-08-27), so this function governs
// 100% of real write behaviour. Clamping in code writes zero rows, is
// key-agnostic, and survives ADR-0019's re-key to (user_id, intent_type,
// mode) untouched -- whereas clamp rows written under the old key would
// hand that migration a data migration it does not currently need.
//
// EXIT CONDITION -- this clamp is retired when ENG-07 (GitHub #185) has
// landed BOTH halves: Part A's abort plumbing (the request is actually
// cancelled) and Part B's recovery surface (an abandoned write becomes
// discoverable). Prevention alone is not enough -- a write can complete
// microseconds before the disconnect is noticed, so some abandoned writes
// will always land and must be findable. When both ship, this returns to
// 'auto'.
//
// The branch below is kept rather than deleted, even though every path
// now returns 'ask', so retiring the clamp is one word rather than a
// reconstruction. Do not "simplify" it away.
//
// MUST STAY IDENTICAL to its twin (ADR-0019 Known Hazard 1). Changing one
// and not the other makes Settings display a policy the Worker does not
// enforce. Pinned by src/features/agent/flowWriteDefaultParity.test.ts.
//
// Twin: agent/worker/flow-write-policy.ts's defaultFlowWriteMode.
export function defaultFlowWritePermissionMode(domain: string, action: string): FlowWritePermissionMode {
  if (action === "delete") return "ask";
  if (domain === "finance") return "ask";
  // INC-02 clamp: was "auto".
  if ((domain === "tasks" || domain === "calendar") && (action === "create" || action === "update")) {
    return "ask";
  }
  return "ask";
}

export function resolveFlowWritePermissionMode(
  domain: string,
  action: string,
  rows: readonly FlowWritePermissionRow[] = [],
): FlowWritePermissionMode {
  const explicit = rows.find((row) => row.domain === domain && row.action === action);
  return explicit?.mode ?? defaultFlowWritePermissionMode(domain, action);
}

export async function listBrowserFlowWritePermissions(userId: string): Promise<FlowWritePermissionRow[]> {
  const { data, error } = await supabase
    .from("flow_write_permissions")
    .select("user_id,domain,action,mode")
    .eq("user_id", userId);
  if (error) throw error;
  const explicit = (data ?? []).map((row) => ({
    userId: row.user_id,
    domain: row.domain,
    action: row.action,
    mode: row.mode as FlowWritePermissionMode,
    isUserSet: true,
  }));
  return WIRED_FLOW_WRITE_CAPABILITIES.map((capability) => {
    const row = explicit.find((item) => item.domain === capability.domain && item.action === capability.action);
    return row ?? {
      ...capability,
      mode: defaultFlowWritePermissionMode(capability.domain, capability.action),
      isUserSet: false,
    };
  });
}

export async function upsertBrowserFlowWritePermission(
  userId: string,
  domain: string,
  action: string,
  mode: FlowWritePermissionMode,
): Promise<void> {
  const { error } = await supabase
    .from("flow_write_permissions")
    .upsert({ user_id: userId, domain, action, mode }, { onConflict: "user_id,domain,action" });
  if (error) throw error;
}
