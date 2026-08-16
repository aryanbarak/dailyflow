-- Task 28 (finance write slice): widen flow_write_undo_records.kind to
-- accept the new create_finance_transaction undo kind, mirroring the
-- existing task/calendar kinds. Authored only. Do not apply to production
-- without PO authorization.
--
-- No flow_write_permissions seed for ('finance', 'create'): domain/action
-- are already unconstrained free text (flow_write_permissions_domain_action_
-- nonempty only checks non-empty, per the task 22 calendar migration's own
-- header comment), so this row already reads/writes fine with no schema
-- change -- a missing row resolves conservatively in code via
-- defaultFlowWriteMode/resolveServerFlowWriteMode, which additionally
-- hard-clamps 'finance' to 'ask' even if a row explicitly requested 'auto'
-- (see agent/worker/flow-write-policy.ts's own comment on that clamp). A
-- seed row here would be redundant with that code-level guarantee, not a
-- prerequisite for it -- see the task 28 report for this called out as a
-- deviation from the task's own migration description, not an oversight.
--
-- task_id is reused as-is to hold a finance_transactions id for this new
-- kind (same generic "the row this undo entry is about" id slot the task
-- 22 migration already established for calendar_events ids -- verified,
-- again, that this column carries no foreign-key constraint to `tasks`).
--
-- STRUCTURAL LESSON reminder (task 22-fix2's own root cause, restated by
-- the task 22 migration): flow-write-policy.test.ts's
-- "UNDO_KIND_VALUES cross-checked against the migration file" describe
-- block reads THIS FILE's CHECK clause and fails the build if it and
-- UNDO_KIND_VALUES (itself derived from shared/writeIntentRegistry.ts's
-- own `undoKind` field) ever disagree -- confirmed locally before this
-- migration was authored, by intentionally running that test against the
-- registry entry with this migration still missing.
alter table public.flow_write_undo_records
  drop constraint if exists flow_write_undo_records_kind_check;

alter table public.flow_write_undo_records
  add constraint flow_write_undo_records_kind_check
  check (kind in ('create_task', 'update_task', 'create_calendar_event', 'update_calendar_event', 'create_finance_transaction'));
