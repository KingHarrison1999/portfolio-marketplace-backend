-- Notification preferences (one row per user) and commission settings.
--
-- commission_settings is a single-row table for the MVP flat rate. Per-tier
-- rates later would be a new table (e.g. commission_tiers) that this row's
-- flat_rate falls back to -- no tiering columns are added here yet.

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  email_order_updates boolean not null default true,
  email_marketing boolean not null default false
);

create table public.commission_settings (
  id uuid primary key default gen_random_uuid(),
  flat_rate numeric(5, 4) not null default 0 check (flat_rate >= 0 and flat_rate <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.commission_settings (flat_rate) values (0);
