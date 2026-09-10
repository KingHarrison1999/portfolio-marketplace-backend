-- public.profiles_public was created without explicit column/DML privileges,
-- so it inherited Supabase's default grants (full INSERT/UPDATE/DELETE/
-- REFERENCES to anon and authenticated, in addition to SELECT). Because the
-- view has no security_invoker setting, it runs with its owner's rights for
-- RLS purposes -- exactly what makes the public SELECT work, but it also
-- meant those write grants would let any client write to profiles through
-- the view, bypassing the owner-or-admin write policies on the base table.
-- Restrict the view to SELECT only.

revoke all on public.profiles_public from anon, authenticated;
grant select on public.profiles_public to anon, authenticated;
