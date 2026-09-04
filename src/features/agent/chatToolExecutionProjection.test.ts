import { describe, expect, it } from "vitest";
import {
  applyProjectedExecutionUpdate,
  correlateExecutionsToMessages,
  executionArgumentLines,
  isAgentToolExecutionLifecycleStatus,
  projectExecutionRow,
  type AgentToolExecutionLifecycleStatus,
  type AgentToolExecutionRow,
} from "./chatToolExecutionProjection";

const LABELS = {
  title: "Title",
  due: "Due",
  reminder: "Reminder",
  notes: "Notes",
  start: "Start",
  end: "End",
};

function row(overrides: Partial<AgentToolExecutionRow> = {}): AgentToolExecutionRow {
  return {
    id: "exec-1",
    session_id: "session-1",
    chat_message_id: "msg-1",
    request_id: "req-1",
    tool_id: "tasks.create",
    domain: "tasks",
    action: "create",
    normalized_arguments: { title: "Call Ahmad", dueDate: "2026-09-01", timeOfDay: "09:00" },
    status: "approval_pending",
    created_at: "2026-09-01T10:00:00.000Z",
    approval_requested_at: "2026-09-01T10:00:00.000Z",
    approved_at: null,
    execution_started_at: null,
    completed_at: null,
    target_type: null,
    target_id: null,
    error_code: null,
    ...overrides,
  };
}

describe("Chat Runtime Truth V1: execution-row projection", () => {
  it("reconstruction 1: one execution row projects one card view model carrying the row's own status and bound arguments verbatim", () => {
    const projected = correlateExecutionsToMessages(["msg-1"], [row()], LABELS);
    expect(Object.keys(projected)).toEqual(["msg-1"]);
    expect(projected["msg-1"]).toHaveLength(1);
    expect(projected["msg-1"][0]).toMatchObject({
      key: "exec-1",
      executionId: "exec-1",
      toolId: "tasks.create",
      status: "approval_pending",
      title: "Call Ahmad",
    });
    // dueDate/timeOfDay VERBATIM -- the same approval-boundary discipline
    // the live 2B.2 card established.
    expect(projected["msg-1"][0].argumentLines).toEqual([
      "Title: Call Ahmad",
      "Due: 2026-09-01",
      "Reminder: 09:00",
    ]);
  });

  it("reconstruction 2 + 3: N rows for one chat message become N independent cards, deterministically ordered by created_at then id", () => {
    const rows = [
      row({ id: "exec-b", request_id: "2b2:msg-1:1", created_at: "2026-09-01T10:00:01.000Z", status: "failed", error_code: "TARGET_NOT_FOUND" }),
      row({ id: "exec-a", request_id: "2b2:msg-1:0", created_at: "2026-09-01T10:00:00.000Z", status: "succeeded", target_type: "task", target_id: "task-9" }),
      row({ id: "exec-c", request_id: "2b2:msg-1:2", created_at: "2026-09-01T10:00:01.000Z", status: "approval_pending" }),
    ];
    const projected = correlateExecutionsToMessages(["msg-1"], rows, LABELS);
    expect(projected["msg-1"].map((c) => c.key)).toEqual(["exec-a", "exec-b", "exec-c"]);
    // Statuses stay independent -- never collapsed into one synthetic one.
    expect(projected["msg-1"].map((c) => c.status)).toEqual(["succeeded", "failed", "approval_pending"]);
  });

  it("reconstruction 4 + 5: rows for other messages and orphaned rows (chat_message_id null, or naming a message not loaded) never render", () => {
    const rows = [
      row({ id: "exec-1", chat_message_id: "msg-1" }),
      row({ id: "exec-orphan-null", request_id: "r2", chat_message_id: null }),
      row({ id: "exec-orphan-gone", request_id: "r3", chat_message_id: "msg-deleted" }),
    ];
    const projected = correlateExecutionsToMessages(["msg-1", "msg-2"], rows, LABELS);
    expect(Object.keys(projected)).toEqual(["msg-1"]);
    expect(projected["msg-1"]).toHaveLength(1);
  });

  it("statuses 6-13: every durable lifecycle status projects verbatim -- approval_pending stays approvable-shaped, terminal stays terminal, uncertain stays uncertain", () => {
    const statuses: AgentToolExecutionLifecycleStatus[] = [
      "approval_pending", "approved", "executing", "succeeded", "failed", "denied", "expired", "revoked", "uncertain",
    ];
    for (const status of statuses) {
      const vm = projectExecutionRow(row({ status }), LABELS);
      // The card status IS the row status -- no interpretation layer, no
      // mapping of uncertain to success/failure, no auto-anything.
      expect(vm.status).toBe(status);
    }
  });

  it("multi-action 27: succeeded A + failed B survive projection with their own independent target/error facts", () => {
    const rows = [
      row({ id: "exec-a", request_id: "ra", created_at: "2026-09-01T10:00:00.000Z", status: "succeeded", target_type: "calendar_event", target_id: "event-1", completed_at: "2026-09-01T10:01:00.000Z" }),
      row({ id: "exec-b", request_id: "rb", created_at: "2026-09-01T10:00:01.000Z", status: "failed", error_code: "TARGET_NOT_FOUND" }),
    ];
    const projected = correlateExecutionsToMessages(["msg-1"], rows, LABELS);
    const [a, b] = projected["msg-1"];
    expect(a).toMatchObject({ status: "succeeded", targetType: "calendar_event", targetId: "event-1", completedAt: "2026-09-01T10:01:00.000Z", errorCode: null });
    expect(b).toMatchObject({ status: "failed", errorCode: "TARGET_NOT_FOUND", targetType: null });
  });

  it("calendar argument lines format the bound UTC instants through the shared date formatter, and update tools share their create sibling's lines", () => {
    const lines = executionArgumentLines(
      "calendar.update_event",
      { title: "Meeting", dateTimeStart: "2026-09-03T07:00:00.000Z", notes: "Bring notes" },
      LABELS,
    );
    expect(lines[0]).toBe("Title: Meeting");
    expect(lines[1]).toContain("Start: ");
    expect(lines[2]).toBe("Notes: Bring notes");
  });

  it("tasks.complete (and unknown tools) get no fabricated argument lines", () => {
    expect(executionArgumentLines("tasks.complete", {}, LABELS)).toEqual([]);
    expect(executionArgumentLines("finance.create_transaction", { amount: 10 }, LABELS)).toEqual([]);
  });

  it("applyProjectedExecutionUpdate patches exactly the named execution and never a sibling", () => {
    const projected = correlateExecutionsToMessages(["msg-1"], [
      row({ id: "exec-a", request_id: "ra", created_at: "2026-09-01T10:00:00.000Z" }),
      row({ id: "exec-b", request_id: "rb", created_at: "2026-09-01T10:00:01.000Z" }),
    ], LABELS);
    const updated = applyProjectedExecutionUpdate(projected, "exec-a", { status: "revoking" });
    expect(updated["msg-1"][0].status).toBe("revoking");
    expect(updated["msg-1"][1].status).toBe("approval_pending");
  });

  it("an unknown future status value is not part of the lifecycle vocabulary (the reader drops such rows instead of guessing)", () => {
    expect(isAgentToolExecutionLifecycleStatus("succeeded")).toBe(true);
    expect(isAgentToolExecutionLifecycleStatus("some_future_status")).toBe(false);
    expect(isAgentToolExecutionLifecycleStatus(null)).toBe(false);
  });
});
