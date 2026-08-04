import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createContextRebuildService } from "./contextRebuildService";
import { createSupabaseProjectEvidenceRepository } from "./projectEvidenceRepository";
import { createProjectBriefService } from "./projectBriefService";
import { createSupabaseProjectRecordRepository } from "./projectRecordRepository";
import { createProjectWorkspaceReadService } from "./projectWorkspaceReadService";

export function createBrowserProjectWorkspaceReadService(client: SupabaseClient<Database> = supabase) {
  const projectRepository = createSupabaseProjectRecordRepository(client);
  const evidenceRepository = createSupabaseProjectEvidenceRepository(client);
  const resolveOwnerId = async () => {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  };
  const contextRebuildService = createContextRebuildService({
    projectRepository,
    evidenceRepository,
    resolveOwnerId,
  });
  const projectBriefService = createProjectBriefService({ contextRebuildService });

  return createProjectWorkspaceReadService({
    projectRepository,
    evidenceRepository,
    contextRebuildService,
    projectBriefService,
    resolveOwnerId,
  });
}

export const browserProjectWorkspaceReadService = createBrowserProjectWorkspaceReadService();
