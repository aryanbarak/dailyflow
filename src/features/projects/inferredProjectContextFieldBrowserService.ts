// SmartFlow -- Inferred Project Context Layer (ADR-0009), confirm/correct UI
// (task 4). Mirrors projectWorkspaceBrowserReadService.ts's own factory
// shape exactly: real Supabase client, owner id resolved from the current
// auth session, never from caller input.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createSupabaseProjectRecordRepository } from "./projectRecordRepository";
import { createSupabaseInferredProjectContextFieldRepository } from "./inferredProjectContextFieldRepository";
import { createInferredProjectContextFieldService } from "./inferredProjectContextFieldService";

export function createBrowserInferredProjectContextFieldService(client: SupabaseClient<Database> = supabase) {
  const repository = createSupabaseInferredProjectContextFieldRepository(client);
  const projectRepository = createSupabaseProjectRecordRepository(client);
  const resolveOwnerId = async () => {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  };

  return createInferredProjectContextFieldService({
    repository,
    projectRepository,
    resolveOwnerId,
  });
}

export const browserInferredProjectContextFieldService = createBrowserInferredProjectContextFieldService();
