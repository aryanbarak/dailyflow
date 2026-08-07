import { describe, expect, it, vi } from "vitest";
import { describeCliSupabaseTargetFailure, resolveCliSupabaseTarget } from "./cliSupabaseEnvironmentGate";

describe("resolveCliSupabaseTarget", () => {
  it("passes a loopback http URL without ever calling the confirmation function", async () => {
    const confirmProductionTarget = vi.fn();
    const result = await resolveCliSupabaseTarget("http://127.0.0.1:54321", {
      allowProduction: false,
      confirmProductionTarget,
    });
    expect(result).toEqual({ ok: true, host: "127.0.0.1:54321", local: true });
    expect(confirmProductionTarget).not.toHaveBeenCalled();
  });

  it("passes localhost and the IPv6 loopback form, exactly matching isLocalSupabaseUrl's own rules", async () => {
    const localhost = await resolveCliSupabaseTarget("http://localhost:54321", { allowProduction: false });
    expect(localhost.ok).toBe(true);
    const ipv6 = await resolveCliSupabaseTarget("http://[::1]:54321", { allowProduction: false });
    expect(ipv6.ok).toBe(true);
  });

  it("fails closed for a non-local target when --allow-production was not passed, without calling the confirmation function", async () => {
    const confirmProductionTarget = vi.fn();
    const result = await resolveCliSupabaseTarget("https://taqxwnlwllbywaklwyno.supabase.co", {
      allowProduction: false,
      confirmProductionTarget,
    });
    expect(result).toEqual({ ok: false, host: "taqxwnlwllbywaklwyno.supabase.co", reason: "NOT_LOCAL_TARGET" });
    expect(confirmProductionTarget).not.toHaveBeenCalled();
  });

  it("fails closed for https on a loopback host -- isLocalSupabaseUrl requires plain http, so this is treated as non-local", async () => {
    const result = await resolveCliSupabaseTarget("https://127.0.0.1:54321", { allowProduction: false });
    expect(result).toEqual({ ok: false, host: "127.0.0.1:54321", reason: "NOT_LOCAL_TARGET" });
  });

  it("with --allow-production, calls the confirmation function with exactly the resolved host and proceeds when it resolves true", async () => {
    const confirmProductionTarget = vi.fn().mockResolvedValue(true);
    const result = await resolveCliSupabaseTarget("https://taqxwnlwllbywaklwyno.supabase.co", {
      allowProduction: true,
      confirmProductionTarget,
    });
    expect(confirmProductionTarget).toHaveBeenCalledTimes(1);
    expect(confirmProductionTarget).toHaveBeenCalledWith("taqxwnlwllbywaklwyno.supabase.co");
    expect(result).toEqual({ ok: true, host: "taqxwnlwllbywaklwyno.supabase.co", local: false });
  });

  it("with --allow-production, still fails closed when the confirmation function resolves false", async () => {
    const confirmProductionTarget = vi.fn().mockResolvedValue(false);
    const result = await resolveCliSupabaseTarget("https://taqxwnlwllbywaklwyno.supabase.co", {
      allowProduction: true,
      confirmProductionTarget,
    });
    expect(result).toEqual({
      ok: false,
      host: "taqxwnlwllbywaklwyno.supabase.co",
      reason: "PRODUCTION_NOT_CONFIRMED",
    });
  });

  it("reports INVALID_SUPABASE_URL for a malformed URL rather than throwing, and never calls the confirmation function", async () => {
    const confirmProductionTarget = vi.fn();
    const result = await resolveCliSupabaseTarget("not a url", { allowProduction: true, confirmProductionTarget });
    expect(result).toEqual({ ok: false, reason: "INVALID_SUPABASE_URL" });
    expect(confirmProductionTarget).not.toHaveBeenCalled();
  });
});

describe("describeCliSupabaseTargetFailure", () => {
  it("names the host for NOT_LOCAL_TARGET, and never echoes a key or token (it never receives one)", () => {
    const message = describeCliSupabaseTargetFailure({ reason: "NOT_LOCAL_TARGET", host: "prod.example.supabase.co" });
    expect(message).toContain("prod.example.supabase.co");
    expect(message).toContain("--allow-production");
  });

  it("names the host for PRODUCTION_NOT_CONFIRMED", () => {
    const message = describeCliSupabaseTargetFailure({ reason: "PRODUCTION_NOT_CONFIRMED", host: "prod.example.supabase.co" });
    expect(message).toContain("prod.example.supabase.co");
  });

  it("does not require a host for INVALID_SUPABASE_URL", () => {
    const message = describeCliSupabaseTargetFailure({ reason: "INVALID_SUPABASE_URL" });
    expect(message).toMatch(/not a valid URL/);
  });
});
