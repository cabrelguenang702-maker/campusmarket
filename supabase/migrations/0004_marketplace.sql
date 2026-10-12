-- =============================================================================
-- 0004 — Marketplace : catégories, annonces, médias
-- Réf. Backend_Hardened section 6 (domaine marketplace), section 14
-- (cycle de vie des annonces), section 30 (correspondance front /marketplace)
-- =============================================================================

create table public.categories (
  slug text primary key,
  name text not null,
  sort_order integer not null default 0
);

alter table public.categories enable row level security;

create policy "categories_select_public"
  on public.categories for select
  to authenticated, anon
  using (true);

create policy "categories_admin_write"
  on public.categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
create type public.listing_status as enum ('draft', 'published', 'pending_review', 'sold', 'archived', 'removed');
create type public.listing_condition as enum ('neuf', 'tres_bon_etat', 'bon_etat', 'occasion');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id) on delete cascade,
  category_slug text not null references public.categories (slug),
  name text not null check (char_length(name) between 3 and 120),
  description text not null check (char_length(description) <= 3000),
  -- Montants en unités entières (FCFA n'a pas de sous-unité) : jamais de float pour l'argent.
  price integer not null check (price >= 0),
  old_price integer check (old_price is null or old_price >= price),
  quantity integer not null default 1 check (quantity >= 0),
  condition public.listing_condition not null,
  negotiable boolean not null default false,
  campus text not null,
  city text not null,
  status public.listing_status not null default 'pending_review',
  moderation_reason text,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index products_status_idx on public.products (status);
create index products_seller_idx on public.products (seller_id, status);
create index products_search_idx on public.products (category_slug, campus, status);

create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

-- Vitrine publique : uniquement les annonces publiées et non supprimées.
create policy "products_select_published"
  on public.products for select
  to authenticated, anon
  using (status = 'published' and deleted_at is null);

-- Un vendeur voit toujours ses propres annonces, quel que soit leur statut.
create policy "products_select_own"
  on public.products for select
  to authenticated
  using (seller_id = auth.uid());

create policy "products_staff_select"
  on public.products for select
  to authenticated
  using (public.is_staff());

-- Création : uniquement pour soi-même, jamais au nom d'un autre vendeur (mass assignment).
create policy "products_insert_own"
  on public.products for insert
  to authenticated
  with check (seller_id = auth.uid() and status in ('draft', 'pending_review'));

-- Un vendeur modifie son annonce mais ne peut pas s'auto-attribuer le statut "published"
-- si la modération pré-publication est active (cf. section 14) ; seul un membre staff le peut.
create policy "products_update_own"
  on public.products for update
  to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and status <> 'published');

create policy "products_staff_update"
  on public.products for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "products_delete_own"
  on public.products for delete
  to authenticated
  using (seller_id = auth.uid());

-- -----------------------------------------------------------------------------
create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,      -- chemin dans le bucket Storage, jamais une URL publique en clair
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index product_media_product_idx on public.product_media (product_id, position);

alter table public.product_media enable row level security;

create policy "product_media_select"
  on public.product_media for select
  to authenticated, anon
  using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and (p.status = 'published' or p.seller_id = auth.uid() or public.is_staff())
    )
  );

create policy "product_media_write_own"
  on public.product_media for all
  to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid()))
  with check (exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid()));
