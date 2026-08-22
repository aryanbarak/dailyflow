// Task PA-02 (docs/architecture/notes/provider-coupling-audit-v1.md §4):
// one shared JSON-object parser for a model's `responseMimeType:
// 'application/json'` output, replacing three Worker-side implementations
// that had independently diverged into three different fence-handling
// policies for the same underlying provider quirk -- reasoning-endpoint.ts's
// extractJsonObject (no fence-stripping), personal-memory-extraction-
// endpoint.ts's stripJsonFence+parse (fence-stripping), and
// context-derivation-endpoint.ts's inline parse (no fence-stripping, no
// comment explaining the omission -- the audit's own finding). This module
// is pre-work only: a single, consistent parsing policy, not a provider
// abstraction interface. Client-side llmReasoningService.ts's own extractJson
// is untouched -- it is more permissive by design (tolerates a JSON object
// anywhere in the string, not just the whole trimmed response) and lives
// on the other side of the browser/Worker boundary.
//
// Fence-stripping only handles a SINGLE ```json ... ``` or ``` ... ```
// fence wrapping the ENTIRE response (same narrow shape personal-memory-
// extraction-endpoint.ts's own prior stripJsonFence used) -- never touches
// content in the middle of an otherwise-bare object, and does not attempt
// to find a JSON object embedded after leading prose (a prose-prefixed
// response is rejected, not rescued -- see this module's own test file).
//
// Naming note: "modelJsonParsing", not "geminiJsonParsing" -- this file
// takes and returns plain text/unknown, with no Gemini-specific type or
// field name anywhere in it. Whether that naming choice matters beyond
// this file is exactly what a future Provider Abstraction ADR (ADR-0018)
// would decide; this task does not create or imply an AIProvider interface.
//
// Cross-import note: there is no actual "zero-cross-import convention"
// between sibling agent/worker/*.ts files (see this task's own report) --
// chat-attachment-context.ts already imports ProviderFailureTaxonomy from
// document-memory-extraction-endpoint.ts. The only real, documented
// constraint is that agent/worker/ cannot import src/features/* (a
// separate, zero-runtime-dependency deployable unit -- see every other
// file in this directory's own header comment). This module is imported
// freely by its three callers below.

/**
 * Thrown when `rawText` (after fence-stripping and trimming) is not
 * parseable as a single JSON object. `failedText` is that same
 * fence-stripped, trimmed text -- callers that want to log/report a
 * truncated snippet for diagnosis read it from here rather than
 * re-deriving their own trim/fence-strip pass.
 */
export class ModelJsonParseError extends Error {
  readonly failedText: string

  constructor(message: string, failedText: string) {
    super(message)
    this.name = 'ModelJsonParseError'
    this.failedText = failedText
  }
}

function stripJsonFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : text
}

/**
 * Parses `rawText` as exactly one JSON object: trims, strips a single
 * wrapping markdown fence if present, requires the result to start with
 * `{` and end with `}`, then `JSON.parse`s it. Throws `ModelJsonParseError`
 * (never a bare `Error`/`SyntaxError`) on any failure, so every caller can
 * catch one error type regardless of which check failed.
 */
export function parseModelJsonObject(rawText: string): unknown {
  const trimmed = stripJsonFence(rawText.trim())
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new ModelJsonParseError('Model response must be exactly one JSON object.', trimmed)
  }
  try {
    return JSON.parse(trimmed)
  } catch (parseError) {
    throw new ModelJsonParseError(`Model response was not valid JSON (${(parseError as Error).message}).`, trimmed)
  }
}
