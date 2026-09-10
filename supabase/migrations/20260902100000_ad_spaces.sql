-- Ad spaces (new feature, not part of the original schema design).
--
-- FLAGGED DECISIONS -- confirmed with the user before writing this, not
-- guessed silently:
--  - owner_id is a NULLABLE FK to profiles: an advertiser might be an
--    existing platform user (e.g. a seller promoting their own listings)
--    or an outside business with no account at all. business_name is
--    always required regardless, for display purposes.
--  - placement is free-text, not a constrained enum or lookup table --
--    there's no existing concept of ad slot identifiers anywhere in this
--    project to build a real taxonomy from. Constrain this later (CHECK
--    or lookup table) once real slots are defined.
--  - image_url + click_through_url cover the two things almost every
--    banner-ad system needs (the creative, and where clicking it goes).
--    No image upload endpoint is built here -- image_url is a plain
--    admin-settable string, same as how listing image upload was a
--    separate, dedicated feature built on its own.
--  - start_date/end_date are calendar dates, not timestamps (campaigns
--    are day-granular, not to-the-second). end_date is nullable
--    (open-ended/ongoing ads are allowed); start_date is required.
--  - is_active is independent of the date range -- an admin can pause an
--    ad within its own date window. Nothing here auto-derives it from
--    the dates or auto-expires it when end_date passes.
--  - No public "get active ads for placement X" endpoint exists yet --
--    this step is admin management only. Actually serving ads on the
--    site needs that separately, later.

create table public.ad_spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete set null,
  business_name text not null,
  placement text not null,
  image_url text,
  click_through_url text,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  price numeric(10, 2) not null default 0 check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_spaces_date_range_check check (end_date is null or end_date >= start_date)
);

create index ad_spaces_placement_active_idx on public.ad_spaces (placement, is_active);

alter table public.ad_spaces enable row level security;

-- Admin-only in every direction, same pattern as commission_settings --
-- ad spaces aren't buyer/seller-owned data, and there's no public read
-- path built in this step.
create policy "ad_spaces_select" on public.ad_spaces
  for select using (public.is_admin());
create policy "ad_spaces_insert" on public.ad_spaces
  for insert with check (public.is_admin());
create policy "ad_spaces_update" on public.ad_spaces
  for update using (public.is_admin()) with check (public.is_admin());
create policy "ad_spaces_delete" on public.ad_spaces
  for delete using (public.is_admin());
