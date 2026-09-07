// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS2).
// Mirrors personalMemoryRecordBrowserService.ts's factory shape exactly.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { createSupabasePersonalMemoryRecallLogRepository } from "./personalMemoryRecallLogRepository";
import { createPersonalMemoryRecallLogService } from "./personalMemoryRecallLogService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBrowserPersonalMemoryRecallLogService(client: SupabaseClient<any> = supabase) {
  const repository = createSupabasePersonalMemoryRecallLogRepository(client);
  const resolveOwnerId = async () => {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  };

  return createPersonalMemoryRecallLogService({ repository, resolveOwnerId });
}

export const browserPersonalMemoryRecallLogService = createBrowserPersonalMemoryRecallLogService();
