-- Raffle/house promos (owned by no one, or by the platform itself) have no
-- real business behind them -- business_name was previously required on
-- every ad space, which would have forced a fake placeholder value for
-- this case. Made optional; existing rows are unaffected.
alter table public.ad_spaces alter column business_name drop not null;
