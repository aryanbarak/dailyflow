import type { WorkspacePlanStep } from "../workspace/workspaceTypes";

export interface AuthenticatedActor {
  id: string;
}

export interface TrustedActorResolver {
  getAuthenticatedActor(): Promise<AuthenticatedActor | null>;
}

export interface AuthorityScopeResolver {
  resolveAuthoritativeScope(input: {
    actor: AuthenticatedActor;
    step: WorkspacePlanStep;
  }): Promise<string | null>;
}

export interface ExecutionAuthorityContext extends TrustedActorResolver, AuthorityScopeResolver {}

export const defaultTrustedActorResolver: TrustedActorResolver = {
  async getAuthenticatedActor() {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.auth.getUser();
      const actorId = data.user?.id?.trim();
      if (error || !actorId) return null;
      return { id: actorId };
    } catch {
      return null;
    }
  },
};

export const defaultAuthorityScopeResolver: AuthorityScopeResolver = {
  async resolveAuthoritativeScope({ actor }) {
    return `user:${actor.id}`;
  },
};

export const defaultExecutionAuthorityContext: ExecutionAuthorityContext = {
  ...defaultTrustedActorResolver,
  ...defaultAuthorityScopeResolver,
};
