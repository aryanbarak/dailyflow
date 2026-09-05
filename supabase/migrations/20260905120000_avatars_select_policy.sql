-- 20260905120000_avatars_select_policy.sql
-- Follow-up to 20260905000000_profile_avatar.sql: storage upload with
-- upsert needs SELECT permission on the object row in addition to
-- INSERT/UPDATE, so avatar uploads failed with AccessDenied (HTTP 400)
-- until this policy existed. Already applied manually to production on
-- 2026-09-05; recorded here so every environment gets it.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_select_own') then
    create policy avatars_select_own on storage.objects for select to authenticated
      using (bucket_id = 'avatars');
  end if;
end $$;
