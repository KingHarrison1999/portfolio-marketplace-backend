-- 'paid' and 'refunded' were already allowed. 'payment_failed' is new: a
-- distinct terminal state for a payment that was declined/failed at the
-- provider (no money ever moved), separate from 'refunded' (money was
-- captured, then given back because stock/availability changed between
-- checkout and payment confirmation -- see the webhook handling).

alter table public.orders drop constraint orders_status_check;

alter table public.orders
  add constraint orders_status_check
    check (status in ('pending', 'pending_payment', 'paid', 'payment_failed', 'processing', 'shipped', 'completed', 'cancelled', 'refunded'));
