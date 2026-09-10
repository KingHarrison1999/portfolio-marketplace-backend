-- Fix 1: make profiles.display_name publicly readable while keeping every
-- other profile field owner-or-admin-only.
--
-- RLS policies are row-level, not column-level -- a policy on public.profiles
-- can't expose display_name while hiding role/created_at for the same row to
-- the same caller. So the existing profiles_select policy (id = auth.uid()
-- or is_admin()) is left untouched, and a narrow view exposing only
-- (id, display_name) is added instead. Views run with their owner's
-- privileges for RLS purposes by default (no security_invoker set), so this
-- view surfaces every profile's id/display_name regardless of caller, while
-- direct reads of public.profiles remain governed by the unchanged policy.
create view public.profiles_public as
select id, display_name from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- Fix 2: CHECK constraints for columns left as open text.
--
-- listings.status already has this exact constraint from the original
-- migration (listings_status_check), so it's intentionally not touched here.

alter table public.listings
  add constraint listings_condition_check
    check (condition in ('new', 'like_new', 'used', 'for_parts'));

alter table public.orders
  add constraint orders_status_check
    check (status in ('pending', 'paid', 'processing', 'shipped', 'completed', 'cancelled', 'refunded'));
