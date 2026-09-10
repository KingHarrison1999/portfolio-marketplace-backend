-- Cart, addresses, orders and their line items.

create table public.cart (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.cart (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0)
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  line1 text not null,
  line2 text,
  city text not null,
  postcode text not null,
  country text not null,
  is_default boolean not null default false
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  total numeric(10, 2) not null check (total >= 0),
  status text not null default 'pending',
  payment_reference text,
  shipping_address_id uuid references public.addresses (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  price_at_purchase numeric(10, 2) not null check (price_at_purchase >= 0),
  commission_amount numeric(10, 2) not null default 0 check (commission_amount >= 0)
);
