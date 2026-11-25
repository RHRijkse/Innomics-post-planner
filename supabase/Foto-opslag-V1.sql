-- Run once in the SQL Editor of the EXISTING Postplanner project.
-- The current app is a shared planner using the anon role (there is no login).
-- These policies keep that same shared access model, scoped to this private
-- bucket and planner/ prefix. They do not make the bucket public, and do not
-- grant update/delete on stored files or change existing table policies.
-- A private bucket is not per-user isolation: anon clients can read this prefix.
begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('postplanner-media', 'postplanner-media', false, 10485760)
on conflict (id) do nothing;

-- Refuse a conflicting pre-existing bucket instead of changing its access.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'postplanner-media' and public) then
    raise exception 'postplanner-media must be a private bucket; inspect the existing bucket first';
  end if;
end $$;

create policy "postplanner_media_v1_insert"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'postplanner-media'
  and (storage.foldername(name))[1] = 'planner'
  and name ~ '^planner/[0-9a-f-]{36}\.(webp|png|jpg|bin)$'
);

create policy "postplanner_media_v1_read"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'postplanner-media'
  and (storage.foldername(name))[1] = 'planner'
);

commit;
