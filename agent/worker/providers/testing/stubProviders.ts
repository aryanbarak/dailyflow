// SmartFlow -- ADR-0018 S4: shared test helper for mocking the THREE
// provider interfaces instead of Gemini's raw wire format. Endpoint tests
// migrated in S4 use these via `vi.mock('./providers/createProviders', ...)`
// (see any migrated *.test.ts file's own top-of-file setup for the exact
// pattern) so a test configures "what the provider returned/threw" instead
// of "what JSON Gemini's HTTP response contained" -- Gemini's own wire
// format is tested in exactly one place now: the adapter test files
// (GeminiTextGenerationProvider.test.ts,
// GeminiStructuredGenerationProvider.test.ts,
// GeminiEmbeddingProvider.test.ts).
//
// Deliberately dumb (task instruction): each stub is driven by a plain
// handler function the test supplies. No retry logic, no default
// responses, no validation of what the handler returns -- if a handler is
// wrong, the calling endpoint code should fail exactly as it would against
// a wrong real provider response, not be rescued by helper logic that
// could itself be a second place to get the behavior wrong.
import type {
  EmbeddingProvider,
  EmbeddingResult,
  StructuredGenerationProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from '../types'
import type { Providers } from '../createProviders'

type MaybePromise<T> = T | Promise<T>

/** Records every request the stub received, in order -- for tests that assert on what the CALL SITE sent (not what the adapter would send on the wire; that's the adapter tests' job). */
export class StubTextGenerationProvider implements TextGenerationProvider {
  readonly id = 'stub-text'
  readonly calls: TextGenerationRequest[] = []

  constructor(
    private readonly handler: (req: TextGenerationRequest, callIndex: number) => MaybePromise<TextGenerationResult>,
  ) {}

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    const callIndex = this.calls.length
    this.calls.push(req)
    return this.handler(req, callIndex)
  }
}

export class StubStructuredGenerationProvider implements StructuredGenerationProvider {
  readonly id = 'stub-structured'
  readonly calls: StructuredGenerationRequest[] = []

  constructor(
    private readonly handler: (req: StructuredGenerationRequest, callIndex: number) => MaybePromise<StructuredGenerationResult>,
  ) {}

  async generateStructured(req: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    const callIndex = this.calls.length
    this.calls.push(req)
    return this.handler(req, callIndex)
  }
}

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'stub-embedding'
  readonly model = 'stub-embedding-model'
  readonly dimensions = 768
  readonly normalizesOutput = true
  readonly calls: string[][] = []

  constructor(
    private readonly handler: (texts: string[], callIndex: number) => MaybePromise<EmbeddingResult>,
  ) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const callIndex = this.calls.length
    this.calls.push(texts)
    return this.handler(texts, callIndex)
  }
}

/** A handler that always throws -- for the two capabilities a given test never exercises, so an unexpected call fails loudly and specifically instead of silently returning a default. */
function unconfigured(capability: string): () => never {
  return () => {
    throw new Error(`Stub${capability}Provider: no handler configured for this test -- did the code under test call a capability this test didn't expect?`)
  }
}

/**
 * Builds a full `Providers` object for one test, filling in any capability
 * the test doesn't care about with a stub that throws immediately if
 * actually called (see `unconfigured` above) -- a silent default response
 * would let a real bug (calling the wrong capability) pass unnoticed.
 */
export function stubProviders(overrides: {
  text?: TextGenerationProvider
  structured?: StructuredGenerationProvider
  embedding?: EmbeddingProvider
} = {}): Providers {
  return {
    text: overrides.text ?? new StubTextGenerationProvider(unconfigured('Text')),
    structured: overrides.structured ?? new StubStructuredGenerationProvider(unconfigured('Structured')),
    embedding: overrides.embedding ?? new StubEmbeddingProvider(unconfigured('Embedding')),
  }
}
