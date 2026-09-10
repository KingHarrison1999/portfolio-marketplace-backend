-- Indexes backing browse/search and seller dashboard queries.

create index listings_category_id_idx on public.listings (category_id);
create index listings_seller_id_idx on public.listings (seller_id);
create index listings_status_idx on public.listings (status);
create index order_items_seller_id_idx on public.order_items (seller_id);
