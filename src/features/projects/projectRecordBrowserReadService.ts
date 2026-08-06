// SmartFlow -- Projects index browser read path.
//
// Mirrors projectWorkspaceBrowserReadService.ts's composition exactly: one
// authenticated browser Supabase client, wired into the existing
// ProjectRecordRepository/ProjectRecordService, exposing only the single
// read operation this page needs. Never accepts an owner id from the
// caller; resolveOwnerId always comes from this same client's own auth
// session. No create/update/archive capability is exposed here -- the
// Projects index page is read-only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createSupabaseProjectRecordRepository } from "./projectRecordRepository";
import { createProjectRecordService } from "./projectRecordService";
import type { ListProjectRecordsOptions, ProjectRecord } from "./projectRecordTypes";

export interface ProjectRecordReadService {
  list(options?: ListProjectRecordsOptions): Promise<ProjectRecord[]>;
}

export function createBrowserProjectRecordReadService(client: SupabaseClient<Database> = supabase): ProjectRecordReadService {
  const repository = createSupabaseProjectRecordRepository(client);
  const resolveOwnerId = async () => {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  };
  const service = createProjectRecordService({ repository, resolveOwnerId });

  return {
    list: (options) => service.list(options),
  };
}

export const browserProjectRecordReadService = createBrowserProjectRecordReadService();
