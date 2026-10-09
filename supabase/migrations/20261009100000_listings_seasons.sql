-- Seasons a listing suits: zero or more of spring, summer, autumn, winter.
-- An empty array means "not tagged" (it matches no season filter).

alter table public.listings
  add column seasons text[] not null default '{}';

alter table public.listings
  add constraint listings_seasons_check
    check (seasons <@ array['spring', 'summer', 'autumn', 'winter']::text[]);

-- GET /api/listings?season=... filters with the && (overlaps) operator.
create index listings_seasons_idx on public.listings using gin (seasons);
