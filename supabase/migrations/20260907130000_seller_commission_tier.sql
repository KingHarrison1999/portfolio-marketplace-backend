-- Sellers self-declare a commission tier (individual/business/charity),
-- with admin verification before the discounted business/charity rate
-- actually applies at checkout (see checkoutService.js). Two separate
-- columns rather than one, deliberately:
--  - commission_tier: the seller's current tier, whether self-declared or
--    admin-overridden. Defaults to 'individual' (the existing flat_rate
--    behaviour) for every existing row, so this is a no-op for every
--    seller until they explicitly change it.
--  - commission_tier_verified: whether an admin has confirmed the CURRENT
--    commission_tier value. Not meaningful for 'individual' (nothing to
--    verify -- it's the baseline, no discount claim), but tracked
--    regardless for a consistent field. Defaults to false; any
--    self-service change to commission_tier resets it to false (a
--    previously-verified claim doesn't carry over to a new claim). An
--    admin override (PATCH /api/admin/users/:id/commission-tier) sets
--    both fields together and is implicitly verified, since the admin is
--    asserting the value directly.

alter table public.profiles
  add column commission_tier text not null default 'individual'
    check (commission_tier in ('individual', 'business', 'charity'));

alter table public.profiles
  add column commission_tier_verified boolean not null default false;
