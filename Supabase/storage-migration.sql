-- Add private Supabase Storage for deposit payment QR codes and member receipts.
-- Apply this as a separate migration after the original Supabase/schema.sql.
--
-- The Images bucket is made private so signed URLs and Storage RLS protect
-- financial receipts. Existing public URLs in this bucket will stop being
-- public after this migration.

alter table public.deposit_methods
  add column if not exists qr_storage_path text not null default '';

drop policy if exists dashboard_state_update_staff
  on public.member_dashboard_state;
create policy dashboard_state_update_staff
on public.member_dashboard_state for update to authenticated
using (public.is_platform_staff())
with check (public.is_platform_staff());

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'Images'
  ) then
    raise exception 'Create the Supabase Storage bucket named Images first.';
  end if;
end;
$$;

update storage.buckets
set public = false
where id = 'Images';

drop policy if exists images_deposit_storage_read
  on storage.objects;
create policy images_deposit_storage_read
on storage.objects for select to authenticated
using (
  bucket_id = 'Images'
  and (
    (
      (storage.foldername(name))[1] = 'deposit-proofs'
      and (
        public.is_platform_staff()
        or (
          (storage.foldername(name))[2] = (select auth.uid())::text
          and public.is_active_member()
        )
      )
    )
    or (
      (storage.foldername(name))[1] = 'deposit-methods'
      and (
        public.is_platform_staff()
        or (
          public.is_active_member()
          and exists (
            select 1
            from public.deposit_methods as method
            where method.id = (storage.foldername(name))[2]
              and method.is_active
          )
        )
      )
    )
  )
);

drop policy if exists images_deposit_storage_insert
  on storage.objects;
create policy images_deposit_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'Images'
  and (
    (
      (storage.foldername(name))[1] = 'deposit-proofs'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and public.is_active_member()
    )
    or (
      (storage.foldername(name))[1] = 'deposit-methods'
      and public.current_profile_role() in ('owner', 'finance')
    )
  )
);

drop policy if exists images_deposit_storage_update
  on storage.objects;
create policy images_deposit_storage_update
on storage.objects for update to authenticated
using (
  bucket_id = 'Images'
  and (storage.foldername(name))[1] = 'deposit-methods'
  and public.current_profile_role() in ('owner', 'finance')
)
with check (
  bucket_id = 'Images'
  and (storage.foldername(name))[1] = 'deposit-methods'
  and public.current_profile_role() in ('owner', 'finance')
);

drop policy if exists images_deposit_storage_delete
  on storage.objects;
create policy images_deposit_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'Images'
  and (storage.foldername(name))[1] = 'deposit-methods'
  and public.current_profile_role() in ('owner', 'finance')
);
