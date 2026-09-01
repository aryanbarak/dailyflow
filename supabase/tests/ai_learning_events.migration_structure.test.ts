import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ALF-0: reads the ai_learning_events migration as text and asserts the
// load-bearing structural pieces are present, mirroring
// personal_memory_records.migration_structure.test.ts's convention. Not a
// live-database test.

const MIGRATION_PATH = join(__dirname, "..", "migrations", "20260901000000_ai_learning_events.sql");
const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("ai_learning_events migration structure", () => {
  it("defines the table", () => {
    expect(sql).toMatch(/create table if not exists public\.ai_learning_events/);
  });

  it("declares every required column", () => {
    for (const column of [
      "id uuid primary key",
      "user_id uuid not null references auth.users(id)",
      "session_id uuid",
      "source_message_id uuid",
      "correlation_id text not null",
      "idempotency_key text not null",
      "learning_task text not null",
      "schema_version text not null",
      "event_kind text not null",
      "producer_type text not null",
      "provider_id text",
      "model_id text",
      "model_version text",
      "label_confidence text",
      "source_hash text",
      "payload jsonb not null default '{}'::jsonb",
    ]) {
      expect(sql, `expected column definition: ${column}`).toContain(column);
    }
  });

  it("closes the learning_task enum to exactly the ALF-0 task", () => {
    expect(sql).toMatch(/learning_task in \('intent_routing_v1'\)/);
  });

  it("binds learning_task to its exact required schema_version via an explicit CHECK, closing the fallback that let an unregistered schema_version through (architectural review correction, round 2)", () => {
    expect(sql).toContain("constraint ai_learning_events_task_schema_version_check check (");
    expect(sql).toContain("when 'intent_routing_v1' then schema_version = 'intent-routing-v1'");
    // The `case` must fail closed for anything outside its known
    // when-branches -- an `else true` (or no else at all, which in SQL's
    // `case` defaults to NULL and would NOT reliably fail the CHECK)
    // would silently let a future unrecognized learning_task value's
    // schema_version through unconstrained.
    expect(sql).toMatch(/else false\s*\n\s*end/);
  });

  it("closes the event_kind enum to exactly the five append-only lifecycle kinds, in order", () => {
    expect(sql).toMatch(
      /event_kind in \('turn_observed', 'production_label', 'shadow_prediction', 'user_feedback', 'execution_outcome'\)/,
    );
  });

  it("closes the producer_type enum to exactly the four producers", () => {
    expect(sql).toMatch(/producer_type in \('deterministic_policy', 'shadow_model', 'user', 'execution_verifier'\)/);
  });

  it("closes the label_confidence enum, nullable, to exactly the four confidence tiers", () => {
    expect(sql).toMatch(
      /label_confidence is null or label_confidence in \('candidate', 'validated', 'user_confirmed', 'execution_verified'\)/,
    );
  });

  it("requires payload to be a JSON object, never an array or scalar", () => {
    expect(sql).toContain("jsonb_typeof(payload) = 'object'");
  });

  it("idempotency_key uniqueness is scoped to (user_id, idempotency_key), never globally unique on its own (architectural review correction)", () => {
    // idempotency_key itself is NOT column-level unique -- global
    // uniqueness would let one user's caller-supplied key collide with
    // an unrelated user's. Assert the bare column definition carries no
    // `unique` keyword...
    expect(sql).toContain("idempotency_key text not null,");
    expect(sql).not.toMatch(/idempotency_key text not null unique/);
    // ...and that uniqueness is instead a named composite constraint
    // scoped by user_id, matching agent_tool_executions'
    // (user_id, request_id) idempotency convention.
    expect(sql).toContain("constraint ai_learning_events_user_idempotency_key_unique unique (user_id, idempotency_key)");
  });

  it("indexes user_id+created_at, correlation_id, and the task/kind timeline query shape", () => {
    expect(sql).toContain("create index if not exists ai_learning_events_user_created_idx");
    expect(sql).toMatch(/on public\.ai_learning_events \(user_id, created_at desc\)/);
    expect(sql).toContain("create index if not exists ai_learning_events_correlation_idx");
    expect(sql).toMatch(/on public\.ai_learning_events \(correlation_id\)/);
    expect(sql).toContain("create index if not exists ai_learning_events_task_kind_idx");
    expect(sql).toMatch(/on public\.ai_learning_events \(learning_task, event_kind, created_at desc\)/);
  });

  it("enables RLS and grants NO browser access at all -- stricter than the SELECT-own pattern other ledger tables use", () => {
    expect(sql).toContain("alter table public.ai_learning_events enable row level security");
    expect(sql).toContain("revoke all on public.ai_learning_events from anon, authenticated");
    // Deliberately no `grant select ... to authenticated` anywhere for
    // this table -- assert the string never appears, so a future edit
    // that adds browser SELECT access trips this test instead of shipping
    // silently.
    expect(sql).not.toMatch(/grant select[^;]*to authenticated/);
  });

  it("grants full access only to service_role", () => {
    expect(sql).toContain("grant select, insert, update, delete on public.ai_learning_events to service_role");
  });

  it("defines no UPDATE-oriented function or trigger -- append-only is an application-code discipline, not a DB mechanism, per this migration's own header comment", () => {
    expect(sql).not.toMatch(/create (or replace )?function/);
    expect(sql).not.toMatch(/create trigger/);
  });
});
