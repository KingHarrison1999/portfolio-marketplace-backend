-- Checkout-initiation (buyer backend step) creates orders in a
-- 'pending_payment' state, awaiting the payment integration in a later
-- step. That value wasn't in the original orders_status_check list.
-- Added alongside the existing values rather than replacing 'pending',
-- in case a plain 'pending' state is still useful elsewhere later.

alter table public.orders drop constraint orders_status_check;

alter table public.orders
  add constraint orders_status_check
    check (status in ('pending', 'pending_payment', 'paid', 'processing', 'shipped', 'completed', 'cancelled', 'refunded'));
