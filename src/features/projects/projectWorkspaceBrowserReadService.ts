import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createContextRebuildService } from "./contextRebuildService";
import { createSupabaseProjectEvidenceRepository } from "./projectEvidenceRepository";
import { createProjectBriefService } from "./projectBriefService";
import { createSupabaseProjectRecordRepository } from "./projectRecordRepository";
import { createProjectWorkspaceReadService } from "./projectWorkspaceReadService";
import { createSupabaseInferredProjectContextFieldRepository } from "./inferredProjectContextFieldRepository";

export function createBrowserProjectWorkspaceReadService(client: SupabaseClient<Database> = supabase) {
  const projectRepository = createSupabaseProjectRecordRepository(client);
  const evidenceRepository = createSupabaseProjectEvidenceRepository(client);
  const resolveOwnerId = async () => {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  };
  // ADR-0009 (task 4): contextRebuildService.ts has supported this optional
  // dependency since task 3c -- wiring it in here is what makes a
  // user_confirmed/user_corrected field actually reach context_ready for the
  // live Project Workspace page. No schema/RPC change; this is the browser
  // factory finally passing an already-existing, already-optional slot.
  const inferredContextFieldRepository = createSupabaseInferredProjectContextFieldRepository(client);
  const contextRebuildService = createContextRebuildService({
    projectRepository,
    evidenceRepository,
    inferredContextFieldRepository,
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
