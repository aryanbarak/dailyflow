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

import type { ChatMessage } from "../types";

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
  providerOptions?: Record<string, unknown>;
}

export interface TextGenerationResult {
  text: string;
  finishReason: string;
}

// ADR-0018 Decision 3: `schema` carries the neutral JSON-Schema subset
// (object/string/number/boolean/array/enum/required/maxItems/description)
// that S2 defines and the matching adapter translates into the provider's
// own dialect (e.g. Gemini's `responseSchema`). Left as `unknown` in S0 --
// no schema builder is rewritten yet, and no call site is wired to this
// interface, so narrowing it now would be speculative. S2 narrows this
// type when the builders themselves are rewritten.
export interface StructuredGenerationRequest {
  system?: string;
  turns: ChatMessage[];
  schema: unknown;
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, unknown>;
}

// Deliberately just the raw text, per ADR-0018 Decision 1's own comment:
// "the provider never returns a 'typed' object it claims is valid."
// Parsing/validation stays in SmartFlow code (modelJsonParsing.ts + the
// existing validators) -- unchanged and unmoved by this ADR (Decision 3).
export interface StructuredGenerationResult {
  rawText: string;
  finishReason: string;
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
  // The <T> type parameter is carried over verbatim from ADR-0018 Decision
  // 1's own interface text (a call-site type hint for the caller's later
  // parse/validate step) -- StructuredGenerationResult itself never carries
  // a T-typed value; see that interface's own comment for why.
  generateStructured<T>(req: StructuredGenerationRequest): Promise<StructuredGenerationResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number; // 768 today -- a contract, not a default
  readonly normalizesOutput: boolean; // false for gemini-embedding-001 @768
  embed(texts: string[]): Promise<EmbeddingResult>;
}
