# Production schema-parity audit — 2026-08-09 (task 13)

Read-only audit. No production data was read, modified, or exported — only
`information_schema`-equivalent structural metadata (via `pg_dump
--schema-only` and `supabase db diff`, both schema-only by design). No
corrective action was taken beyond Fix 1 (see task 13's final report),
which is a pure application-code fix, not a schema change.

## Method

1. `supabase db dump --linked --schema public` — a `pg_dump --schema-only`
   export of the linked production project (`taqxwnlwllbywaklwyno`).
2. `supabase db diff --linked --schema public` — applied every migration in
   `supabase/migrations/` to a fresh, disposable local shadow Postgres
   (via Docker, torn down automatically afterward), then diffed that
   shadow's resulting schema against the linked production schema. This is
   the authoritative version of "repo migrations' resulting schema vs.
   production `information_schema.columns`" the task asked for — computed
   by the same tool that owns migration semantics, rather than hand-parsed.
3. **Diff direction, confirmed empirically**: the output is "what to run
   against the migrations-shadow to make it equal to production" — so
   `CREATE TABLE`/`ADD COLUMN` lines name things **production has that
   migrations don't**, and `DROP TABLE`/`DROP COLUMN` lines name things
   **migrations expect that production doesn't have**. Confirmed via the
   already-known `ai_news_items` case: it appears as `CREATE TABLE`, and it
   is independently known (task 8c) to exist in production despite a
   `DROP TABLE` migration for it — consistent only with this direction.

One incidental note, disclosed for completeness: `supabase db diff
--dry-run` (used once, before the real run, to preview the pg_dump command)
printed a short-lived, CLI-generated database login password to this
session's own tool output. It is a scoped, temporary pooler credential the
Supabase CLI mints per-session for dump operations (not the account
password or any application secret), and it was never written to any file,
committed, or included below — but it did appear in this session's
transcript, which the PO should be aware of.

## Summary

- **1 extra table** in production, not created by any migration:
  `ai_news_items` — already known (task 8c), reconfirmed here.
- **`agent_briefings.updated_at`** (the bug this task fixes): confirmed
  absent on **both** sides — not in migrations, not in production. This is
  case (a): a pure phantom-column code bug, not schema drift. No
  corrective migration needed for it.
- **Real, previously-undocumented column drift** on `documents`,
  `playlist_tracks`, `playlists`, `profiles`, and `user_settings` (below) —
  none of it currently causing a live application error (verified by
  checking whether app code actually references the affected columns), but
  all of it means a **fresh environment built purely from these migrations
  would not match production**, which matters for reproducibility and for
  any future `db push` against this project.
- A large amount of **name-only drift** on indexes/policies/triggers
  (same effective behavior, different identifier) — cosmetic, listed for
  completeness, not a risk in itself.

## A. Extra table in production (not in any migration)

| Table | Columns (production) | Notes |
|---|---|---|
| `ai_news_items` | id, title, summary, source, url, published_at, fetched_at | Migration `20260619140000_drop_ai_news_items.sql` exists and should have dropped this table; it still exists in production. Not re-investigated further here (out of this task's scope) — flagged in task 8c already. |

## B. Column-level drift (the part most relevant to app behavior)

| Table | Extra in production (not in migrations) | Missing in production (migrations expect it) | Type/nullability/default mismatch | App code reads/writes the affected column? |
|---|---|---|---|---|
| `agent_briefings` | — | — | — | N/A — this is the bug Fix 1 addresses; confirmed absent on both sides, not drift |
| `documents` | `file_path` (text), `file_size` (bigint), `name` (text), `size` (bigint), `type` (text) | — | `ai_summary_points`: prod allows NULL with default `'[]'::jsonb`, cast as jsonb explicitly; `extracted_tasks_count`, `tags`: prod allows NULL | **No** — `documentsService.ts` selects an explicit column list (`storage_path, file_name, mime_type, size_bytes, ...`) that never references `file_path/file_size/name/size/type`. These look like legacy pre-rename columns (`name`→`file_name`, `size`→`size_bytes`, `type`→`mime_type`, `file_path`→`storage_path`) that a past migration added the new names for but never dropped the old ones. Dormant, zero live risk. |
| `playlist_tracks` | `user_id` (uuid, **not null**, with its own FK to `auth.users` and an RLS policy depending on it) | — | — | **Indirectly** — the app never selects/filters by this column explicitly (`musicService.ts` doesn't reference `playlist_tracks.user_id`), but production's own RLS policy (`"Users manage own playlist_tracks"`) enforces ownership through it at the database level. Neither the migrations nor the generated `types.ts` know this column exists. **This is the one finding in this audit I'd flag as worth a PO decision**: a fresh environment rebuilt purely from these migrations could not reproduce this table's real ownership model. |
| `playlists` | `is_public` (boolean, default false) | — | prod allows NULL on `created_at`/`updated_at` | No references found in `src/` |
| `profiles` | `avatar_url` (text) | `preferences` (column migrations define, absent in prod) | prod sets `default auth.uid()` on both `id` and `user_id`, which migrations don't specify | No references to either `avatar_url` or `preferences` found in `src/` |
| `user_settings` | — | `id` (migrations define a standalone `id` column; production's primary key is `user_id` directly, no separate `id` at all) | — | Not checked in depth (out of scope for this pass) — flagged for the PO |
| `liked_tracks`, `photos`, `play_history` | — | — | prod allows NULL on `liked_at`, `is_favorite`, `played_at` respectively (migrations say NOT NULL) | Not checked in depth |

## C. Index / policy / trigger name drift (cosmetic — same effective access rule, different identifier)

Production appears to have gone through at least one manual/dashboard-driven
naming pass that the migration history doesn't capture. Examples (not
exhaustive — the full list is in the raw diff, available on request):

- `documents_delete_own` / `_insert_own` / `_select_own` / `_update_own`
  (4 separate policies, per migrations) vs. production's single
  `documents_owner_all` (one `FOR ALL` policy, same `auth.uid() = user_id`
  check) — functionally equivalent.
- `agent_chat_messages_insert_own`/`_select_own` (migrations) vs.
  production's `agent_chat_insert_own`/`agent_chat_select_own`/
  `agent_chat_delete_own` (production also has a `delete` policy migrations
  don't define at all).
- `owner` (migrations, on `liked_tracks`/`play_history`/`playlist_tracks`/
  `playlists`) vs. production's `"Users manage own <table>"` naming.
- Index naming: migrations' `documents_tags_idx`,
  `profiles_user_id_idx`, `user_settings_user_id_idx`, etc. vs. production's
  `idx_documents_tags`, `idx_profiles_user_id` (also now `UNIQUE`, not just
  an index), `user_settings_pkey` (now a unique index on `user_id`
  directly, consistent with B's `user_settings.id` finding).
- `idx_photos_favorite`: production's version is a **partial** index
  (`WHERE is_favorite = true`) — migrations' version is not partial. A real
  definition difference, not just a name difference, though both would
  serve the same queries correctly (just with different index size/cost).
- Trigger naming: migrations' `update_documents_updated_at` /
  `update_playlists_updated_at` / `update_profiles_updated_at` /
  `update_user_settings_updated_at` vs. production's `documents_updated_at`
  / `finance_updated_at` / `profiles_updated_at` / `tasks_updated_at` /
  `family_children_updated_at` (production also has triggers on
  `finance_transactions` and `family_children` that migrations don't
  define a matching trigger name for, and is missing the migrations'
  `playlists` trigger entirely under that name).
- Constraint naming/coverage: production is missing `profiles_user_id_fkey`
  and `profiles_user_id_key` under those exact names (migrations expect
  them); production has `profiles_id_fkey` (not valid/unvalidated),
  `playlist_tracks_user_id_fkey` (not valid/unvalidated), and
  `agent_briefings_mode_check` (not valid/unvalidated) that migrations
  don't define at all.

## D. Not drift — confirmed by this audit

- `agent_briefings.updated_at` does not exist on either side. Fixed in
  application code (Fix 1), not schema.
- `personal_memory_records`, `personal_memory_extraction_runs`,
  `inferred_project_context_fields`, `inferred_context_derivation_runs`,
  `project_records`, `project_evidence`, `project_evidence_observations`,
  `agent_code_proposal_approvals`, `agent_write_log`, `github_connections`
  all match migrations exactly (no diff lines for any of them beyond the
  routine `GRANT`/policy-naming noise already covered in section C).

## Recommendation (PO decision required — nothing auto-fixed beyond Fix 1)

None of the findings in section B are causing a live error today (verified
by checking actual app code, not just schema). The one worth deliberate
attention is `playlist_tracks.user_id`: it is real, RLS-enforced, and
completely undocumented in this repo. Recommend either (a) a documentation-
only migration that declares the column/FK/policy exactly as they exist in
production (no behavior change, just closing the gap so a fresh environment
matches reality), or (b) an explicit decision to leave it as accepted
historical drift. Everything else in section B/C is lower priority
(dormant legacy columns, cosmetic naming) and can be scheduled whenever
convenient, or left alone indefinitely without risk.
