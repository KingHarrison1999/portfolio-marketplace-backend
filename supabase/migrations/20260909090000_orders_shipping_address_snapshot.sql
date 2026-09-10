-- orders.shipping_address_id is only an FK to addresses -- if a buyer later
-- edits or deletes that address, every past order's "shipping address"
-- silently changes or disappears along with it. Same root problem the
-- title_at_purchase/price_at_purchase snapshot on order_items already
-- solved for listings; never applied to the address side. Nullable, no
-- backfill -- same convention as that earlier snapshot migration
-- (20260903120000_order_items_snapshot.sql). shipping_address_id itself is
-- left in place (still useful for e.g. re-ordering to the same address).

alter table public.orders
  add column shipping_line1 text,
  add column shipping_line2 text,
  add column shipping_city text,
  add column shipping_postcode text,
  add column shipping_country text;
