-- Links sibling orders created from one checkout event (a cart spanning
-- multiple sellers splits into one order per seller -- see the buyer
-- backend review fix). Generated in application code (crypto.randomUUID())
-- and stamped identically on every order from the same checkout, not
-- DB-generated, so the same value can be reused across the insert loop.
--
-- No default and NOT NULL: the orders table is empty at the time of this
-- migration (verified), so there's no backfill concern, and every order
-- from here on must belong to a checkout group.

alter table public.orders add column checkout_group_id uuid not null;

create index orders_checkout_group_id_idx on public.orders (checkout_group_id);
