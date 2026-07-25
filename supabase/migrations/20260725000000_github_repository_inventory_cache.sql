-- Cached repository-name inventory for reasoning-context disambiguation.
-- Names only (owner/repo), refreshed as a side effect of an existing
-- github.repositories.list call -- never fetched live per reasoning call.

alter table public.github_connections
  add column if not exists repository_names_cache text[],
  add column if not exists repository_names_cached_at timestamptz;

-- NULL cache + NULL cached_at together mean "never refreshed" (inventory
-- unknown) -- distinct from a refreshed-and-confirmed-empty cache ('{}').
-- Enforcing the pairing at the database level, not just in application
-- code, means this distinction can never be silently lost by a partial
-- write.
alter table public.github_connections
  drop constraint if exists github_connections_repository_cache_lockstep;
alter table public.github_connections
  add constraint github_connections_repository_cache_lockstep
  check ((repository_names_cache is null) = (repository_names_cached_at is null));

-- Postgres CHECK constraints cannot contain subqueries at all (error 0A000),
-- which rules out any per-element predicate over an array column -- unnest()
-- always requires a subquery/FROM context, even scoped to the row's own
-- column. Only the array-length bound is expressible here; the per-element
-- length bound is enforced in cacheRepositoryNames() instead, at the one
-- place that writes this column.
alter table public.github_connections
  drop constraint if exists github_connections_repository_cache_bounded;
alter table public.github_connections
  add constraint github_connections_repository_cache_bounded
  check (
    repository_names_cache is null
    or coalesce(array_length(repository_names_cache, 1), 0) <= 12
  );

comment on column public.github_connections.repository_names_cache is
  'Bounded owner/name inventory from the most recent github.repositories.list call. NULL means never refreshed (unknown), not zero repositories.';
comment on column public.github_connections.repository_names_cached_at is
  'When repository_names_cache was last refreshed. NULL exactly when repository_names_cache is NULL.';
