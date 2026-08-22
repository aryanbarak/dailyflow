import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, l2Normalize } from './embeddingConfig'

describe('embeddingConfig (task PA-02, provider-coupling-audit-v1.md §5)', () => {
  it('EMBEDDING_MODEL is gemini-embedding-001', () => {
    expect(EMBEDDING_MODEL).toBe('gemini-embedding-001')
  })

  it('EMBEDDING_DIMENSIONS matches the vector(N) column in supabase/migrations/20260811000000_document_chunks_pgvector.sql', () => {
    // Reads the migration as text (same pattern the *.migration_structure.test.ts
    // files already use) rather than importing anything Supabase-specific --
    // this is the one place the audit found the dimension hard-coded a
    // THIRD time, independent of either TS constant. If a future migration
    // ever changes the column's dimension without updating this constant
    // (or vice versa), this test is the guard that catches it.
    const migrationPath = join(__dirname, '..', '..', 'supabase', 'migrations', '20260811000000_document_chunks_pgvector.sql')
    const sql = readFileSync(migrationPath, 'utf8')
    const match = sql.match(/embedding vector\((\d+)\)/)
    expect(match, 'expected to find an `embedding vector(N)` column definition in the migration').not.toBeNull()
    const migrationDimensions = Number(match![1])
    expect(EMBEDDING_DIMENSIONS).toBe(migrationDimensions)
  })

  describe('l2Normalize', () => {
    it('normalizes a classic 3-4-5 vector to unit length', () => {
      const normalized = l2Normalize([3, 4])
      expect(normalized[0]).toBeCloseTo(0.6, 10)
      expect(normalized[1]).toBeCloseTo(0.8, 10)
      const norm = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2)
      expect(norm).toBeCloseTo(1, 10)
    })

    it('leaves an already-unit vector unchanged', () => {
      expect(l2Normalize([1, 0, 0])).toEqual([1, 0, 0])
    })

    it('returns the zero vector unchanged rather than dividing by zero', () => {
      expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0])
    })
  })
})
