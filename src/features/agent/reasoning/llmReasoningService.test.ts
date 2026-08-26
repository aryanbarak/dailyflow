import { describe, expect, it, vi } from "vitest";
import {
  createLlmReasoningCaller,
  parseLlmIntentJson,
} from "./llmReasoningService";
import { validateAgentIntentProposal } from "./intentValidator";
import { PROVIDER_UNAVAILABLE_REASON_MARKER, reasonAboutUserMessage } from "./reasoningOrchestrator";
import type { AgentReasoningSafeContext } from "./reasoningTypes";

describe("llmReasoningService", () => {
  it("parses JSON-only intent output", () => {
    const parsed = parseLlmIntentJson('{"type":"inspect_tasks","confidence":"high"}');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({ type: "inspect_tasks" });
    }
  });

  it("extracts a JSON object from fenced or wrapped model output", () => {
    const parsed = parseLlmIntentJson('```json\n{"type":"inspect_calendar"}\n```');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({ type: "inspect_calendar" });
    }
  });

  it("fails safely on malformed JSON", () => {
    expect(parseLlmIntentJson("{not-json").ok).toBe(false);
    expect(parseLlmIntentJson("plain text only").ok).toBe(false);
  });

  it("uses existing fetch boundary and reads reply JSON", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ reply: '{"type":"inspect_learning"}' }),
    }));
    const caller = createLlmReasoningCaller({
      endpoint: "https://example.test/chat",
      accessToken: "token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    const result = await caller({
      prompt: "Return JSON",
      responseLanguage: "en",
      sessionId: "session-1",
    });

    expect(result.rawText).toContain("inspect_learning");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls[0]?.[1])).toContain("Bearer token");
  });

  it("sends mode: reasoning on the stateful-chat transport so the worker schema-enforces the model call", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ reply: '{"type":"inspect_tasks"}' }),
    }));
    const caller = createLlmReasoningCaller({
      endpoint: "https://example.test/chat",
      accessToken: "token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    await caller({
      prompt: "Return JSON",
      responseLanguage: "en",
      sessionId: "session-1",
    });

    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(requestBody.mode).toBe("reasoning");
  });

  // INC-01 (2026-08-22 incident): distinguishes the worker's typed
  // PROVIDER_UNAVAILABLE 503 (agent/worker/index.ts's handleChat,
  // mode==="reasoning") from any other non-ok status, which keeps the
  // pre-existing rawText:"" behavior below.
  it("sets providerUnavailable on a 503 carrying the worker's PROVIDER_UNAVAILABLE code", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "The AI provider is temporarily unavailable.", code: "PROVIDER_UNAVAILABLE" }),
    }));
    const caller = createLlmReasoningCaller({
      endpoint: "https://example.test/chat",
      accessToken: "token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    const result = await caller({ prompt: "Return JSON", responseLanguage: "en", sessionId: "session-1" });

    expect(result).toEqual({ rawText: "", providerUnavailable: true });
  });

  it("does NOT set providerUnavailable on any other non-ok status (unchanged behavior)", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "Failed to generate reasoning proposal" }),
    }));
    const caller = createLlmReasoningCaller({
      endpoint: "https://example.test/chat",
      accessToken: "token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    const result = await caller({ prompt: "Return JSON", responseLanguage: "en", sessionId: "session-1" });

    expect(result).toEqual({ rawText: "" });
  });

  // GH-06: previously this fetch had no timeout at all, so a Worker stall
  // hung ChatPage.tsx's Promise.all([chatCallPromise, overlayPromise])
  // indefinitely. Proves the caller now rejects (with a TIMEOUT-coded
  // error, the same withTimeout convention executionEngine.ts already
  // uses) instead of hanging when the fetch never settles --
  // reasoningOrchestrator.ts's own `.catch(() => ({ rawText: "",
  // providerUnavailable: true }))` around this exact call is what turns
  // that rejection into the honest provider-unavailable outcome, so this
  // test only needs to prove the rejection happens, not re-test that
  // existing INC-01 catch behavior.
  it("GH-06: rejects with a TIMEOUT-coded error instead of hanging forever when the fetch never settles", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
      const caller = createLlmReasoningCaller({
        endpoint: "https://example.test/chat",
        accessToken: "token",
        fetcher: fetcher as unknown as typeof fetch,
      });

      const resultPromise = caller({ prompt: "Return JSON", responseLanguage: "en", sessionId: "session-1" });
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: "TIMEOUT" });
      // ENG-06: advance to the CURRENT ceiling (20_000, was 10_000). The
      // behaviour this test guards -- rejects rather than hangs -- is
      // unchanged; only the deadline moved.
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  // ENG-06 regression: the reasoning ceiling used to be 10_000 -- SHORTER
  // than the plain-chat lane's CHAT_REQUEST_TIMEOUT_MS (15_000,
  // ChatPage.tsx) despite being the heavier, structured-generation call.
  // A detailed engineering-task proposal that took ~12-14s therefore hit
  // the reasoning ceiling first and the user got the honest chat reply
  // with no approval card at all. This proves a 13s call now RESOLVES
  // with the model's real proposal -- and that it was still in flight (not
  // already rejected) at the old 10s mark, which is what makes this a
  // regression test for the constant rather than a restatement of the
  // GH-06 timeout test above.
  it("ENG-06: a 13s structured reasoning call resolves with the proposal instead of timing out at the old 10s ceiling", async () => {
    vi.useFakeTimers();
    try {
      const proposal = {
        type: "propose_engineering_task",
        confidence: "high",
        requestedDomain: "github",
        target: {
          repo: "aryanbarak/smartflow",
          engineeringInstruction: "Widen the reasoning overlay fetch ceiling.".repeat(40),
          engineeringTaskClass: "fix",
        },
        reasons: ["The request names an engineering task explicitly."],
        language: "en",
      };
      const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
        setTimeout(
          () => resolve(new Response(JSON.stringify({
            requestId: "reasoning:eng-06",
            proposal,
            responseLanguage: "en",
          }), { status: 200, headers: { "Content-Type": "application/json" } })),
          13_000,
        );
      }));
      const caller = createLlmReasoningCaller({
        endpoint: "http://127.0.0.1:8787/agent/reason",
        accessToken: "local-token",
        fetcher: fetcher as unknown as typeof fetch,
        transport: "structured-reasoning",
        requestIdFactory: () => "reasoning:eng-06",
      });

      const settled = vi.fn();
      const resultPromise = caller({
        prompt: "Bounded reasoning prompt",
        responseLanguage: "en",
        sessionId: "session-1",
      }).then((value) => {
        settled(value);
        return value;
      });

      // Past the OLD ceiling: under 10_000 this had already rejected by
      // now, which is exactly what produced the missing approval card.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000);
      const result = await resultPromise;

      expect(result).toEqual({ rawText: JSON.stringify(proposal) });
      // Not the PROVIDER_UNAVAILABLE fallback path: that outcome is
      // signalled by this flag (or by a rejection the orchestrator's catch
      // converts into one), and neither happened here.
      expect(result.providerUnavailable).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  // ENG-06, end to end through the orchestrator: the caller resolving is
  // only half the fix -- what the user was actually deprived of is the
  // approval card. This drives the REAL caller through
  // reasonAboutUserMessage (the same `.catch(() => ({ rawText: "",
  // providerUnavailable: true }))` seam that converted the old timeout
  // into the honest-but-cardless outcome) and proves a 13s call now yields
  // the model's engineering-task proposal, not providerUnavailableProposal.
  it("ENG-06: a 13s call still produces an engineering-task proposal, not the PROVIDER_UNAVAILABLE fallback", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-07-15T08:00:00.000Z");
      const safeContext: AgentReasoningSafeContext = {
        tasks: [],
        events: [],
        learningProgress: { lessons: [] },
        workspace: null,
      };
      const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
        setTimeout(
          () => resolve(new Response(JSON.stringify({
            requestId: "reasoning:eng-06-e2e",
            proposal: {
              id: "intent-eng-06",
              type: "propose_engineering_task",
              confidence: "high",
              requestedDomain: "github",
              target: {
                repo: "aryanbarak/smartflow",
                engineeringInstruction: "Widen the reasoning overlay fetch ceiling to match the chat lane.",
                engineeringTaskClass: "fix",
              },
              requiresTool: true,
              requiresApproval: true,
              reasons: ["The request names an engineering task explicitly."],
              language: "en",
              generatedAt: now.toISOString(),
              schemaVersion: 1,
            },
            responseLanguage: "en",
          }), { status: 200, headers: { "Content-Type": "application/json" } })),
          13_000,
        );
      }));
      const callLlmReasoning = createLlmReasoningCaller({
        endpoint: "http://127.0.0.1:8787/agent/reason",
        accessToken: "local-token",
        fetcher: fetcher as unknown as typeof fetch,
        transport: "structured-reasoning",
        requestIdFactory: () => "reasoning:eng-06-e2e",
      });

      const resultPromise = reasonAboutUserMessage({
        userMessage: "Please run an engineering task on aryanbarak/smartflow to widen the reasoning fetch ceiling.",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
        sessionId: "session-1",
      }, { callLlmReasoning });

      await vi.advanceTimersByTimeAsync(13_000);
      const result = await resultPromise;

      expect(result.proposal.type).toBe("propose_engineering_task");
      expect(result.proposal.reasons).not.toContain(PROVIDER_UNAVAILABLE_REASON_MARKER);
    } finally {
      vi.useRealTimers();
    }
  });

  // ENG-06d: the worker's typed MODEL_RESPONSE_INCOMPLETE 502 (index.ts's
  // reasoning branch) must surface as its OWN flag. Two things this
  // guards, both of which would recreate a bug: folding it into
  // providerUnavailable would tell the user the AI was unreachable when it
  // answered, and letting it fall through to the bare rawText:"" below
  // would feed the malformed-output rescue and manufacture an
  // ask_clarification out of a truncation (ENG-06c's confirmed symptom).
  it("ENG-06d: maps a 502 MODEL_RESPONSE_INCOMPLETE to responseIncomplete, not providerUnavailable", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ error: 'The AI model response was cut off before a complete proposal.', code: "MODEL_RESPONSE_INCOMPLETE" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ));
    const caller = createLlmReasoningCaller({
      endpoint: "https://example.test/chat",
      accessToken: "token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    const result = await caller({ prompt: "Return JSON", responseLanguage: "en", sessionId: "session-1" });

    expect(result).toEqual({ rawText: "", responseIncomplete: true });
    expect(result.providerUnavailable).toBeUndefined();
  });

  // A 502 that is NOT the typed truncation code keeps the pre-existing
  // rawText:"" behaviour -- the new branch must not swallow every 502.
  it("ENG-06d: a 502 without the typed code still falls through to the existing rawText:\"\" path", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ error: "Bad gateway" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ));
    const caller = createLlmReasoningCaller({
      endpoint: "https://example.test/chat",
      accessToken: "token",
      fetcher: fetcher as unknown as typeof fetch,
    });

    await expect(
      caller({ prompt: "Return JSON", responseLanguage: "en", sessionId: "session-1" }),
    ).resolves.toEqual({ rawText: "" });
  });

  it("returns empty raw text when no endpoint is configured", async () => {
    await expect(
      createLlmReasoningCaller({})({
        prompt: "Return JSON",
        responseLanguage: "en",
      }),
    ).resolves.toEqual({ rawText: "" });
  });

  it("uses the structured local reasoning contract with authenticated transport", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      requestId: "reasoning:test",
      proposal: {
        type: "inspect_tasks",
        confidence: "high",
        requestedDomain: "tasks",
        reasons: ["The request asks for tasks."],
        language: "en",
      },
      responseLanguage: "en",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const caller = createLlmReasoningCaller({
      endpoint: "http://127.0.0.1:8787/agent/reason",
      accessToken: "local-token",
      fetcher: fetcher as unknown as typeof fetch,
      transport: "structured-reasoning",
      requestIdFactory: () => "reasoning:test",
    });

    const result = await caller({
      prompt: "Bounded reasoning prompt",
      responseLanguage: "en",
      sessionId: "session-1",
    });
    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));

    expect(requestBody).toEqual({
      requestId: "reasoning:test",
      reasoningPrompt: "Bounded reasoning prompt",
      responseLanguage: "en",
    });
    expect(JSON.stringify(fetcher.mock.calls[0]?.[1]?.headers)).toContain("Bearer local-token");

    const parsed = parseLlmIntentJson(result.rawText);
    expect(parsed.ok).toBe(true);
    const validated = validateAgentIntentProposal({
      rawProposal: parsed.ok ? parsed.value : null,
      userMessage: "Show my tasks.",
      safeContext: { tasks: [], events: [], learningProgress: null },
      language: "en",
      now: new Date("2026-07-18T12:00:00.000Z"),
    });
    expect(validated.proposal.type).toBe("inspect_tasks");
    expect(validated.toolId).toBe("tasks.list");
  });

  it("fails closed on a mismatched or malformed structured envelope", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      requestId: "wrong-request",
      proposal: { type: "inspect_tasks" },
      responseLanguage: "en",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const caller = createLlmReasoningCaller({
      endpoint: "http://127.0.0.1:8787/agent/reason",
      fetcher: fetcher as unknown as typeof fetch,
      transport: "structured-reasoning",
      requestIdFactory: () => "reasoning:expected",
    });

    await expect(caller({
      prompt: "Bounded reasoning prompt",
      responseLanguage: "en",
    })).resolves.toEqual({ rawText: "" });
  });
});
