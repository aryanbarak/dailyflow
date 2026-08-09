import type { AiResponseLanguage } from "@/features/ai/responseLanguage";

// Conversation Quality v1 (task 9), tutor topic liberation: `mode` widened
// from a closed 4-value union to a free-form topic string. No schema
// change -- `learn_ai_messages.mode` is already a plain `text not null`
// column with no CHECK constraint
// (supabase/migrations/20260504000000_create_dashboard_tables.sql), and the
// stored Settings default is a JSON string in localStorage. History scoping
// (learnAiService.ts's listHistory/insertMessage, keyed by exact `mode`
// string) is unaffected: a free-typed topic becomes its own history thread,
// exactly like switching between the four suggested topics already does.
export const LEARN_AI_SUGGESTED_TOPICS = ["fiae_algorithms", "general_it", "wiso", "planner"] as const;
export type LearnAISuggestedTopic = typeof LEARN_AI_SUGGESTED_TOPICS[number];
export type LearnAIMode = string;

export type LearnAIRole = "user" | "assistant";

export type LearnAILanguage = "de" | "fa" | "en";
export type LearnAIResponseLanguage = AiResponseLanguage;

export interface LearnAIMessage {
  id: string;
  role: LearnAIRole;
  content: string;
  createdAt: string;
  language?: LearnAILanguage;
}

export interface LearnAISession {
  id: string;
  title: string;
  mode: LearnAIMode;
  language: LearnAILanguage;
  createdAt: string;
}
