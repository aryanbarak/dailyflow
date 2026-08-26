// SmartFlow -- ADR-0018 (Capability-Oriented AI Provider Abstraction), S0.
//
// Three capability contracts, exactly as ADR-0018 Decision 1 defines them.
// This file is interfaces and shapes ONLY -- no adapter, no call site is
// wired to these yet (that is S1/S2/S3). Nothing here changes behavior.
//
// Why three interfaces and not one `AIProvider`: they have different
// failure semantics, different fallback rules (ADR-0018 Decision 5), and
// -- for embeddings -- different persistence consequences. See the ADR's
// own "Why three and not one" note.

// ADR-0018 S2: imports from the leaf chatMessage.ts, not ../types --
// ../types also defines `Env` (whose `AI: Ai` field needs
// @cloudflare/workers-types, unavailable outside agent/worker's own
// tsconfig), and importing ANYTHING from that file pulls the whole thing
// into a compiler's graph. See chatMessage.ts's own header comment for
// the full story (this is what broke the root typecheck gate before this
// fix).
import type { ChatMessage } from "../chatMessage";
import type { NeutralSchema } from "./schema/neutralSchema";

// ADR-0018 Decision 2: request shapes are SmartFlow-owned and
// provider-neutral.
//   - ChatMessage is reused from types.ts, not duplicated.
//   - System instruction is a field on the request, not a turn -- the
//     Gemini adapter maps it to `system_instruction`; a different
//     provider's adapter could map it to a leading `system` turn instead.
//   - providerOptions is the one deliberate escape hatch for
//     provider-specific knobs (thinkingConfig, safety settings, AI
//     Gateway routing) that only the matching adapter reads. It must not
//     grow into a second API (ADR-0018 "Negative / costs").
//   - maxOutputTokens/temperature stay per-call, per PA-01's own reduction
//     ("system + turns + maxTokens/temperature -> string").

export interface TextGenerationRequest {
  system?: string;
  turns: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  // ADR-0018 S1 follow-up (part-order preservation): when providerOptions
  // carries an attachment (the Gemini adapter's own inlineDataAttachment),
  // this says whether it precedes or follows the turn's own text part. The
  // adapter must not choose this itself -- S1 originally hardcoded "always
  // after" and silently flipped two callers' pre-existing part order
  // (transcribePdf, /documents/analyze both put the attachment BEFORE the
  // text). No default: the Gemini adapter throws if an attachment is
  // present without this field set, rather than guessing.
  attachmentPosition?: 'before' | 'after';
  providerOptions?: Record<string, unknown>;
}

// ADR-0018 S1: narrowed from a plain `string` (S0) to this neutral enum --
// 'stop' (finished normally), 'length' (cut off by maxOutputTokens), or
// 'other' (anything else: a safety/recitation block, an unrecognized or
// missing value). See GeminiTextGenerationProvider's own mapFinishReason
// for the Gemini-specific mapping into this contract.
export interface TextGenerationResult {
  text: string;
  finishReason: 'stop' | 'length' | 'other';
}

// ADR-0018 Decision 3, narrowed in S2: `schema` carries the neutral
// JSON-Schema subset (providers/schema/neutralSchema.ts) that the
// matching adapter translates into the provider's own dialect (e.g.
// Gemini's `responseSchema`) at call time. The four shared builders
// (buildReasoningResponseSchema, buildDerivationResponseSchema,
// buildExtractionResponseSchema, buildTaskTitleResponseSchema) all return
// an object at the top level, but index.ts's 4 suggestion handlers
// (their own inline schemas, not one of the four shared builders) are
// top-level ARRAYS -- so this is the full NeutralSchema union, not the
// narrower NeutralObjectSchema. Was `unknown` in S0, before any call site
// emitted the neutral subset.
export interface StructuredGenerationRequest {
  system?: string;
  turns: ChatMessage[];
  schema: NeutralSchema;
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, unknown>;
}

// Deliberately just the raw text, per ADR-0018 Decision 1's own comment:
// "the provider never returns a 'typed' object it claims is valid."
// Parsing/validation stays in SmartFlow code (modelJsonParsing.ts + the
// existing validators) -- unchanged and unmoved by this ADR (Decision 3).
// finishReason narrowed in S2 to the same neutral enum TextGenerationResult
// already uses (S1) -- see GeminiStructuredGenerationProvider's own
// mapFinishReason (identical to the text adapter's).
//
// `usage` (Amendments, 2026-08-23): discovered migrating real call sites
// in S2 Phase C -- context-derivation-endpoint.ts and
// personal-memory-extraction-endpoint.ts both persist Gemini's
// usageMetadata (promptTokenCount/candidatesTokenCount) into real DB
// columns for cost/usage tracking, which the original S0 contract had no
// field for. Optional and provider-populated, same additive precedent as
// S1's ProviderUnavailableError.status/.body amendment -- see the ADR's
// own "Amendments (2026-08-23)" section.
export interface StructuredGenerationResult {
  rawText: string;
  finishReason: 'stop' | 'length' | 'other';
  usage?: {
    promptTokens?: number;
    responseTokens?: number;
    // ENG-06d: Gemini's `usageMetadata.thoughtsTokenCount`. On a thinking
    // model (gemini-3.6-flash, MIG-01b) thinking tokens are charged
    // against maxOutputTokens but appear in NEITHER of the two fields
    // above -- so a response truncated by thinking looks, from
    // promptTokens/responseTokens alone, like a small successful answer.
    // That is exactly how ENG-06c's MAX_TOKENS truncation stayed
    // invisible in logs and had to be inferred from text length. Optional
    // and provider-populated, same additive shape as the two fields above
    // and as `rawFinishReason` below; absent on non-thinking models.
    thinkingTokens?: number;
  };
  // `rawFinishReason` (Amendments, 2026-08-23): discovered migrating real
  // call sites in S2 Phase C -- context-derivation-endpoint.ts and
  // personal-memory-extraction-endpoint.ts both persist the PROVIDER'S OWN
  // finishReason string (e.g. "MAX_TOKENS", "SAFETY") verbatim into a
  // failure_reason column and diagnostic logs, for a level of detail the
  // neutral 'stop'|'length'|'other' enum deliberately collapses away (see
  // that enum's own comment on GeminiTextGenerationProvider's
  // mapFinishReason -- "nobody downstream inspects finer-grained
  // Gemini-specific values today" was true until these two real,
  // currently-persisted diagnostic fields). Optional, provider-populated,
  // same additive shape as the `usage` amendment above -- `finishReason`
  // stays the one field control-flow decisions are made on; this is
  // strictly for callers that also want the untranslated provider value.
  rawFinishReason?: string;
}

export interface EmbeddingResult {
  vectors: number[][];
}

export interface TextGenerationProvider {
  readonly id: string; // e.g. 'gemini'
  generateText(req: TextGenerationRequest): Promise<TextGenerationResult>;
}

export interface StructuredGenerationProvider {
  readonly id: string;
  // ADR-0018 S2 (Amendments, 2026-08-23): the S0 interface text carried a
  // <T> type parameter as a call-site type hint, but StructuredGenerationResult
  // never actually carries a T-typed value (it's always just `rawText`,
  // per Decision 1's own "never returns a 'typed' object it claims is
  // valid" comment) -- so <T> was dead weight with nothing to bind it to.
  // Dropped once a real implementation (GeminiStructuredGenerationProvider)
  // and real call sites existed to confirm it was never going to be used.
  generateStructured(req: StructuredGenerationRequest): Promise<StructuredGenerationResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number; // 768 today -- a contract, not a default
  readonly normalizesOutput: boolean; // false for gemini-embedding-001 @768
  embed(texts: string[]): Promise<EmbeddingResult>;
}
