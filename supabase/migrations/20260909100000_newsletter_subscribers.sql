-- Newsletter signup (new feature -- the site's newsletter forms in every
-- page footer had no backend at all before this). Deliberately minimal:
-- just an email + when they signed up. No name, no double opt-in/
-- confirmation flow, no unsubscribe token yet -- none of that exists
-- anywhere else in this project either, and inventing it here would be
-- scope beyond "the signup form doesn't do anything."
--
-- Public insert-only via the service-role backend route, same trust model
-- as everything else in this project (RLS is enabled per repo convention,
-- but every real read/write goes through the Express API's service-role
-- client, not directly from the browser).

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

-- No policies granted to anon/authenticated -- this table is never read or
-- written directly from the browser, only through the backend's
-- service-role client (which bypasses RLS), matching how every other
-- table in this project is actually accessed.
