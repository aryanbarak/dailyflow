// SmartFlow -- ADR-0018 S3: implements EmbeddingProvider by wrapping
// exactly the request/response shape the 2 migrated [EMBEDDING] call sites
// (PA-01 §4) already used via direct fetch -- embedChunk
// (document-memory-extraction-endpoint.ts, persisted vectors) and
// embedTextForOverlap (personal-memory-extraction-endpoint.ts, transient
// dedup). Mirrors GeminiTextGenerationProvider.ts's/
// GeminiStructuredGenerationProvider.ts's own structure (fail-safe failure
// persistence via failureEvents.ts).
//
// NO model change, NO second provider, NO batch-endpoint switch in this
// slice (ADR-0018 Implementation Plan S3): `embed(texts)` maps to the
// EXISTING per-text embedContent call pattern, one fetch per text, exactly
// as both call sites already did. Adopting Gemini's actual batch endpoint
// would change the request shape and the failure granularity (one failure
// today fails one chunk; a batch failure would fail N at once) -- that is
// a behavior change, not a refactor, and explicitly out of scope here.
//
// Normalization now lives HERE, once: gemini-embedding-001 at a
// non-default outputDimensionality (768) is not unit-normalized by the
// provider itself (see embeddingConfig.ts's own comment) -- every vector
// this adapter returns is already L2-normalized. Call sites must not
// re-normalize; doing so would apply the same math twice (harmless for an
// already-unit vector algebraically, but it would mean two places silently
// claim ownership of the same invariant -- exactly what this slice
// consolidates away).
//
// What this adapter deliberately does NOT do (ADR-0018 Decision 3's own
// precedent, applied to the third capability): validate that a response's
// vector is exactly `dimensions` numbers long, or reject a degenerate
// (all-zero) vector. Both call sites already have their own
// domain-specific "was this usable" checks (a shape check, a
// post-normalization unit-norm sanity check) with their own wording and
// their own failure posture (one throws, one returns null) -- that
// judgment call stays with the caller, same as a non-STOP finishReason
// staying the caller's call for text/structured generation. This adapter
// only guarantees it returns SOMETHING of the interface's own type
// (number[][]) for each input text; a malformed or missing `values` field
// in the provider's response degrades to an empty array for that text,
// which both call sites' own existing shape checks already reject exactly
// as they did before migration (an empty array's length is never
// EMBEDDING_DIMENSIONS).
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, l2Normalize } from '../../embeddingConfig'
import { ProviderUnavailableError, fetchGeminiOrThrow } from '../../provider-errors'
import { recordProviderFailure, type ProviderFailureEnv } from '../failureEvents'
import type { EmbeddingProvider, EmbeddingResult } from '../types'

// Same structural-env pattern as the other two adapters' own
// GeminiProviderEnv -- see GeminiTextGenerationProvider.ts's comment for
// why this extends ProviderFailureEnv rather than the full
// agent/worker/types.ts `Env`. No GEMINI_MODEL field: embeddings pin their
// own model (EMBEDDING_MODEL, embeddingConfig.ts), unrelated to
// resolveGeminiModel's text/structured-generation model resolution.
export interface GeminiProviderEnv extends ProviderFailureEnv {
  GEMINI_API_KEY?: string
}

// ADR-0018 Decision 4: "a different model is a migration, not a config
// swap" -- a future second EmbeddingProvider whose native dimensions
// differ from EMBEDDING_DIMENSIONS (the persisted pgvector column width
// every real caller assumes) must never silently compute or persist a
// wrong-width vector. Distinct from provider-errors.ts's
// ProviderUnavailableError/ProviderRequestError on purpose: this is OUR
// config bug, not the provider's outage, so it is never passed to
// recordProviderFailure (nothing here ever constructs one from inside a
// `catch` of the provider call itself -- see embed() below, the assertion
// runs BEFORE any network call is made).
export class EmbeddingDimensionMismatchError extends Error {
  constructor(
    readonly actualDimensions: number,
    readonly expectedDimensions: number,
  ) {
    super(
      `Embedding provider declares ${actualDimensions} dimensions but ${expectedDimensions} were expected (EMBEDDING_DIMENSIONS). This is a configuration bug, not a provider outage.`,
    )
    this.name = 'EmbeddingDimensionMismatchError'
  }
}

// Exported standalone (not just inlined in embed()) so it is directly
// unit-testable against a fake `{ dimensions }` value -- the concrete
// GeminiEmbeddingProvider below can never actually diverge (both its own
// `dimensions` field and its comparison target read the same
// EMBEDDING_DIMENSIONS constant), so a real mismatch is only reachable
// today via this function called directly, guarding the INTERFACE
// contract (Decision 4) for whichever provider implementation is next.
export function assertEmbeddingDimensions(provider: Pick<EmbeddingProvider, 'dimensions'>): void {
  if (provider.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingDimensionMismatchError(provider.dimensions, EMBEDDING_DIMENSIONS)
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'gemini'
  readonly model = EMBEDDING_MODEL
  readonly dimensions = EMBEDDING_DIMENSIONS
  // gemini-embedding-001 at outputDimensionality=768 is NOT unit-normalized
  // by the provider (only its native 3072-dim output is) -- see
  // embeddingConfig.ts's own l2Normalize comment. This adapter normalizes
  // client-side before returning, but `normalizesOutput` describes the
  // PROVIDER's own behavior, not this adapter's -- false, unchanged from
  // the contract EmbeddingProvider's own comment already documented.
  readonly normalizesOutput = false

  constructor(
    private readonly env: GeminiProviderEnv,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    // Decision 4, "on first use, not import time": this cannot run at
    // module load (no provider instance -- let alone env -- exists yet);
    // this is the first point any real call actually uses this instance's
    // declared dimensions contract.
    assertEmbeddingDimensions(this)

    const vectors: number[][] = []
    for (const text of texts) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${this.env.GEMINI_API_KEY}`
      let res: Response
      try {
        res = await fetchGeminiOrThrow(
          this.fetcher,
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBEDDING_DIMENSIONS }),
          },
          'Gemini embedding',
        )
      } catch (err) {
        // ADR-0018 Decision 6: same fail-safe persistence as the other two
        // adapters, capability='embedding' this time. Always re-throws the
        // ORIGINAL error afterward, unchanged.
        if (err instanceof ProviderUnavailableError) {
          await recordProviderFailure(this.env, {
            capability: 'embedding',
            provider_id: this.id,
            http_status: err.status,
          }, this.fetcher)
        }
        throw err
      }

      const data = await res.json() as { embedding?: { values?: unknown } }
      const rawValues = data?.embedding?.values
      const values = Array.isArray(rawValues) && rawValues.every((v) => typeof v === 'number') ? (rawValues as number[]) : []
      vectors.push(l2Normalize(values))
    }

    return { vectors }
  }
}
