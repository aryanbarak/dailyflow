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

export function defaultFlowWritePermissionMode(domain: string, action: string): FlowWritePermissionMode {
  if (action === "delete") return "ask";
  if (domain === "finance") return "ask";
  if ((domain === "tasks" || domain === "calendar") && (action === "create" || action === "update")) {
    return "auto";
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
