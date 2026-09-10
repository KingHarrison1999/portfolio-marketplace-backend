-- Categories, self-referencing for subcategories (e.g. diecast / trading cards / lego).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories (id) on delete set null
);
