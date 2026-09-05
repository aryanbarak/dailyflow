import { supabase } from "@/integrations/supabase/client";
import { createId } from "@/lib/id";
import type { Database } from "@/integrations/supabase/types";
import type {
  LearnAIMode,
  LearnAILanguage,
  LearnAIRole,
  LearnAIMessage,
} from "./types";

type LearnAiRow = Database["public"]["Tables"]["learn_ai_messages"]["Row"];
type LearnAiInsert = Database["public"]["Tables"]["learn_ai_messages"]["Insert"];

const STORAGE_PREFIX = "smartflow:learn-ai";

function getStorageKey(userId: string, mode: LearnAIMode) {
  return `${STORAGE_PREFIX}:${userId}:${mode}`;
}

function readMessages(userId: string, mode: LearnAIMode): LearnAIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId, mode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) =>
      item &&
      typeof item.id === "string" &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string" &&
      typeof item.createdAt === "string"
    );
  } catch {
    return [];
  }
}

function writeMessages(userId: string, mode: LearnAIMode, items: LearnAIMessage[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(userId, mode), JSON.stringify(items));
  } catch {
    // Ignore persistence errors to keep UI usable.
  }
}

function mapRowToMessage(row: LearnAiRow): LearnAIMessage {
  return {
    id: row.id,
    role: row.role as LearnAIRole,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function listHistory(
  mode: LearnAIMode,
  userId: string
): Promise<LearnAIMessage[]> {
  try {
    const { data, error } = await supabase
      .from("learn_ai_messages")
      .select("id,user_id,mode,language,role,content,created_at")
      .eq("user_id", userId)
      .eq("mode", mode)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRowToMessage);
  } catch (err) {
    const fallback = readMessages(userId, mode);
    if (fallback.length > 0) {
      return fallback.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    throw err;
  }
}

export async function insertMessage(input: {
  userId: string;
  mode: LearnAIMode;
  language: LearnAILanguage;
  role: LearnAIRole;
  content: string;
}): Promise<string> {
  const payload: LearnAiInsert = {
    user_id: input.userId,
    mode: input.mode,
    language: input.language,
    role: input.role,
    content: input.content,
  };

  try {
    const { data, error } = await supabase
      .from("learn_ai_messages")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  } catch (err) {
    const id = createId();
    const message: LearnAIMessage = {
      id,
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    const items = readMessages(input.userId, input.mode);
    items.push(message);
    writeMessages(input.userId, input.mode, items);
    return id;
  }
}
