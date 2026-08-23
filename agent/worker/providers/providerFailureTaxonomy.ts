// SmartFlow -- ADR-0018 S1: unifies the "task 14" provider-failure
// taxonomy that used to be independently duplicated in
// document-memory-extraction-endpoint.ts and context-derivation-
// endpoint.ts (word-for-word identical type + error class in both). One
// definition now; both files import it instead of re-declaring it.
//
// Distinct from provider-errors.ts's ProviderUnavailableError: that one is
// a binary "did the provider fail to respond usably" signal used by the
// Gemini adapter and the INC-01 call sites (network/429/5xx). This is a
// richer, THREE-way business classification specific to callers that need
// to tell "the provider rejected our request" (a config problem on our
// side) apart from "the provider is unreachable" apart from "the provider
// answered, but the output itself was unusable" -- each gets different
// user-facing copy (each importer keeps its own domain-specific
// TAXONOMY_MESSAGES/DERIVATION_TAXONOMY_MESSAGES record; only the TYPE and
// the ERROR CLASS are unified here, not the wording).
//
// personal-memory-extraction-endpoint.ts independently redeclares this
// same type/class too and is NOT migrated to import from here in this
// slice -- its own Gemini calls are all STRUCTURED generation (S2 scope,
// not S1's text-generation scope), so touching it here would be reaching
// past this slice's boundary. Flagged, not fixed -- see the S1 report.
export type ProviderFailureTaxonomy = 'PROVIDER_REQUEST_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'MODEL_OUTPUT_UNUSABLE'

export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly taxonomy: ProviderFailureTaxonomy,
    readonly providerStatus?: number,
    readonly providerDetail?: string,
  ) {
    super(message)
    this.name = 'ProviderCallError'
  }
}
