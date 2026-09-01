import { describe, expect, it, vi } from "vitest";
import { MODEL_RESPONSE_INCOMPLETE_REASON_MARKER, PROVIDER_UNAVAILABLE_REASON_MARKER, reasonAboutUserMessage } from "./reasoningOrchestrator";
import { buildReasoningPrompt } from "./reasoningPrompt";
import type { AgentLlmReasoningCaller, AgentReasoningSafeContext } from "./reasoningTypes";

const now = new Date("2026-07-15T08:00:00.000Z");

const safeContext: AgentReasoningSafeContext = {
  tasks: [
    {
      id: "task-1",
      title: "Tax report",
      completed: false,
      status: "open",
    },
  ],
  events: [{ id: "event-1", title: "Planning", dateTimeStart: now.toISOString() }],
  learningProgress: {
    lessons: [{ id: "lesson-1", title: "Sorting", completionPercentage: 82 }],
  },
  workspace: null,
};

function rawIntent(type: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "intent-1",
    type,
    confidence: "high",
    userMessage: "test",
    requestedDomain: type.includes("calendar")
      ? "calendar"
      : type.includes("learning")
        ? "learning"
        : type.includes("workspace")
          ? "workspace"
          : "tasks",
    toolId: type === "inspect_calendar"
      ? "calendar.list_today"
      : type === "inspect_learning"
        ? "learning.get_progress"
        : type === "inspect_workspace"
          ? "workspace.get_context"
          : type === "complete_task"
            ? "tasks.complete"
            : "tasks.list",
    requiresTool: true,
    requiresApproval: type === "complete_task",
    reasons: ["Validated by model."],
    language: "en",
    generatedAt: now.toISOString(),
    schemaVersion: 1,
    ...overrides,
  });
}

function caller(rawText: string): AgentLlmReasoningCaller {
  return vi.fn(async () => ({ rawText }));
}

function rawClarification(userMessage: string) {
  return JSON.stringify({
    id: "intent-clarify-1",
    type: "ask_clarification",
    confidence: "medium",
    userMessage,
    requiresTool: false,
    requiresApproval: false,
    clarificationQuestion: "Which item do you mean?",
    reasons: ["Model was unsure."],
    language: "en",
    generatedAt: now.toISOString(),
    schemaVersion: 1,
  });
}

describe("reasoningOrchestrator", () => {
  const phrasingCases = [
    ["en", "What tasks do I have today?", "inspect_tasks"],
    ["en", "Show today's appointments.", "inspect_calendar"],
    ["en", "Continue my learning.", "inspect_learning"],
    ["en", "What is my current plan?", "inspect_workspace"],
    ["de", "Welche Aufgaben habe ich heute?", "inspect_tasks"],
    ["de", "Zeig mir die heutigen Termine.", "inspect_calendar"],
    ["de", "Setze mein Lernen fort.", "inspect_learning"],
    ["de", "Was ist mein aktueller Plan?", "inspect_workspace"],
    ["fa", "امروز چه کارهایی دارم؟", "inspect_tasks"],
    ["fa", "قرارهای امروز را نشان بده.", "inspect_calendar"],
    ["fa", "درس من را ادامه بده.", "inspect_learning"],
    ["fa", "برنامه فعلی من چیست؟", "inspect_workspace"],
  ] as const;

  it.each(phrasingCases)("validates multilingual phrasing for %s: %s", async (language, userMessage, intent) => {
    const result = await reasonAboutUserMessage({
      userMessage,
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawIntent(intent)) });

    expect(result.proposal.type).toBe(intent);
    expect(result.responseLanguage).toBe(language);
  });

  it("corrects the Persian task baseline when the model overweights today as calendar", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "امروز چه کارهایی دارم؟",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawIntent("inspect_calendar")) });

    expect(result.proposal.type).toBe("inspect_tasks");
    expect(result.toolId).toBe("tasks.list");
    expect(result.proposal.requestedDomain).toBe("tasks");
  });

  it("corrects the German task baseline when the model asks unnecessary clarification", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "Welche Aufgaben habe ich heute?",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawClarification("Welche Aufgaben habe ich heute?")) });

    expect(result.proposal.type).toBe("inspect_tasks");
    expect(result.toolId).toBe("tasks.list");
    expect(result.responseLanguage).toBe("de");
  });

  it("corrects the English task baseline when the model asks unnecessary clarification", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "Show me my open tasks.",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawClarification("Show me my open tasks.")) });

    expect(result.proposal.type).toBe("inspect_tasks");
    expect(result.toolId).toBe("tasks.list");
    expect(result.responseLanguage).toBe("en");
  });

  it("keeps calendar phrases on calendar even when they mention today", async () => {
    const fa = await reasonAboutUserMessage({
      userMessage: "امروز چه قرارهایی دارم؟",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawClarification("امروز چه قرارهایی دارم؟")) });
    const de = await reasonAboutUserMessage({
      userMessage: "Zeig mir die heutigen Termine.",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawClarification("Zeig mir die heutigen Termine.")) });
    const en = await reasonAboutUserMessage({
      userMessage: "What is on my calendar today?",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawClarification("What is on my calendar today?")) });

    expect(fa.proposal.type).toBe("inspect_calendar");
    expect(de.proposal.type).toBe("inspect_calendar");
    expect(en.proposal.type).toBe("inspect_calendar");
  });

  it("returns a validated inspect_tasks intent without executing or approving", async () => {
    const callLlmReasoning = caller(rawIntent("inspect_tasks"));
    const result = await reasonAboutUserMessage({
      userMessage: "What tasks do I have today?",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning });

    expect(result.proposal.type).toBe("inspect_tasks");
    expect(result.toolId).toBe("tasks.list");
    expect(result.proposal.requiresApproval).toBe(false);
    expect(callLlmReasoning).toHaveBeenCalledTimes(1);
  });

  it("returns complete_task proposal only with exact validated task target", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "Complete the tax report task.",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, {
      callLlmReasoning: caller(rawIntent("complete_task", {
        target: { taskTitleHint: "Tax report" },
      })),
    });

    expect(result.proposal.type).toBe("complete_task");
    expect(result.proposal.target?.taskId).toBe("task-1");
    expect(result.proposal.requiresApproval).toBe(true);
  });

  it("fails closed on malformed JSON", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "What should I do?",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller("not-json") });

    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.requiresTool).toBe(false);
  });

  // INC-01 (2026-08-22 incident): distinct from "fails closed on malformed
  // JSON" directly above -- that test is the model answering with
  // something unusable (legitimate ask_clarification rescue territory).
  // These prove the DIFFERENT case: the AI provider itself never got a
  // chance to answer (429/5xx/network, or the call to the worker failing
  // outright), which must produce an honest, distinct outcome instead of
  // being run through the same malformed-output rescue.
  describe("INC-01: provider failure vs. malformed model output", () => {
    it("reports an honest provider-unavailable outcome -- never ask_clarification -- when the worker's callLlmReasoning reports providerUnavailable", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", providerUnavailable: true as const }));
      const result = await reasonAboutUserMessage({
        userMessage: "Create a task to buy milk",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
      }, { callLlmReasoning });

      expect(result.proposal.type).not.toBe("ask_clarification");
      expect(result.proposal.type).toBe("unsupported");
      expect(result.proposal.requiresTool).toBe(false);
      expect(result.proposal.requiresApproval).toBe(false);
      expect(result.proposal.clarificationQuestion).toBe(
        "The AI assistant is temporarily unavailable. Please try again in a moment.",
      );
      // The malformed-output rescue's own fixed reason text must never
      // appear here -- proves fallbackRawProposal/parseLlmIntentJson's
      // rescue path was never invoked for this outcome.
      expect(result.proposal.reasons).not.toContain("LLM output could not be parsed safely.");
      // INC-01 follow-up review point 2: a stable, exact, grep-able marker
      // (not just prose matching /provider/i) so this outcome is
      // distinguishable from a genuine 'unsupported' in logs/audit rows --
      // ChatPage.tsx's resolveChatTurnOutcome checks this exact string too
      // (see PROVIDER_UNAVAILABLE_REASON_MARKER's own header comment).
      expect(result.proposal.reasons).toContain(PROVIDER_UNAVAILABLE_REASON_MARKER);
    });

    it("surfaces the honest message in the caller's own language (EN/DE/FA)", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", providerUnavailable: true as const }));

      const de = await reasonAboutUserMessage({
        userMessage: "Erstelle eine Aufgabe",
        safeContext,
        configuredResponseLanguage: "de",
        interfaceLanguage: "de",
        now,
      }, { callLlmReasoning });
      const fa = await reasonAboutUserMessage({
        userMessage: "یک تسک بساز",
        safeContext,
        configuredResponseLanguage: "fa",
        interfaceLanguage: "fa",
        now,
      }, { callLlmReasoning });

      expect(de.proposal.clarificationQuestion).toBe(
        "Der KI-Assistent ist vorübergehend nicht verfügbar. Bitte versuche es gleich noch einmal.",
      );
      expect(fa.proposal.clarificationQuestion).toBe(
        "دستیار هوش مصنوعی موقتاً در دسترس نیست. لطفاً کمی بعد دوباره امتحان کنید.",
      );
    });

    it("also reports the honest outcome when callLlmReasoning rejects outright (network failure reaching the worker)", async () => {
      const callLlmReasoning = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
      const result = await reasonAboutUserMessage({
        userMessage: "Create a task to buy milk",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
      }, { callLlmReasoning });

      expect(result.proposal.type).not.toBe("ask_clarification");
      expect(result.proposal.clarificationQuestion).toBe(
        "The AI assistant is temporarily unavailable. Please try again in a moment.",
      );
    });

  // ENG-06d: a THIRD outcome, confirmed live in ENG-06c -- the provider
  // answered (so not INC-01 above) but gemini-3.6-flash spent the output
  // budget thinking and the structured proposal was cut off mid-JSON
  // (finishReason MAX_TOKENS, 243 chars). rawText is "" here for the same
  // reason it is "" for a provider failure, so without its own
  // short-circuit this truncation would be fed to the malformed-output
  // rescue and become a fabricated ask_clarification -- the exact INC-01
  // bug arriving by a new route.
  describe("ENG-06d: truncated model response vs. malformed model output", () => {
    it("reports an honest truncation outcome -- never ask_clarification -- when callLlmReasoning reports responseIncomplete", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", responseIncomplete: true as const }));
      const result = await reasonAboutUserMessage({
        userMessage: "Run an engineering task on aryanbarak/smartflow to widen the reasoning ceiling",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
      }, { callLlmReasoning });

      expect(result.proposal.type).not.toBe("ask_clarification");
      expect(result.proposal.type).toBe("unsupported");
      expect(result.proposal.requiresTool).toBe(false);
      expect(result.proposal.requiresApproval).toBe(false);
      expect(result.proposal.clarificationQuestion).toBe(
        "The AI's answer was cut off before the proposal was complete. Please try again, or shorten the request.",
      );
      // Proves the rescue path was never invoked -- this is the assertion
      // that would have caught ENG-06c's symptom.
      expect(result.proposal.reasons).not.toContain("LLM output could not be parsed safely.");
      expect(result.proposal.reasons).toContain(MODEL_RESPONSE_INCOMPLETE_REASON_MARKER);
    });

    it("does NOT reuse the provider-unavailable marker or wording -- the provider answered, it just got cut off", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", responseIncomplete: true as const }));
      const result = await reasonAboutUserMessage({
        userMessage: "Run an engineering task on aryanbarak/smartflow",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
      }, { callLlmReasoning });

      expect(result.proposal.reasons).not.toContain(PROVIDER_UNAVAILABLE_REASON_MARKER);
      expect(result.proposal.clarificationQuestion).not.toBe(
        "The AI assistant is temporarily unavailable. Please try again in a moment.",
      );
    });

    it("surfaces the truncation message in the caller's own language (DE/FA)", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", responseIncomplete: true as const }));

      const de = await reasonAboutUserMessage({
        userMessage: "Führe eine Entwicklungsaufgabe aus",
        safeContext,
        configuredResponseLanguage: "de",
        interfaceLanguage: "de",
        now,
      }, { callLlmReasoning });
      const fa = await reasonAboutUserMessage({
        userMessage: "یک تسک مهندسی اجرا کن",
        safeContext,
        configuredResponseLanguage: "fa",
        interfaceLanguage: "fa",
        now,
      }, { callLlmReasoning });

      expect(de.proposal.clarificationQuestion).toBe(
        "Die Antwort der KI wurde abgeschnitten, bevor der Vorschlag fertig war. Bitte versuche es erneut oder formuliere die Anfrage kürzer.",
      );
      expect(fa.proposal.clarificationQuestion).toBe(
        "پاسخ هوش مصنوعی پیش از تکمیل پیشنهاد قطع شد. لطفاً دوباره تلاش کنید یا درخواست را کوتاه‌تر بنویسید.",
      );
    });
  });
  });

  // ENG-06d: a THIRD outcome, confirmed live in ENG-06c -- the provider
  // answered (so not INC-01 above) but gemini-3.6-flash spent the output
  // budget thinking and the structured proposal was cut off mid-JSON
  // (finishReason MAX_TOKENS, 243 chars). rawText is "" here for the same
  // reason it is "" for a provider failure, so without its own
  // short-circuit this truncation would be fed to the malformed-output
  // rescue and become a fabricated ask_clarification -- the exact INC-01
  // bug arriving by a new route.
  describe("ENG-06d: truncated model response vs. malformed model output", () => {
    it("reports an honest truncation outcome -- never ask_clarification -- when callLlmReasoning reports responseIncomplete", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", responseIncomplete: true as const }));
      const result = await reasonAboutUserMessage({
        userMessage: "Run an engineering task on aryanbarak/smartflow to widen the reasoning ceiling",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
      }, { callLlmReasoning });

      expect(result.proposal.type).not.toBe("ask_clarification");
      expect(result.proposal.type).toBe("unsupported");
      expect(result.proposal.requiresTool).toBe(false);
      expect(result.proposal.requiresApproval).toBe(false);
      expect(result.proposal.clarificationQuestion).toBe(
        "The AI's answer was cut off before the proposal was complete. Please try again, or shorten the request.",
      );
      // Proves the rescue path was never invoked -- this is the assertion
      // that would have caught ENG-06c's symptom.
      expect(result.proposal.reasons).not.toContain("LLM output could not be parsed safely.");
      expect(result.proposal.reasons).toContain(MODEL_RESPONSE_INCOMPLETE_REASON_MARKER);
    });

    it("does NOT reuse the provider-unavailable marker or wording -- the provider answered, it just got cut off", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", responseIncomplete: true as const }));
      const result = await reasonAboutUserMessage({
        userMessage: "Run an engineering task on aryanbarak/smartflow",
        safeContext,
        configuredResponseLanguage: "auto",
        interfaceLanguage: "en",
        now,
      }, { callLlmReasoning });

      expect(result.proposal.reasons).not.toContain(PROVIDER_UNAVAILABLE_REASON_MARKER);
      expect(result.proposal.clarificationQuestion).not.toBe(
        "The AI assistant is temporarily unavailable. Please try again in a moment.",
      );
    });

    it("surfaces the truncation message in the caller's own language (DE/FA)", async () => {
      const callLlmReasoning = vi.fn(async () => ({ rawText: "", responseIncomplete: true as const }));

      const de = await reasonAboutUserMessage({
        userMessage: "Führe eine Entwicklungsaufgabe aus",
        safeContext,
        configuredResponseLanguage: "de",
        interfaceLanguage: "de",
        now,
      }, { callLlmReasoning });
      const fa = await reasonAboutUserMessage({
        userMessage: "یک تسک مهندسی اجرا کن",
        safeContext,
        configuredResponseLanguage: "fa",
        interfaceLanguage: "fa",
        now,
      }, { callLlmReasoning });

      expect(de.proposal.clarificationQuestion).toBe(
        "Die Antwort der KI wurde abgeschnitten, bevor der Vorschlag fertig war. Bitte versuche es erneut oder formuliere die Anfrage kürzer.",
      );
      expect(fa.proposal.clarificationQuestion).toBe(
        "پاسخ هوش مصنوعی پیش از تکمیل پیشنهاد قطع شد. لطفاً دوباره تلاش کنید یا درخواست را کوتاه‌تر بنویسید.",
      );
    });
  });

  it("uses configured response language over latest message language", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "What tasks do I have?",
      safeContext,
      configuredResponseLanguage: "fa",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawIntent("inspect_tasks")) });

    expect(result.responseLanguage).toBe("fa");
    expect(result.proposal.language).toBe("fa");
  });

  it("auto follows Persian and German latest user messages", async () => {
    const fa = await reasonAboutUserMessage({
      userMessage: "کارهای امروز من چیست؟",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawIntent("inspect_tasks")) });
    const de = await reasonAboutUserMessage({
      userMessage: "Zeig mir meinen Kalender für heute.",
      safeContext,
      configuredResponseLanguage: "auto",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning: caller(rawIntent("inspect_calendar")) });

    expect(fa.responseLanguage).toBe("fa");
    expect(de.responseLanguage).toBe("de");
  });

  it("prompt excludes private data classes", () => {
    const prompt = buildReasoningPrompt({
      userMessage: "What tasks do I have?",
      configuredResponseLanguage: "en",
      interfaceLanguage: "en",
      safeContext,
      responseLanguage: "en",
      now,
    });

    expect(prompt).toContain("Tax report");
    expect(prompt).not.toContain("user-");
    expect(prompt).not.toContain("rawMemory");
    expect(prompt).not.toContain("auditRecords");
    expect(prompt).not.toContain("policyDecision");
  });

  it("does not call runtime, approval, or handlers from reasoning", async () => {
    const callLlmReasoning = caller(rawIntent("inspect_workspace"));
    await reasonAboutUserMessage({
      userMessage: "Inspect workspace.",
      safeContext,
      configuredResponseLanguage: "en",
      interfaceLanguage: "en",
      now,
    }, { callLlmReasoning });

    expect(callLlmReasoning).toHaveBeenCalledTimes(1);
  });
});

describe("reasoningOrchestrator disambiguation", () => {
  // No task/calendar/learning/workspace/github evidence at all, so the
  // top-level type stays exactly "ask_clarification" as the model proposed
  // it, and each candidate keeps its own type instead of being redirected.
  const neutralContext: AgentReasoningSafeContext = {
    tasks: [],
    events: [],
    learningProgress: null,
  };

  function rawClarificationWithCandidates(candidates: Array<{ type: string; reasons: string[] }>) {
    return JSON.stringify({
      id: "intent-clarify-1",
      type: "ask_clarification",
      confidence: "medium",
      clarificationQuestion: "Did you mean issues or pull requests?",
      reasons: ["Model was torn between specific tools."],
      candidates,
      language: "en",
      generatedAt: now.toISOString(),
      schemaVersion: 1,
    });
  }

  it("falls back to the plain clarification, unchanged, when zero candidates survive validation", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "Please help me decide.",
      safeContext: neutralContext,
      configuredResponseLanguage: "en",
      interfaceLanguage: "en",
      now,
    }, {
      callLlmReasoning: caller(rawClarificationWithCandidates([
        { type: "not_a_real_type", reasons: ["a"] },
        { type: "also_not_real", reasons: ["b"] },
      ])),
    });

    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.clarificationQuestion).toBe("Did you mean issues or pull requests?");
    expect(result.disambiguationCandidates).toBeUndefined();
  });

  it("returns a normal single-proposal result with no disambiguationCandidates field when candidates dedup to one survivor", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "Please help me decide.",
      safeContext: neutralContext,
      configuredResponseLanguage: "en",
      interfaceLanguage: "en",
      now,
    }, {
      callLlmReasoning: caller(rawClarificationWithCandidates([
        { type: "inspect_github_issues", reasons: ["a"] },
        { type: "inspect_github_issues", reasons: ["b"] },
      ])),
    });

    expect(result.proposal.type).toBe("inspect_github_issues");
    expect(result.toolId).toBe("github.issues.list");
    expect(result.disambiguationCandidates).toBeUndefined();
  });

  it("returns disambiguationCandidates for genuinely distinct surviving candidates, keeping the clarificationQuestion as the top-level text", async () => {
    const result = await reasonAboutUserMessage({
      userMessage: "Please help me decide.",
      safeContext: neutralContext,
      configuredResponseLanguage: "en",
      interfaceLanguage: "en",
      now,
    }, {
      callLlmReasoning: caller(rawClarificationWithCandidates([
        { type: "inspect_github_issues", reasons: ["a"] },
        { type: "inspect_github_pull_requests", reasons: ["b"] },
      ])),
    });

    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.clarificationQuestion).toBe("Did you mean issues or pull requests?");
    expect(result.disambiguationCandidates).toHaveLength(2);
    expect(result.disambiguationCandidates?.map((candidate) => candidate.proposal.type)).toEqual([
      "inspect_github_issues",
      "inspect_github_pull_requests",
    ]);
    // Each candidate is a fully independent, complete result -- same shape
    // as any standalone proposal, not a partial or a pointer into the parent.
    expect(result.disambiguationCandidates?.[0].toolId).toBe("github.issues.list");
    expect(result.disambiguationCandidates?.[0].responseLanguage).toBe("en");
    expect(result.disambiguationCandidates?.[0].disambiguationCandidates).toBeUndefined();
  });

  it("never consults candidates once evidence-based normalization has already resolved a confident single type", async () => {
    // Top-level raw type is ask_clarification, but "What tasks do I have?"
    // deterministically resolves to inspect_tasks via domain evidence before
    // validation even returns -- proving the VALIDATED type gates candidate
    // resolution, not the raw model type.
    const result = await reasonAboutUserMessage({
      userMessage: "What tasks do I have?",
      safeContext,
      configuredResponseLanguage: "en",
      interfaceLanguage: "en",
      now,
    }, {
      callLlmReasoning: caller(rawClarificationWithCandidates([
        { type: "inspect_github_issues", reasons: ["a"] },
        { type: "inspect_github_pull_requests", reasons: ["b"] },
      ])),
    });

    expect(result.proposal.type).toBe("inspect_tasks");
    expect(result.disambiguationCandidates).toBeUndefined();
  });
});

// Chat V2 Slice 2B.1.1: resolveTaskCalendarClarificationFollowUp and the
// bounded task/calendar clarification continuation it served are RETIRED
// -- the PO decision this slice implements (an explicit task-worded
// request with a concrete time now routes DIRECTLY to Calendar,
// preserving the requested time) means there is no longer a first
// question to follow up on. validateAgentIntentProposal now resolves the
// scheduling domain in a single deterministic call -- see
// intentValidator.test.ts's own coverage (the "explicit UPDATE-worded
// task + time" describe block covers the create/update semantics and
// "never bridge task identity into update_calendar_event" guarantees
// this function used to test across a multi-turn exchange).
