-- Task 22 (calendar write slice): widen flow_write_undo_records.kind to
-- accept calendar-event undo entries, mirroring the existing task kinds.
-- Authored only. Do not apply to production without PO authorization.
--
-- No change to flow_write_permissions: domain/action are already
-- unconstrained free text (flow_write_permissions_domain_action_nonempty
-- only checks non-empty), so ('calendar', 'create')/('calendar', 'update')
-- rows already insert and read fine -- missing rows resolve conservatively
-- in code via defaultFlowWriteMode, per ADR-0012. No row-seeding needed.
--
-- task_id is reused as-is to hold a calendar_events id for the new kinds
-- (verified: it carries no foreign-key constraint to `tasks`, only
-- `not null`, so it is already a generic "the row this undo entry is
-- about" id slot) -- not renamed, to avoid touching every existing
-- reader/writer of this column for a cosmetic-only change.

alter table public.flow_write_undo_records
  drop constraint if exists flow_write_undo_records_kind_check;

alter table public.flow_write_undo_records
  add constraint flow_write_undo_records_kind_check
  check (kind in ('create_task', 'update_task', 'create_calendar_event', 'update_calendar_event'));
