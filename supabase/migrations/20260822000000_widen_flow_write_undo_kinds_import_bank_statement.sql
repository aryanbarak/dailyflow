-- Task 45c, ADR-0017: widen flow_write_undo_records.kind to accept the new
-- import_bank_statement undo kind, mirroring the existing task/calendar/
-- finance kinds. Authored only. Do not apply to production without PO
-- authorization.
--
-- Unlike every other kind in this constraint, one import_bank_statement
-- undo record reverses an ENTIRE BATCH, not a single row: task_id holds
-- only the first inserted transaction's id (a generic id slot, same
-- "reused NOT NULL column" convention the task 22/28 migrations already
-- established), while the full list of transaction ids the batch inserted
-- lives in `payload` (the same JSONB column update_task/update_calendar_
-- event already use for their own `previous` snapshot) -- see
-- agent/worker/flow-write-policy.ts's UndoEntry/persistUndoRecord/
-- consumeUndoRecord for the read/write of that shape.
--
-- STRUCTURAL LESSON reminder (task 22-fix2's own root cause, restated by
-- every widening migration since): flow-write-policy.test.ts's
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
  check (kind in ('create_task', 'update_task', 'create_calendar_event', 'update_calendar_event', 'create_finance_transaction', 'import_bank_statement'));
