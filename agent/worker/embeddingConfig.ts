// Task PA-02 (docs/architecture/notes/provider-coupling-audit-v1.md §5):
// one source of truth for the embedding model name, requested dimension,
// and post-normalization step -- previously two independent copies
// (document-memory-extraction-endpoint.ts's EMBEDDING_MODEL/
// EMBEDDING_DIMENSIONS/l2Normalize and personal-memory-extraction-
// endpoint.ts's OVERLAP_EMBEDDING_MODEL/OVERLAP_EMBEDDING_DIMENSIONS/
// l2NormalizeOverlap), each citing "this file's own zero-cross-import
// convention" as the reason NOT to share them.
//
// That convention does not actually exist as a documented rule. PA-02
// checked before writing this file: there is no ADR, no lint rule, and no
// package.json boundary forbidding agent/worker/*.ts modules from
// importing each other -- chat-attachment-context.ts already imports
// ProviderFailureTaxonomy from document-memory-extraction-endpoint.ts, and
// agent/worker/index.ts imports freely from flow-write-policy.ts,
// context-builder.ts, proposal-outcome-recording.ts, and others. The ONLY
// real, documented constraint in this codebase (stated in every one of
// these files' own header comments) is that agent/worker/ cannot import
// src/features/* -- the Worker is a separate, zero-runtime-dependency
// deployable unit from the frontend. The "zero-cross-import convention"
// phrase appears to have been a misapplication of that real, different
// rule to justify a duplication that was actually just how these two
// files happened to be written. This module removes that duplication.
//
// EMBEDDING_NORM_EPSILON is deliberately NOT unified here -- out of this
// task's explicit scope (which named only EMBEDDING_MODEL,
// EMBEDDING_DIMENSIONS, and l2Normalize) -- each endpoint keeps its own
// epsilon constant for now.

// gemini-embedding-001 succeeded text-embedding-004, retired Jan 2026
// (task 16-fix). See document-memory-extraction-endpoint.ts's git history
// for the original migration; both endpoints requested the SAME model
// even before this file existed, just via two separately-declared
// constants of the same value.
export const EMBEDDING_MODEL = 'gemini-embedding-001'

// Requested via outputDimensionality -- gemini-embedding-001's native
// output is 3072-dim. Must match supabase/migrations/20260811000000_
// document_chunks_pgvector.sql's `embedding vector(768)` column exactly;
// see embeddingConfig.test.ts for a test asserting that match directly
// against the migration file's text.
export const EMBEDDING_DIMENSIONS = 768

function vectorNorm(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
}

// gemini-embedding-001 at a non-default outputDimensionality is NOT
// unit-normalized by the provider (unlike its native 3072-dim output) --
// per Gemini docs, callers requesting a truncated dimensionality must
// normalize client-side. Deterministic, no provider dependence beyond
// that documented behavior.
export function l2Normalize(values: readonly number[]): number[] {
  const norm = vectorNorm(values)
  if (norm === 0) return values.slice() as number[]
  return values.map((v) => v / norm)
}
