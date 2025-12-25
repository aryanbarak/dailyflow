import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- CORS (allowlist) ----------
const allowedOrigins = new Set([
  "http://localhost:8080",
  "http://localhost:5173",
  // "https://YOUR_PROD_DOMAIN", // بعداً اضافه کن
]);

const devOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function resolveCorsOrigin(origin: string | null): string | null {
  if (!origin) return "*";
  if (allowedOrigins.has(origin)) return origin;
  if (devOriginPattern.test(origin)) return origin;
  return null;
}

function corsHeaders(origin: string | null) {
  const allowedOrigin = resolveCorsOrigin(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Vary": "Origin",
  };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return { headers, allowedOrigin };
}

// ---------- AES-256-GCM helpers ----------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importAesKeyFromSecret(): Promise<CryptoKey> {
  const secret = Deno.env.get("ENCRYPTION_KEY");
  if (!secret) throw new Error("Missing ENCRYPTION_KEY secret");
  const keyBytes = b64ToBytes(secret);
  if (keyBytes.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (base64-encoded)");
  }
  return await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptApiKey(plain: string) {
  const key = await importAesKeyFromSecret();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = textEncoder.encode(plain);

  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    ciphertext_b64: bytesToB64(new Uint8Array(cipherBuf)),
    iv_b64: bytesToB64(iv),
  };
}

async function decryptApiKey(ciphertext_b64: string, iv_b64: string) {
  const key = await importAesKeyFromSecret();
  const ciphertext = b64ToBytes(ciphertext_b64);
  const iv = b64ToBytes(iv_b64);

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return textDecoder.decode(plainBuf);
}

// ---------- Helpers ----------
function getIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim();
  return ip || null;
}

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// ---------- Main ----------
serve(async (req) => {
  const origin = req.headers.get("origin");
  const { headers, allowedOrigin } = corsHeaders(origin);

  if (origin && !allowedOrigin) {
    return json(403, { error: "Origin not allowed" }, headers);
  }

  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }, headers);
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(401, { error: "Unauthorized" }, headers);

    // Client that ENFORCES RLS (anon key + user JWT)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (userErr || !user) return json(401, { error: "Unauthorized" }, headers);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const serviceName = url.searchParams.get("service") || "default";

    if (!action) return json(400, { error: "Missing action" }, headers);

    // -------- Rate limit (RPC) for save/test/revoke/status ----------
    const ip = getIp(req);
    const max = action === "test" ? 10 : 30; // adjust
    const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit", {
      p_user_id: user.id,
      p_ip: ip,
      p_action: `api_keys:${action}:${serviceName}`,
      p_window_seconds: 60,
      p_max: max,
    });

    if (rlErr) return json(500, { error: "Rate limit check failed" }, headers);
    if (!allowed) return json(429, { error: "Too many requests. Try again later." }, headers);

    // -------- Actions ----------
    if (action === "save") {
      const body = await req.json().catch(() => ({}));
      const apiKey = body?.apiKey;

      if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
        return json(400, { error: "Invalid API key format" }, headers);
      }

      const { ciphertext_b64, iv_b64 } = await encryptApiKey(apiKey);

      const { error } = await supabase
        .from("user_api_keys")
        .upsert(
          {
            user_id: user.id,
            service_name: serviceName,
            ciphertext_b64,
            iv_b64,
            is_valid: null,
            last_validated_at: null,
            revoked_at: null,
          },
          { onConflict: "user_id,service_name" },
        );

      if (error) return json(500, { error: "Failed to save API key" }, headers);

      return json(200, { success: true }, headers);
    }

    if (action === "status") {
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("is_valid,last_validated_at,created_at,updated_at,revoked_at")
        .eq("user_id", user.id)
        .eq("service_name", serviceName)
        .maybeSingle();

      if (error) return json(500, { error: "Failed to fetch status" }, headers);

      return json(200, {
        hasKey: !!data && !data.revoked_at,
        isValid: data?.is_valid ?? null,
        lastValidatedAt: data?.last_validated_at ?? null,
        createdAt: data?.created_at ?? null,
        updatedAt: data?.updated_at ?? null,
      }, headers);
    }

    if (action === "test") {
      // Get stored encrypted key
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("ciphertext_b64,iv_b64")
        .eq("user_id", user.id)
        .eq("service_name", serviceName)
        .maybeSingle();

      if (error || !data) {
        return json(404, { success: false, error: "No API key found" }, headers);
      }

      // Decrypt ONLY on server
      const apiKey = await decryptApiKey(data.ciphertext_b64, data.iv_b64);

      // TODO: replace with real external API call (timeout) for your provider
      const isValid = apiKey.length >= 10;

      await supabase
        .from("user_api_keys")
        .update({ is_valid: isValid, last_validated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("service_name", serviceName);

      return json(200, { success: isValid }, headers);
    }

    if (action === "revoke") {
      const { error } = await supabase
        .from("user_api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("service_name", serviceName);

      if (error) return json(500, { error: "Failed to revoke API key" }, headers);

      return json(200, { success: true }, headers);
    }

    return json(400, { error: "Invalid action" }, headers);
  } catch (e) {
    // Never log secrets; keep error generic
    return json(500, { error: "Internal server error" }, headers);
  }
});
