// Task 18, A1: source-verification for the authored-not-applied migration
// widening documents.type and document_chunks.extraction_method. Mirrors
// the source-scan pattern already established for other not-yet-applied
// migrations in this codebase (task 16's own tests read its migration
// files the same way) -- a live replay against a real Postgres shadow DB
// was ALSO performed manually for this task (see the task 18 report,
// section B) since that verifies actual constraint enforcement in a way a
// text scan cannot; this test guards the SQL text itself against silent
// drift in CI, where a live Supabase/Docker stack is not available.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  path.resolve(process.cwd(), "supabase", "migrations", "20260812000000_document_types_and_sensitivity.sql"),
  "utf-8",
);

describe("20260812000000_document_types_and_sensitivity.sql (task 18, A1)", () => {
  it("is explicitly marked NOT applied, pending PO authorization", () => {
    expect(migrationSource).toMatch(/NOT applied by this task/);
  });

  it("widens documents.type to accept exactly the four recognized types, NULL still allowed", () => {
    expect(migrationSource).toMatch(
      /check \(type is null or type in \('resume', 'financial', 'personal', 'business'\)\)/,
    );
  });

  it("widens document_chunks.extraction_method to accept model_transcription and native_text", () => {
    expect(migrationSource).toMatch(
      /check \(extraction_method in \('model_transcription', 'native_text'\)\)/,
    );
  });

  it("is idempotent by construction -- every ALTER is preceded by its own DROP CONSTRAINT IF EXISTS", () => {
    expect(migrationSource).toMatch(/drop constraint if exists documents_type_check;/);
    expect(migrationSource).toMatch(/drop constraint if exists document_chunks_extraction_method_check;/);
  });
});
