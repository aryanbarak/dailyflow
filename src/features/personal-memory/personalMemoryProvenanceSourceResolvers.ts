// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS5).
//
// Resolves live source-display info for chat_turn/briefing provenance
// references -- the two source kinds documentChunkSourceResolver.ts does
// not already cover. Same shape and posture as that resolver: read-only,
// RLS-scoped (the signed-in user's own rows only), a ref id that no longer
// exists (agent_chat_messages is capped/pruned to the most recent 100 rows
// per user -- see ADR-0010 Phase-0 inventory) simply does not appear in the
// returned map rather than throwing.

import { supabase } from "@/integrations/supabase/client";

export interface ProvenanceTextSource {
  readonly label: string;
  readonly createdAt: string;
}

export type ResolveChatTurnSources = (messageIds: readonly string[]) => Promise<Record<string, ProvenanceTextSource>>;
export type ResolveBriefingSources = (briefingIds: readonly string[]) => Promise<Record<string, ProvenanceTextSource>>;

const LABEL_EXCERPT_CHARS = 80;

function excerpt(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > LABEL_EXCERPT_CHARS ? `${trimmed.slice(0, LABEL_EXCERPT_CHARS)}…` : trimmed;
}

export const resolveChatTurnSources: ResolveChatTurnSources = async (messageIds) => {
  const uniqueIds = [...new Set(messageIds)];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("agent_chat_messages")
    .select("id,content,created_at")
    .in("id", uniqueIds);
  if (error) throw error;

  const result: Record<string, ProvenanceTextSource> = {};
  for (const row of (data ?? []) as Array<{ id: string; content: string; created_at: string }>) {
    result[row.id] = { label: excerpt(row.content), createdAt: row.created_at };
  }
  return result;
};

export const resolveBriefingSources: ResolveBriefingSources = async (briefingIds) => {
  const uniqueIds = [...new Set(briefingIds)];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("agent_briefings")
    .select("id,content,created_at")
    .in("id", uniqueIds);
  if (error) throw error;

  const result: Record<string, ProvenanceTextSource> = {};
  for (const row of (data ?? []) as Array<{ id: string; content: string; created_at: string }>) {
    result[row.id] = { label: excerpt(row.content), createdAt: row.created_at };
  }
  return result;
};
