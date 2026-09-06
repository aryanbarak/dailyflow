// CORE-W1 (2026-09-06, CORE audit item ۲-۱): browser side of the Telegram
// capture channel. This service only does what RLS allows the browser to
// do (migration 20260906000000_telegram_capture.sql): create a short-lived
// link code for the signed-in user, read the user's own binding, and
// delete it. Binding creation and code consumption are Worker-only
// (agent/worker/telegram-webhook.ts).
import { supabase } from "@/integrations/supabase/client";

export const TELEGRAM_LINK_CODE_TTL_MINUTES = 10;

// Unambiguous alphabet (no O/0, I/1, L) -- the user retypes this into
// Telegram by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateTelegramLinkCodeValue(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

export interface TelegramLinkStatus {
  linked: boolean;
}

export const telegramLinkService = {
  /** Creates a fresh single-use code (10 min TTL) and returns it for
   * display. Stale codes need no cleanup -- expires_at filters them. */
  async createLinkCode(userId: string): Promise<string> {
    const code = generateTelegramLinkCodeValue();
    const expiresAt = new Date(
      Date.now() + TELEGRAM_LINK_CODE_TTL_MINUTES * 60_000,
    ).toISOString();
    const { error } = await supabase.from("telegram_link_codes").insert({
      code,
      user_id: userId,
      expires_at: expiresAt,
    });
    if (error) throw error;
    return code;
  },

  async getStatus(userId: string): Promise<TelegramLinkStatus> {
    const { count, error } = await supabase
      .from("telegram_links")
      .select("chat_id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    return { linked: (count ?? 0) > 0 };
  },

  async unlink(userId: string): Promise<void> {
    const { error } = await supabase
      .from("telegram_links")
      .delete()
      .eq("user_id", userId);
    if (error) throw error;
  },
};
