-- MB-23, ADR-0015 §14 (extended): journey_progress gains checkpoint_score --
-- "the score you had at your last saved room", restored verbatim by
-- "Continue Journey", distinct from best_total_score (a completed run's
-- record, untouched by this migration). Additive ALTER TABLE against the
-- already-applied 20260820000000_journey_persistence.sql migration -- that
-- file is never edited once applied, per standard practice.
--
-- This migration creates the FILE only -- it is not applied to any database
-- as part of MB-23 (Tier-1, requires explicit PO "برو" before
-- `supabase db push`/`migration up`), same precedent as MB-19/MB-21.

alter table public.journey_progress
  add column if not exists checkpoint_score integer not null default 0
    check (checkpoint_score >= 0);

comment on column public.journey_progress.checkpoint_score is
  'MB-23, ADR-0015 §14: the live score at the last room-completion checkpoint (farthest_room), restored verbatim by "Continue Journey". Written in the SAME upsert as farthest_room, not a separate write. Distinct from best_total_score, which remains the best completed RUN''s total score.';
