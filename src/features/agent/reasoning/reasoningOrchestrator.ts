import {
  resolveAiResponseLanguage,
  type SupportedAiResponseLanguage,
} from "@/features/ai/responseLanguage";
import { parseLlmIntentJson } from "./llmReasoningService";
import { resolveDisambiguationCandidates, validateAgentIntentProposal } from "./intentValidator";
import { buildReasoningPrompt } from "./reasoningPrompt";
import {
  AGENT_INTENT_SCHEMA_VERSION,
  type AgentIntentProposal,
  type AgentIntentTarget,
  type AgentLlmReasoningCaller,
  type AgentLlmReasoningResponse,
  type AgentReasoningInput,
  type AgentReasoningResult,
  type AgentReasoningSafeContext,
  type AgentReasoningValidationResult,
} from "./reasoningTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// The one place a validated result becomes a deliverable AgentReasoningResult
// -- used identically for a normal confident proposal, for the sole survivor
// of a disambiguation dedup, and for each entry in a multi-candidate list.
// There is exactly one path to a finished result; nothing here can drift
// between those cases because there is only one function that does it.
function toAgentReasoningResult(
  validation: AgentReasoningValidationResult,
  responseLanguage: SupportedAiResponseLanguage,
): AgentReasoningResult {
  return {
    ...validation,
    responseLanguage,
    promptPreview: {
      containsTaskNotes: false,
      containsRawMemory: false,
      containsAuditPolicy: false,
      containsUserId: false,
    },
  };
}

export interface ReasonAboutUserMessageDependencies {
  callLlmReasoning: AgentLlmReasoningCaller;
}

// Slice 2B.1: resolves the bounded, single-turn "task without a
// supported time, or calendar at that time?" continuation -- see
// intentValidator.ts's TASK_TIME_CLARIFICATION_REASON_MARKER and
// ChatPage.tsx's own pending-clarification ref for the full contract
// (ChatPage arms it only from the WORKER's own server-confirmed
// clarification marker, and consumes each stage on the very next user
// turn only -- never inferred from silence, never applied to any other
// turn).
//
// Deliberately skips the LLM round-trip entirely: the domain is already
// known (the user just chose it), so the only thing left to do is re-run
// the SAME deterministic field extraction (date/time; title/notes come
// from `capturedTarget`, the model's own guess from the turn that asked
// the question, when available) validateAgentIntentProposal already
// applies to any create_task/update_task/create_calendar_event proposal.
// This is a narrow, single-purpose function, not a general re-reasoning
// entry point -- it always resolves the ORIGINAL triggering message
// (never the follow-up reply text itself).
//
// Blocker 2 correction: `rawProposal.type` below is a placeholder only --
// validateAgentIntentProposal's own explicit-task-time-ambiguity branch
// never reads it for this decision. Which operation (create vs update)
// the ambiguity resolves to is re-derived, EVERY call, purely from
// EXPLICIT MESSAGE EVIDENCE on `originalUserMessage` itself (the same
// taskCreateRequested/taskUpdateRequested regex check the very first
// turn used) -- so an originally update_task request stays update_task
// on a "task_without_time" answer (preserving the exact resolved task
// identity captured in `capturedTarget`), and a "calendar_with_time"
// answer to that SAME update_task request never resolves directly here
// at all: it comes back as a SECOND clarification
// (TASK_TO_CALENDAR_CONVERSION_REASON_MARKER on the returned proposal's
// reasons), which only resolves to create_calendar_event once THIS
// function is called a third time with resolvedAs:
// "calendar_conversion_confirmed" -- and even then only as a brand-new
// event, never bridging the original task's identity (see
// intentValidator.ts's stripTaskIdentityForConversion).
export function resolveTaskCalendarClarificationFollowUp(input: {
  originalUserMessage: string;
  resolvedAs: "task_without_time" | "calendar_with_time" | "calendar_conversion_confirmed";
  capturedTarget: AgentIntentTarget | undefined;
  safeContext: AgentReasoningSafeContext;
  language: SupportedAiResponseLanguage;
  now?: Date;
  timeZone?: string;
}): AgentReasoningResult {
  const validation = validateAgentIntentProposal({
    rawProposal: { type: "create_task", target: input.capturedTarget },
    userMessage: input.originalUserMessage,
    safeContext: input.safeContext,
    language: input.language,
    now: input.now,
    timeZone: input.timeZone,
    resolvedTaskTimeAmbiguityAs: input.resolvedAs,
  });
  return toAgentReasoningResult(validation, input.language);
}

function fallbackRawProposal(
  userMessage: string,
  language: SupportedAiResponseLanguage,
  now: Date,
) {
  return {
    id: `intent:fallback:${now.toISOString()}`,
    type: "ask_clarification",
    confidence: "medium",
    userMessage,
    requiresTool: false,
    requiresApproval: false,
    clarificationQuestion:
      language === "fa"
        ? "می‌توانید دقیق‌تر بگویید چه کاری می‌خواهید انجام دهم؟"
        : language === "de"
          ? "Kannst du genauer sagen, was ich tun soll?"
          : "Can you clarify what you want me to do?",
    reasons: ["LLM output could not be parsed safely."],
    language,
    generatedAt: now.toISOString(),
    schemaVersion: 1,
  };
}

// INC-01 follow-up review: a marker distinct from ordinary human-readable
// reasons text -- ChatPage.tsx checks for this EXACT string (not a prose
// match) to tell "this 'unsupported' proposal is really a provider outage"
// apart from a genuine unsupported-capability request, since both share
// the same `type` (see providerUnavailableProposal's own header comment
// for why they share a type at all). Also gives audit-ledger/log
// consumers a stable, grep-able code, same spirit as the Worker's own
// `code: 'PROVIDER_UNAVAILABLE'` (agent/worker/index.ts).
export const PROVIDER_UNAVAILABLE_REASON_MARKER = "PROVIDER_UNAVAILABLE";

// ENG-06d: the same stable, grep-able marker convention as
// PROVIDER_UNAVAILABLE_REASON_MARKER above, for the third outcome --
// the model answered but was cut off mid-proposal. A separate marker (not
// a reuse of the one above) because the two are different facts about the
// world and get different user-facing wording: "the AI couldn't be
// reached" vs "the AI's answer didn't finish".
export const MODEL_RESPONSE_INCOMPLETE_REASON_MARKER = "MODEL_RESPONSE_INCOMPLETE";

// INC-01: distinct from fallbackRawProposal above -- that one is the
// rescue for a model response that came back and couldn't be parsed (the
// model DID answer, just badly). This one is for when the model never got
// a chance to answer at all: the AI provider itself failed (429/5xx/
// network -- see llmReasoningService.ts's PROVIDER_UNAVAILABLE handling
// and reasonAboutUserMessage's own catch below). Reuses "unsupported" as
// the proposal type rather than "ask_clarification" (so this is never
// mistaken for a genuine question the assistant is asking) and rather
// than adding a new AgentIntentType member (which would require touching
// every exhaustive switch on that union across ChatPage.tsx -- out of
// scope for this incident fix; "unsupported" already renders as a silent,
// non-actionable overlay everywhere those switches handle it). The
// PROVIDER_UNAVAILABLE_REASON_MARKER above is what lets ChatPage.tsx (and
// logs) still tell this apart from a genuine "I can't do that" -- see
// resolveChatTurnOutcome's isProviderUnavailableOverlay.
function providerUnavailableProposal(
  userMessage: string,
  language: SupportedAiResponseLanguage,
  now: Date,
): AgentIntentProposal {
  return {
    id: `intent:provider-unavailable:${now.toISOString()}`,
    type: "unsupported",
    confidence: "medium",
    userMessage,
    requiresTool: false,
    requiresApproval: false,
    clarificationQuestion:
      language === "fa"
        ? "دستیار هوش مصنوعی موقتاً در دسترس نیست. لطفاً کمی بعد دوباره امتحان کنید."
        : language === "de"
          ? "Der KI-Assistent ist vorübergehend nicht verfügbar. Bitte versuche es gleich noch einmal."
          : "The AI assistant is temporarily unavailable. Please try again in a moment.",
    reasons: [
      PROVIDER_UNAVAILABLE_REASON_MARKER,
      "The AI provider failed to respond (rate limit, outage, or network error) -- this is not a model output.",
    ],
    language,
    generatedAt: now.toISOString(),
    schemaVersion: AGENT_INTENT_SCHEMA_VERSION,
  };
}

// ENG-06d: the truncation sibling of providerUnavailableProposal above.
// Same structural choices for the same reasons -- type "unsupported" (so
// it renders as a silent, non-actionable overlay everywhere ChatPage.tsx
// switches on the type, without adding a union member), a stable marker in
// reasons[0] so logs and resolveChatTurnOutcome can tell it apart, and an
// honest clarificationQuestion carrying the user-facing text.
//
// The wording deliberately does NOT say "unavailable": the AI was
// available and did answer. It names what actually happened and gives the
// user the one lever that helps (retry, or a shorter request) -- a
// detailed engineering-task instruction is exactly the input most likely
// to exhaust the model's output budget, so "shorten it" is real advice
// here, not filler.
function modelResponseIncompleteProposal(
  userMessage: string,
  language: SupportedAiResponseLanguage,
  now: Date,
): AgentIntentProposal {
  return {
    id: `intent:model-response-incomplete:${now.toISOString()}`,
    type: "unsupported",
    confidence: "medium",
    userMessage,
    requiresTool: false,
    requiresApproval: false,
    clarificationQuestion:
      language === "fa"
        ? "پاسخ هوش مصنوعی پیش از تکمیل پیشنهاد قطع شد. لطفاً دوباره تلاش کنید یا درخواست را کوتاه‌تر بنویسید."
        : language === "de"
          ? "Die Antwort der KI wurde abgeschnitten, bevor der Vorschlag fertig war. Bitte versuche es erneut oder formuliere die Anfrage kürzer."
          : "The AI's answer was cut off before the proposal was complete. Please try again, or shorten the request.",
    reasons: [
      MODEL_RESPONSE_INCOMPLETE_REASON_MARKER,
      "The model responded but its structured proposal was truncated (finishReason was not 'stop') -- this is not a clarification the assistant chose to ask.",
    ],
    language,
    generatedAt: now.toISOString(),
    schemaVersion: AGENT_INTENT_SCHEMA_VERSION,
  };
}

export async function reasonAboutUserMessage(
  input: AgentReasoningInput,
  dependencies: ReasonAboutUserMessageDependencies,
): Promise<AgentReasoningResult> {
  const now = input.now ?? new Date();
  const responseLanguage = resolveAiResponseLanguage({
    configuredResponseLanguage: input.configuredResponseLanguage,
    latestUserMessage: input.userMessage,
    interfaceLanguage: input.interfaceLanguage,
  });
  const prompt = buildReasoningPrompt({
    ...input,
    responseLanguage,
    now,
  });
  // INC-01: a network failure reaching the worker at all is, from the
  // user's perspective, the same "AI unavailable" outcome as the worker
  // itself reporting PROVIDER_UNAVAILABLE (llmReasoningService.ts) -- both
  // set providerUnavailable so the short-circuit below is one code path,
  // not two.
  const llmResponse = await dependencies.callLlmReasoning({
    prompt,
    responseLanguage,
    sessionId: input.sessionId,
    // ENG-06d: annotated as the full response type rather than inferred.
    // Without it the catch's object literal narrows the awaited union to
    // `{rawText, providerUnavailable}` and every OTHER optional flag on
    // AgentLlmReasoningResponse -- responseIncomplete today, whatever the
    // next honest-failure signal is tomorrow -- becomes a type error at
    // its own read site rather than simply being absent here.
  }).catch((): AgentLlmReasoningResponse => ({ rawText: "", providerUnavailable: true }));

  // INC-01: short-circuits BEFORE parseLlmIntentJson/fallbackRawProposal --
  // rawText is "" here same as a genuine malformed-output case, but this
  // is not one: the model never got a chance to answer, so it must never
  // be run through the malformed-output rescue (which produces
  // ask_clarification, exactly the fabricated-clarification bug this
  // incident is about) or through validateAgentIntentProposal's own
  // evidence-based rescue logic, which is correct for actual model output
  // and should never see something that isn't.
  if (llmResponse.providerUnavailable) {
    return toAgentReasoningResult(
      {
        proposal: providerUnavailableProposal(input.userMessage, responseLanguage, now),
        validationReasons: ["The AI provider was unavailable -- reported directly, never passed through the malformed-output rescue."],
      },
      responseLanguage,
    );
  }

  // ENG-06d: same short-circuit discipline as the INC-01 branch above, for
  // the same reason. rawText is "" here too, but a truncated proposal is
  // NOT malformed model output to be rescued -- running it through
  // fallbackRawProposal would produce an ask_clarification the model never
  // asked for, which is the fabricated-clarification bug in a new costume
  // (confirmed live in ENG-06c: finishReason MAX_TOKENS, 243 chars, no
  // approval card, no trace of why).
  if (llmResponse.responseIncomplete) {
    return toAgentReasoningResult(
      {
        proposal: modelResponseIncompleteProposal(input.userMessage, responseLanguage, now),
        validationReasons: ["The model's response was truncated -- reported directly, never passed through the malformed-output rescue."],
      },
      responseLanguage,
    );
  }

  const parsed = parseLlmIntentJson(llmResponse.rawText);
  const rawProposal = parsed.ok
    ? parsed.value
    : fallbackRawProposal(input.userMessage, responseLanguage, now);
  const validation = validateAgentIntentProposal({
    rawProposal,
    userMessage: input.userMessage,
    safeContext: input.safeContext,
    language: responseLanguage,
    now,
    timeZone: input.timeZone,
  });
  const result = toAgentReasoningResult(validation, responseLanguage);

  // Disambiguation is only ever attempted when the VALIDATED top-level type
  // is ask_clarification -- not the raw model type -- so if evidence-based
  // normalization already resolved the ambiguity deterministically to a
  // single confident intent, that takes priority and candidates are never
  // consulted at all.
  const rawCandidates = isRecord(rawProposal) ? rawProposal.candidates : undefined;
  if (validation.proposal.type !== "ask_clarification" || rawCandidates === undefined) {
    return result;
  }

  const candidateResults = resolveDisambiguationCandidates({
    rawCandidates,
    userMessage: input.userMessage,
    safeContext: input.safeContext,
    language: responseLanguage,
    now,
  });

  if (candidateResults.length === 0) {
    // Falls back to the plain clarification above, unchanged.
    return result;
  }
  if (candidateResults.length === 1) {
    // Indistinguishable from a normal confident proposal: same construction,
    // same shape, no disambiguationCandidates field at all.
    return toAgentReasoningResult(candidateResults[0], responseLanguage);
  }
  return {
    ...result,
    disambiguationCandidates: candidateResults.map((candidate) =>
      toAgentReasoningResult(candidate, responseLanguage),
    ),
  };
}
