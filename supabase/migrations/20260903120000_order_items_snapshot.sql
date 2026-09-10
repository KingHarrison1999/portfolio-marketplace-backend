-- order_items already snapshots price_at_purchase, but not the listing's
-- title -- rendering an order relied on the live listings row still
-- existing and still matching, so a seller editing a listing's title (or a
-- listing being hard-deleted) after checkout would silently change or
-- blank out what a buyer's order confirmation shows. Add a title snapshot
-- alongside the existing price one, following the same "_at_purchase"
-- naming.
--
-- Nullable: existing order_items rows predate this column and have no
-- title to backfill from (the point of this migration is that the live
-- listings row is no longer a reliable source for it). Application code
-- treats a null title_at_purchase as "no snapshot available" for those
-- pre-existing rows.

alter table public.order_items add column title_at_purchase text;
