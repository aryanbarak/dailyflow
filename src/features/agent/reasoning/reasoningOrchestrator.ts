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
  type AgentLlmReasoningCaller,
  type AgentReasoningInput,
  type AgentReasoningResult,
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
  }).catch(() => ({ rawText: "", providerUnavailable: true as const }));

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
