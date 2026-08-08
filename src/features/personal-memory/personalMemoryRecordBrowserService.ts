// SmartFlow -- Personal Memory Layer (ADR-0010), confirm/correct/reject/
// delete UI (task 6). Mirrors inferredProjectContextFieldBrowserService.ts's
// own factory shape exactly: real Supabase client, owner id resolved from
// the current auth session, never from caller input. No project repository
// dependency -- this aggregate has no project dimension.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { createSupabasePersonalMemoryRecordRepository } from "./personalMemoryRecordRepository";
import { createPersonalMemoryRecordService } from "./personalMemoryRecordService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBrowserPersonalMemoryRecordService(client: SupabaseClient<any> = supabase) {
  const repository = createSupabasePersonalMemoryRecordRepository(client);
  const resolveOwnerId = async () => {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  };

  return createPersonalMemoryRecordService({ repository, resolveOwnerId });
}

export const browserPersonalMemoryRecordService = createBrowserPersonalMemoryRecordService();
