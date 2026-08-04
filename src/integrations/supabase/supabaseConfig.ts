const PRODUCTION_SUPABASE_URL = "https://taqxwnlwllbywaklwyno.supabase.co";
const PRODUCTION_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcXh3bmx3bGxieXdha2x3eW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODQzNjEsImV4cCI6MjA5MzQ2MDM2MX0.TmhuyWcwEUwnSvxXJiZ2HueY6Jr0sudmyJWlpM-X7_Y";

export type SupabaseRuntimeMode = "production" | "local-qa";

export interface SupabaseClientConfig {
  mode: SupabaseRuntimeMode;
  url: string;
  anonKey: string;
}

type SupabaseEnv = Record<string, string | boolean | undefined>;

function isLocalSupabaseUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]") &&
      !url.username &&
      !url.password &&
      (!url.pathname || url.pathname === "/") &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function productionConfig(): SupabaseClientConfig {
  return {
    mode: "production",
    url: PRODUCTION_SUPABASE_URL,
    anonKey: PRODUCTION_SUPABASE_ANON_KEY,
  };
}

export function resolveSupabaseClientConfig(env: SupabaseEnv): SupabaseClientConfig {
  const requestedModeRaw = env.VITE_SMARTFLOW_SUPABASE_MODE;

  if (requestedModeRaw === undefined || requestedModeRaw === "") {
    // `npm run dev` (import.meta.env.DEV) must never silently pick production --
    // only a built/deployed bundle (DEV false) keeps the old implicit default,
    // so Cloudflare Pages and `vite preview` are unaffected.
    if (env.DEV === true) {
      throw new Error(
        "VITE_SMARTFLOW_SUPABASE_MODE is required when running `npm run dev`. " +
          "Set VITE_SMARTFLOW_SUPABASE_MODE=local-qa to use a local Supabase stack, " +
          "or VITE_SMARTFLOW_SUPABASE_MODE=production to explicitly opt in to the " +
          "production database. See docs/testing/local-supabase-qa.md.",
      );
    }

    return productionConfig();
  }

  const requestedMode = String(requestedModeRaw);

  if (requestedMode === "production") {
    return productionConfig();
  }

  if (requestedMode !== "local-qa") {
    throw new Error(`Unsupported Supabase runtime mode: ${requestedMode}`);
  }

  const localUrl = String(env.VITE_SUPABASE_URL || "").trim();
  const localAnonKey = String(env.VITE_SUPABASE_ANON_KEY || "").trim();

  if (!localUrl || !localAnonKey) {
    throw new Error(
      "Local QA Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }

  if (!isLocalSupabaseUrl(localUrl)) {
    throw new Error("Local QA Supabase mode only accepts a loopback http URL.");
  }

  return {
    mode: "local-qa",
    url: localUrl,
    anonKey: localAnonKey,
  };
}
