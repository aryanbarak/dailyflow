import { describe, expect, it, vi } from "vitest";

// Importing ChatPage for its constant drags in the real Supabase client,
// which refuses to construct without VITE_SMARTFLOW_SUPABASE_MODE. Same
// stub ChatPage.test.tsx uses, and it must precede the imports below.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    from: vi.fn(),
  },
}));

import { withTimeout } from "@/features/agent";
import { REASONING_FETCH_TIMEOUT_MS } from "@/features/agent/reasoning/llmReasoningService";
import { CHAT_REQUEST_TIMEOUT_MS, isChatRequestTimeoutError } from "@/pages/ChatPage";

// ENG-06h. handleSend runs two lanes under one Promise.all, and they fail
// ASYMMETRICALLY:
//
//   chat lane     -> withTimeout REJECTS -> Promise.all rejects -> the turn
//                    is torn down and the user is told it timed out. A
//                    statement about US giving up. True.
//   overlay lane  -> catches its own timeout and RESOLVES with a
//                    providerUnavailable proposal -> a trailing note
//                    claiming the AI PROVIDER is unavailable, attached to
//                    whatever the chat lane returns next.
//
// So whichever ceiling is LOWER decides which of those happens first. With
// the overlay's lower (chat 25_000 vs reasoning 20_000, as ENG-06f shipped
// it), the overlay manufactured a claim about the provider while the chat
// lane was still in flight -- and the chat lane then succeeded, handing the
// user a real answer with "the AI is temporarily unavailable" underneath.
//
// These tests exist because that window was created by editing ONE of two
// constants that live in different files, with nothing between them
// asserting a relationship. The arithmetic assertions are the cheap half;
// the behavioural one below is the point.
describe("ENG-06h: chat/overlay lane timeout ordering", () => {
  // Measured maxima, both from live wrangler tail captures. Kept here as
  // the shared basis for both ceilings, since the per-lane margin checks
  // below are what stop the ordering being "restored" by crushing the chat
  // ceiling back down to a value that re-creates the 94%-of-ceiling defect
  // ENG-06f fixed.
  const OBSERVED_MAX_MS = {
    // ENG-06e, 2026-08-26T21:50Z -- 14 071 / 13 649 / 11 458 ms.
    chat: 14_071,
    // ENG-06c, 2026-08-26T19:26Z -- the 14 493 ms call agent/worker/index.ts
    // cites as the reasoning worst case. ENG-06f read only the later
    // ENG-06e window (8 514-12 297 ms), concluded reasoning was the faster
    // lane, and inverted the ordering on that basis.
    reasoning: 14_493,
  };
  // The project's per-lane rule, set by ENG-06's 20_000-against-12_297.
  const MIN_HEADROOM_FACTOR = 1.6;
  // Enough that the invariant does not rely on the two lanes being kicked
  // off in the same synchronous block -- true today, not guaranteed.
  const MIN_ORDERING_MARGIN_MS = 5_000;

  it("keeps the claim-making lane from being the first to give up", () => {
    expect(REASONING_FETCH_TIMEOUT_MS).toBeGreaterThan(CHAT_REQUEST_TIMEOUT_MS);
  });

  it("leaves margin, so the ordering does not depend on lane start skew", () => {
    expect(REASONING_FETCH_TIMEOUT_MS - CHAT_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_ORDERING_MARGIN_MS);
  });

  // Guards the OTHER way of satisfying the ordering: dropping the chat
  // ceiling back under the overlay's. That would restore the invariant and
  // silently reintroduce ENG-06f's defect, so the ordering test alone is
  // not sufficient.
  it.each([
    ["chat", CHAT_REQUEST_TIMEOUT_MS, OBSERVED_MAX_MS.chat],
    ["reasoning", REASONING_FETCH_TIMEOUT_MS, OBSERVED_MAX_MS.reasoning],
  ])("gives the %s lane at least %sx its own observed max", (_lane, ceiling, observedMax) => {
    expect(ceiling / observedMax).toBeGreaterThanOrEqual(MIN_HEADROOM_FACTOR);
  });

  // The real deliverable. Reproduces the two-lane race with the REAL
  // withTimeout and the REAL constants, rather than comparing two numbers,
  // so it fails on any change that re-opens the window -- including ones
  // that keep the arithmetic intact (e.g. making the overlay lane reject
  // early for some other reason).
  describe("the window itself", () => {
    // Mirrors handleSend: chat rejects on timeout, overlay swallows its own
    // and resolves with the unavailable claim.
    // NOT Number.MAX_SAFE_INTEGER: setTimeout stores its delay in a signed
    // 32-bit int and clamps anything larger to 1 ms, so "never responds"
    // written that way resolves IMMEDIATELY and the hung-lane tests below
    // silently pass for the wrong reason (they did, first time round).
    // Comfortably past both ceilings is all that is needed.
    const NEVER_MS = Math.max(CHAT_REQUEST_TIMEOUT_MS, REASONING_FETCH_TIMEOUT_MS) * 10;

    function runTurn(chatRespondsAtMs: number, overlayRespondsAtMs: number) {
      const chatLane = withTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("a real answer"), chatRespondsAtMs)),
        CHAT_REQUEST_TIMEOUT_MS,
        "Chat request timed out.",
      );
      const overlayLane = withTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("a proposal"), overlayRespondsAtMs)),
        REASONING_FETCH_TIMEOUT_MS,
        "Reasoning overlay request timed out.",
      ).catch(() => "PROVIDER_UNAVAILABLE_CLAIM");

      return Promise.all([chatLane, overlayLane]);
    }

    async function settle(turn: Promise<unknown>) {
      const outcome = turn.then(
        (value) => ({ status: "resolved" as const, value }),
        (error) => ({ status: "rejected" as const, error }),
      );
      await vi.advanceTimersByTimeAsync(Math.max(CHAT_REQUEST_TIMEOUT_MS, REASONING_FETCH_TIMEOUT_MS) + 1_000);
      return outcome;
    }

    // The exact scenario from the ENG-06f measurements: a slow-but-fine
    // turn. Both lanes are past the OLD 20_000 overlay ceiling, so under
    // ENG-06f's constants the overlay would have claimed the provider was
    // unavailable and the chat lane would have then delivered a real reply.
    it("never pairs a successful chat reply with an unavailable claim, when both lanes are merely slow", async () => {
      vi.useFakeTimers();
      try {
        const result = await settle(runTurn(22_000, 23_000));

        expect(result.status).toBe("resolved");
        expect(result).toMatchObject({ value: ["a real answer", "a proposal"] });
      } finally {
        vi.useRealTimers();
      }
    });

    // The load-bearing case. The overlay is genuinely hung; the chat lane is
    // merely slow but would succeed. The turn MUST end as an honest chat
    // timeout, not as a delivered reply carrying a false claim -- which is
    // exactly what the ordering buys.
    it("tears the turn down honestly when the overlay hangs and the chat lane is slow", async () => {
      vi.useFakeTimers();
      try {
        const result = await settle(runTurn(26_000, NEVER_MS));

        expect(result.status).toBe("rejected");
        // Asserted through the REAL predicate handleSend branches on, not
        // by string-matching: this is what decides whether the user gets
        // the honest timeout messages or the generic send-error path.
        expect(isChatRequestTimeoutError((result as { error: unknown }).error)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    // The overlay's claim is NOT suppressed in general -- it is the only
    // signal a user gets that no approval card is coming. It must still
    // surface when the chat lane genuinely succeeded quickly and the
    // overlay genuinely failed, because the two lanes use different
    // providers (ADR-0018: text may fall back to Workers AI, structured is
    // Gemini-only and fails closed), so a working chat reply does not imply
    // a working reasoning provider.
    it("still surfaces the claim when chat succeeds fast and the overlay really does fail", async () => {
      vi.useFakeTimers();
      try {
        const result = await settle(runTurn(1_000, NEVER_MS));

        expect(result.status).toBe("resolved");
        expect(result).toMatchObject({ value: ["a real answer", "PROVIDER_UNAVAILABLE_CLAIM"] });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
