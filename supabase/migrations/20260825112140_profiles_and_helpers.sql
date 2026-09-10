-- Profiles table extending auth.users, plus a helper for role-based RLS checks.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'buyer' check (role in ('buyer', 'seller', 'admin')),
  display_name text,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so policies on other tables can check the caller's role
-- without depending on the profiles SELECT policy (avoids RLS recursion).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
