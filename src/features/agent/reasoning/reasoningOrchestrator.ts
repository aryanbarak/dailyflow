import {
  resolveAiResponseLanguage,
  type SupportedAiResponseLanguage,
} from "@/features/ai/responseLanguage";
import { parseLlmIntentJson } from "./llmReasoningService";
import { resolveDisambiguationCandidates, validateAgentIntentProposal } from "./intentValidator";
import { buildReasoningPrompt } from "./reasoningPrompt";
import type {
  AgentLlmReasoningCaller,
  AgentReasoningInput,
  AgentReasoningResult,
  AgentReasoningValidationResult,
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
  const llmResponse = await dependencies.callLlmReasoning({
    prompt,
    responseLanguage,
    sessionId: input.sessionId,
  }).catch(() => ({ rawText: "" }));
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
