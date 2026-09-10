-- Storage bucket for listing photos. Public read (product photos aren't
-- sensitive); writes are restricted to the seller who owns the listing
-- named by the object's first path segment, or admins. Objects are stored
-- as "{listing_id}/{filename}".
--
-- The backend uploads through this bucket using the service role key,
-- which bypasses RLS -- these policies are the defense-in-depth backstop
-- described in the listings RLS migration, for any future direct
-- client-side access to storage.

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

create policy "listing_images_storage_select" on storage.objects
  for select using (bucket_id = 'listing-images');

create policy "listing_images_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'listing-images'
    and (
      public.is_admin()
      or exists (
        select 1 from public.listings l
        where l.id::text = (storage.foldername(name))[1]
          and l.seller_id = auth.uid()
      )
    )
  );

create policy "listing_images_storage_update" on storage.objects
  for update using (
    bucket_id = 'listing-images'
    and (
      public.is_admin()
      or exists (
        select 1 from public.listings l
        where l.id::text = (storage.foldername(name))[1]
          and l.seller_id = auth.uid()
      )
    )
  );

create policy "listing_images_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'listing-images'
    and (
      public.is_admin()
      or exists (
        select 1 from public.listings l
        where l.id::text = (storage.foldername(name))[1]
          and l.seller_id = auth.uid()
      )
    )
  );
