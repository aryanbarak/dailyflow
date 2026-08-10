-- Reality reconciliation (task 15, PO-approved direction: production is the
-- source of truth for data reality; migrations are corrected to describe it).
-- Basis: docs/status/prod-schema-parity-2026-08.md (task 13), re-verified
-- live via `supabase db diff --linked --schema public` (read-only,
-- schema-only) on 2026-08-10 before authoring this file.
--
-- Scope: the three high-risk findings only. All statements are idempotent
-- so this migration converges both a fresh environment and production
-- (where most of it is already true) to the same end state, and is a no-op
-- if re-run.

-- ── 1. profiles.preferences ──────────────────────────────────────────────
-- Migration-defined, absent in production. Confirmed dead: profileService.ts
-- selects/inserts/updates an explicit column list
-- (id,user_id,display_name,bio,created_at,updated_at) that never mentions
-- `preferences`; no other src/ reference to a DB-backed profiles.preferences
-- exists (src/hooks/usePreferences.ts is an unrelated localStorage-only
-- hook). Removed from the migration-defined schema rather than created in
-- production.
alter table public.profiles drop column if exists preferences;

-- ── 2. user_settings.id ──────────────────────────────────────────────────
-- Migration-defined standalone `id` column; production's real primary key
-- is `user_id` directly, no separate `id` at all. Confirmed no live code
-- depends on `id`: SettingsPage.tsx and LanguageProvider.tsx (UI) and
-- agent/worker/context-builder.ts + agent/worker/index.ts (worker) only
-- ever select/upsert `user_id` and `language`; the upsert's `onConflict` is
-- `user_id`. Reconciled to production's shape.
alter table public.user_settings drop constraint if exists user_settings_pkey;
alter table public.user_settings drop constraint if exists user_settings_user_id_key;
drop index if exists public.user_settings_user_id_idx;
alter table public.user_settings drop column if exists id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_settings'::regclass
      and contype = 'p'
  ) then
    alter table public.user_settings
      add constraint user_settings_pkey primary key (user_id);
  end if;
end $$;

-- ── 3. playlist_tracks.user_id (+ FK + RLS policy) ───────────────────────
-- Exists in production (NOT NULL, FK to auth.users, own RLS policy),
-- absent from all migrations. Recreates production's real ownership model
-- so a fresh environment reproduces production's actual security posture.
-- NOTE (discovered during re-verification, outside this migration's
-- scope): production's column has no default and no populating trigger,
-- and src/features/music/musicService.ts `addTrackToPlaylist` inserts into
-- playlist_tracks without setting user_id — flagged separately in the task
-- report for PO/eng attention; this migration only documents the schema,
-- it does not change app behavior.
alter table public.playlist_tracks add column if not exists user_id uuid;
alter table public.playlist_tracks alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'playlist_tracks_user_id_fkey'
      and conrelid = 'public.playlist_tracks'::regclass
  ) then
    alter table public.playlist_tracks
      add constraint playlist_tracks_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

drop policy if exists "owner" on public.playlist_tracks;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'playlist_tracks'
      and policyname = 'Users manage own playlist_tracks'
  ) then
    create policy "Users manage own playlist_tracks"
      on public.playlist_tracks
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
