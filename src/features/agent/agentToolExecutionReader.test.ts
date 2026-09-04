import { describe, expect, it, vi } from "vitest";

// A minimal supabase-client stand-in that records every table/method the
// reader touches. Deliberately exposes NO insert/update/delete/upsert/rpc
// on the query builder at all -- if the reader (now or after a refactor)
// ever tried to call one, this test would throw on the missing method,
// which is exactly the "no browser write fallback exists" guarantee
// (slice security tests 28/29) expressed structurally. The database
// itself additionally revokes those verbs from the authenticated role
// (see the migration's grant block) -- this test covers the client side
// of the same boundary.
const recorded: { table?: string; filters: Array<[string, string]>; orders: string[] } = { filters: [], orders: [] };

vi.mock("@/integrations/supabase/client", () => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: string) => {
      recorded.filters.push([column, value]);
      return builder;
    }),
    order: vi.fn((column: string) => {
      recorded.orders.push(column);
      return builder;
    }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({
        data: [
          {
            id: "exec-1", session_id: "session-1", chat_message_id: "msg-1", request_id: "req-1",
            tool_id: "tasks.create", domain: "tasks", action: "create",
            normalized_arguments: { title: "Call Ahmad" }, status: "approval_pending",
            created_at: "2026-09-01T10:00:00.000Z", approval_requested_at: "2026-09-01T10:00:00.000Z",
            approved_at: null, execution_started_at: null, completed_at: null,
            target_type: null, target_id: null, error_code: null,
          },
          // A row whose status is outside the known lifecycle vocabulary
          // must be dropped, never guessed at.
          {
            id: "exec-2", session_id: "session-1", chat_message_id: "msg-1", request_id: "req-2",
            tool_id: "tasks.create", domain: "tasks", action: "create",
            normalized_arguments: {}, status: "some_future_status",
            created_at: "2026-09-01T10:00:01.000Z", approval_requested_at: null,
            approved_at: null, execution_started_at: null, completed_at: null,
            target_type: null, target_id: null, error_code: null,
          },
        ],
        error: null,
      }),
  };
  return {
    supabase: {
      from: vi.fn((table: string) => {
        recorded.table = table;
        return builder;
      }),
    },
  };
});

import { listSessionToolExecutions } from "./agentToolExecutionReader";

describe("Chat Runtime Truth V1: browser execution reader (SELECT-only, owner/session-scoped)", () => {
  it("issues exactly one owner- and session-filtered SELECT against agent_tool_executions, with deterministic ordering, and drops unknown-status rows", async () => {
    const rows = await listSessionToolExecutions("user-1", "session-1");

    expect(recorded.table).toBe("agent_tool_executions");
    expect(recorded.filters).toEqual([
      ["user_id", "user-1"],
      ["session_id", "session-1"],
    ]);
    expect(recorded.orders).toEqual(["created_at", "id"]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "exec-1", status: "approval_pending", chat_message_id: "msg-1" });
  });
});
