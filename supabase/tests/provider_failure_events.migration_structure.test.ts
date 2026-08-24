import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR-0018 (Capability-Oriented AI Provider Abstraction), Decision 6, S0.
// Same static-structure pattern as
// finance_import_batches.migration_structure.test.ts -- NOT a live-database
// test (this migration is authored only, not applied; see that file's own
// header comment for why a static text-read test is the right tool here:
// RLS grants zero access to anon/authenticated, so there is no per-user
// ownership scenario to prove live, only "authenticated/anon have zero
// grants", which this test asserts directly against the migration text).

const MIGRATION_PATH = join(
  __dirname,
  "..",
  "migrations",
  "20260823000000_provider_failure_events.sql",
);
const sql = readFileSync(MIGRATION_PATH, "utf8");

// ADR-0018 S1c: a SEPARATE, additive migration -- the 20260823000000
// migration above is already applied to production (2026-08-23) and is
// immutable; this one is authored only, not applied, per this file's own
// header comment's static-structure-test rationale.
const EVENT_KIND_MIGRATION_PATH = join(
  __dirname,
  "..",
  "migrations",
  "20260824000000_provider_failure_events_event_kind.sql",
);
const eventKindSql = readFileSync(EVENT_KIND_MIGRATION_PATH, "utf8");

describe("provider_failure_events migration structure (ADR-0018 Decision 6)", () => {
  it("defines the table", () => {
    expect(sql).toMatch(/create table if not exists public\.provider_failure_events/);
  });

  it("declares every required column from ADR-0018 Decision 6's minimum set", () => {
    for (const column of [
      "id uuid primary key default gen_random_uuid()",
      "capability text not null check (capability in ('text_generation', 'structured_generation', 'embedding'))",
      "provider_id text not null",
      "http_status integer",
      "occurred_at timestamptz not null default now()",
      "request_id text",
    ]) {
      expect(sql, `expected column definition: ${column}`).toContain(column);
    }
  });

  it("indexes occurred_at (supports the 30-day retention cleanup query)", () => {
    expect(sql).toContain("create index if not exists provider_failure_events_occurred_at_idx");
    expect(sql).toMatch(/on public\.provider_failure_events \(occurred_at\)/);
  });

  it("enables RLS and grants ONLY service_role -- authenticated/anon are fully revoked, no policy exists for either", () => {
    expect(sql).toContain("alter table public.provider_failure_events enable row level security");
    expect(sql).toContain("revoke all on public.provider_failure_events from anon, authenticated");
    expect(sql).toContain("grant select, insert, update, delete on public.provider_failure_events to service_role");
    // No CREATE POLICY statement at all -- RLS is enabled with zero
    // policies for anon/authenticated (default-deny); service_role
    // bypasses RLS entirely, so it needs none either. Asserts the CURRENT
    // zero-policy state directly, same as finance_import_batches's own
    // structural test.
    expect(sql).not.toMatch(/create policy/i);
  });

  it("never stores prompt content or response bodies -- the table's own column list (not this file's prose comments) has no such column", () => {
    const tableBlock = sql.match(/create table if not exists public\.provider_failure_events \(([\s\S]*?)\n\);/)?.[1];
    expect(tableBlock, "expected to find the create table column block").toBeDefined();
    expect(tableBlock).not.toMatch(/\bprompt\b/i);
    expect(tableBlock).not.toMatch(/response_body/i);
    expect(tableBlock).not.toMatch(/\bmessage\b/i);
  });

  it("documents the table's purpose and trust model in a COMMENT ON TABLE", () => {
    expect(sql).toContain("comment on table public.provider_failure_events is");
  });
});

describe("provider_failure_events event_kind migration structure (ADR-0018 S1c)", () => {
  it("is a separate, additive ALTER TABLE against the existing table -- not an edit to the applied 20260823000000 migration", () => {
    expect(eventKindSql).toMatch(/alter table public\.provider_failure_events\s+add column if not exists event_kind/);
    // Confirms this file did NOT touch the already-applied migration's own
    // CREATE TABLE statement.
    expect(sql).toContain("create table if not exists public.provider_failure_events");
    expect(sql).not.toContain("event_kind");
  });

  it("declares event_kind as text, NOT NULL, defaulted to 'failure', constrained to exactly the two known kinds", () => {
    expect(eventKindSql).toContain(
      "add column if not exists event_kind text not null default 'failure'",
    );
    expect(eventKindSql).toContain("check (event_kind in ('failure', 'fallback_success'))");
  });

  it("documents the column's purpose in a COMMENT ON COLUMN", () => {
    expect(eventKindSql).toContain("comment on column public.provider_failure_events.event_kind is");
  });
});
