// CORE-W3 (2026-09-06, CORE audit items ۲-۳/۲-۵): browser side of personal
// API tokens. The plaintext token exists ONLY in this tab, once: it is
// generated locally, its SHA-256 hex goes to api_tokens (migration
// 20260906190000), and the caller shows it a single time. There is no way
// to read a token back -- revoke and mint a new one instead.
import { supabase } from "@/integrations/supabase/client";

const TOKEN_PREFIX = "sfp_";
// Unambiguous alphabet, same reasoning as the Telegram link codes.
const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_RANDOM_LENGTH = 40;

export interface ApiTokenSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function generateApiTokenValue(): string {
  const bytes = new Uint8Array(TOKEN_RANDOM_LENGTH);
  crypto.getRandomValues(bytes);
  let token = TOKEN_PREFIX;
  for (const byte of bytes) {
    token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  }
  return token;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const apiTokenService = {
  /** Mints a token, stores its hash, and returns the plaintext EXACTLY once. */
  async createToken(userId: string, name: string): Promise<string> {
    const token = generateApiTokenValue();
    const { error } = await supabase.from("api_tokens").insert({
      user_id: userId,
      name: name.trim().slice(0, 100),
      token_hash: await sha256Hex(token),
    });
    if (error) throw error;
    return token;
  },

  async listTokens(userId: string): Promise<ApiTokenSummary[]> {
    const { data, error } = await supabase
      .from("api_tokens")
      .select("id,name,created_at,last_used_at,revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    }));
  },

  async revokeToken(tokenId: string): Promise<void> {
    const { error } = await supabase
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId);
    if (error) throw error;
  },
};
