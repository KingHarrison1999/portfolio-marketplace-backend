-- Enable Row Level Security on every table and define access policies.
--
-- Role checks use public.is_admin() (SECURITY DEFINER, reads profiles.role
-- for auth.uid()) rather than a separate roles table, per spec. Ownership
-- checks compare auth.uid() directly against the row's owner column, or
-- walk one join to the owning row for child tables (listing_images,
-- cart_items, order_items).

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.cart enable row level security;
alter table public.cart_items enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.commission_settings enable row level security;

-- profiles: users manage their own row; admins manage all.
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles_insert" on public.profiles
  for insert with check (id = auth.uid() or public.is_admin());
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy "profiles_delete" on public.profiles
  for delete using (public.is_admin());

-- categories: public read, admin-managed.
create policy "categories_select" on public.categories
  for select using (true);
create policy "categories_insert" on public.categories
  for insert with check (public.is_admin());
create policy "categories_update" on public.categories
  for update using (public.is_admin()) with check (public.is_admin());
create policy "categories_delete" on public.categories
  for delete using (public.is_admin());

-- listings: anyone can read active listings; sellers manage their own; admins manage all.
create policy "listings_select" on public.listings
  for select using (status = 'active' or seller_id = auth.uid() or public.is_admin());
create policy "listings_insert" on public.listings
  for insert with check (seller_id = auth.uid() or public.is_admin());
create policy "listings_update" on public.listings
  for update using (seller_id = auth.uid() or public.is_admin())
  with check (seller_id = auth.uid() or public.is_admin());
create policy "listings_delete" on public.listings
  for delete using (seller_id = auth.uid() or public.is_admin());

-- listing_images: follows the parent listing's visibility/ownership.
create policy "listing_images_select" on public.listing_images
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id
        and (l.status = 'active' or l.seller_id = auth.uid())
    )
  );
create policy "listing_images_insert" on public.listing_images
  for insert with check (
    public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id and l.seller_id = auth.uid()
    )
  );
create policy "listing_images_update" on public.listing_images
  for update using (
    public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id and l.seller_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id and l.seller_id = auth.uid()
    )
  );
create policy "listing_images_delete" on public.listing_images
  for delete using (
    public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id and l.seller_id = auth.uid()
    )
  );

-- cart: buyers manage only their own cart; admins manage all.
create policy "cart_select" on public.cart
  for select using (buyer_id = auth.uid() or public.is_admin());
create policy "cart_insert" on public.cart
  for insert with check (buyer_id = auth.uid() or public.is_admin());
create policy "cart_update" on public.cart
  for update using (buyer_id = auth.uid() or public.is_admin())
  with check (buyer_id = auth.uid() or public.is_admin());
create policy "cart_delete" on public.cart
  for delete using (buyer_id = auth.uid() or public.is_admin());

-- cart_items: follows the parent cart's ownership.
create policy "cart_items_select" on public.cart_items
  for select using (
    public.is_admin()
    or exists (select 1 from public.cart c where c.id = cart_items.cart_id and c.buyer_id = auth.uid())
  );
create policy "cart_items_insert" on public.cart_items
  for insert with check (
    public.is_admin()
    or exists (select 1 from public.cart c where c.id = cart_items.cart_id and c.buyer_id = auth.uid())
  );
create policy "cart_items_update" on public.cart_items
  for update using (
    public.is_admin()
    or exists (select 1 from public.cart c where c.id = cart_items.cart_id and c.buyer_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.cart c where c.id = cart_items.cart_id and c.buyer_id = auth.uid())
  );
create policy "cart_items_delete" on public.cart_items
  for delete using (
    public.is_admin()
    or exists (select 1 from public.cart c where c.id = cart_items.cart_id and c.buyer_id = auth.uid())
  );

-- addresses: users manage only their own; admins manage all.
create policy "addresses_select" on public.addresses
  for select using (user_id = auth.uid() or public.is_admin());
create policy "addresses_insert" on public.addresses
  for insert with check (user_id = auth.uid() or public.is_admin());
create policy "addresses_update" on public.addresses
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "addresses_delete" on public.addresses
  for delete using (user_id = auth.uid() or public.is_admin());

-- orders: buyers manage only their own orders; admins manage all.
create policy "orders_select" on public.orders
  for select using (buyer_id = auth.uid() or public.is_admin());
create policy "orders_insert" on public.orders
  for insert with check (buyer_id = auth.uid() or public.is_admin());
create policy "orders_update" on public.orders
  for update using (buyer_id = auth.uid() or public.is_admin())
  with check (buyer_id = auth.uid() or public.is_admin());
create policy "orders_delete" on public.orders
  for delete using (buyer_id = auth.uid() or public.is_admin());

-- order_items: the buyer (via their order) can read/write; sellers get
-- read-only access to their own sale lines for dashboard queries; admins
-- manage all.
create policy "order_items_select" on public.order_items
  for select using (
    public.is_admin()
    or seller_id = auth.uid()
    or exists (select 1 from public.orders o where o.id = order_items.order_id and o.buyer_id = auth.uid())
  );
create policy "order_items_insert" on public.order_items
  for insert with check (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_items.order_id and o.buyer_id = auth.uid())
  );
create policy "order_items_update" on public.order_items
  for update using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_items.order_id and o.buyer_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_items.order_id and o.buyer_id = auth.uid())
  );
create policy "order_items_delete" on public.order_items
  for delete using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_items.order_id and o.buyer_id = auth.uid())
  );

-- notification_preferences: users manage only their own; admins manage all.
create policy "notification_preferences_select" on public.notification_preferences
  for select using (user_id = auth.uid() or public.is_admin());
create policy "notification_preferences_insert" on public.notification_preferences
  for insert with check (user_id = auth.uid() or public.is_admin());
create policy "notification_preferences_update" on public.notification_preferences
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "notification_preferences_delete" on public.notification_preferences
  for delete using (user_id = auth.uid() or public.is_admin());

-- commission_settings: admin-only in every direction.
create policy "commission_settings_select" on public.commission_settings
  for select using (public.is_admin());
create policy "commission_settings_insert" on public.commission_settings
  for insert with check (public.is_admin());
create policy "commission_settings_update" on public.commission_settings
  for update using (public.is_admin()) with check (public.is_admin());
create policy "commission_settings_delete" on public.commission_settings
  for delete using (public.is_admin());
