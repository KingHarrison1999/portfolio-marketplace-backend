-- The business has confirmed three commission tiers: individual/flat
-- (default, the existing flat_rate column), business, and charity --
-- charity gets the lowest rate. Same single-row table shape as
-- flat_rate, just two more numeric rate columns alongside it; no reason
-- yet to redesign into per-tier rows (see 20260825112151's own note that
-- a real commission_tiers table would be the move if/when tiering needs
-- grow beyond a flat per-tier rate).
--
-- Nullable with no default, deliberately -- unlike flat_rate (which has
-- always applied to every seller by default), business_rate/charity_rate
-- have no real value to default to until the still-open business decision
-- on how a seller actually gets assigned to a tier is made. NULL means
-- "not set yet" rather than silently implying 0%.
--
-- Out of scope here, not built: applying these rates to any actual
-- seller/order. This migration and the endpoints it supports only make
-- the three rates exist and be admin-editable.

alter table public.commission_settings add column business_rate numeric(5, 4) check (business_rate >= 0 and business_rate <= 1);
alter table public.commission_settings add column charity_rate numeric(5, 4) check (charity_rate >= 0 and charity_rate <= 1);
