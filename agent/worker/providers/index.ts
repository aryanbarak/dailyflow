// SmartFlow -- ADR-0018, S0. Re-exports only -- no logic lives in this
// file. Barrel for the providers/ module.

export type {
  EmbeddingProvider,
  EmbeddingResult,
  StructuredGenerationProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "./types";

// INC-01 / ADR-0018 Decision 6: ProviderUnavailableError is the single
// classification for network/429/5xx failures across all three
// capabilities -- re-exported here (not moved, not renamed) so callers of
// the providers/ module can import both the contracts and the error type
// from one place, matching this ADR's framing of it as part of the
// provider boundary's own vocabulary.
export { ProviderUnavailableError } from "../provider-errors";
