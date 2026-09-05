-- 20260905000000_profile_avatar.sql
-- Profile photo support: profiles.avatar_url + a public 'avatars' storage
-- bucket. The client uploads a single downscaled image per user at
-- '<user_id>/avatar.jpg' (upsert) and stores the public URL (with a ?v=
-- cache-buster) in profiles.avatar_url.

alter table public.profiles
  add column if not exists avatar_url text;

-- Public-read bucket: avatars render in <img> tags (sidebar, settings)
-- without signed-URL churn. Writes are locked to the owner's folder below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_insert_own') then
    create policy avatars_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_update_own') then
    create policy avatars_update_own on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1])
      with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_delete_own') then
    create policy avatars_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;
