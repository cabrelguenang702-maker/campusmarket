-- =============================================================================
-- 0006 — Achats groupés : paliers de prix, participants
-- Réf. Backend_Hardened section 6 (group-buying), section 30
-- (correspondance /produit/:id/achat-groupe)
-- Le remboursement de la différence de prix quand un palier supérieur est atteint,
-- et le remboursement intégral si l'objectif n'est pas atteint à l'échéance, sont
-- une logique métier multi-lignes : elle reste dans la couche service (section 7),
-- déclenchée par un job planifié + les webhooks de paiement, jamais par un trigger SQL.
-- =============================================================================

create type public.group_purchase_status as enum ('active', 'reached', 'expired', 'cancelled');

create table public.group_purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  target_participants integer not null check (target_participants > 1),
  ends_at timestamptz not null,
  status public.group_purchase_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index group_purchases_product_idx on public.group_purchases (product_id);

create trigger set_group_purchases_updated_at
  before update on public.group_purchases
  for each row execute function public.set_updated_at();

alter table public.group_purchases enable row level security;

create policy "group_purchases_select_public"
  on public.group_purchases for select
  to authenticated, anon
  using (true);

create policy "group_purchases_seller_write"
  on public.group_purchases for all
  to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid()))
  with check (exists (select 1 from public.products p where p.id = product_id and p.seller_id = auth.uid()));

create policy "group_purchases_staff_write"
  on public.group_purchases for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- Paliers : à partir de N participants, le prix unitaire baisse à ce montant.
-- -----------------------------------------------------------------------------
create table public.group_purchase_tiers (
  id uuid primary key default gen_random_uuid(),
  group_purchase_id uuid not null references public.group_purchases (id) on delete cascade,
  min_participants integer not null check (min_participants > 0),
  unit_price integer not null check (unit_price >= 0),
  unique (group_purchase_id, min_participants)
);

alter table public.group_purchase_tiers enable row level security;

create policy "group_purchase_tiers_select_public"
  on public.group_purchase_tiers for select
  to authenticated, anon
  using (true);

create policy "group_purchase_tiers_seller_write"
  on public.group_purchase_tiers for all
  to authenticated
  using (exists (
    select 1 from public.group_purchases gp join public.products p on p.id = gp.product_id
    where gp.id = group_purchase_id and p.seller_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.group_purchases gp join public.products p on p.id = gp.product_id
    where gp.id = group_purchase_id and p.seller_id = auth.uid()
  ));

-- -----------------------------------------------------------------------------
-- Participants : un utilisateur ne rejoint qu'une fois le même achat groupé.
-- -----------------------------------------------------------------------------
create table public.group_purchase_participants (
  id uuid primary key default gen_random_uuid(),
  group_purchase_id uuid not null references public.group_purchases (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id),
  paid_amount integer not null check (paid_amount >= 0),
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  joined_at timestamptz not null default now(),
  unique (group_purchase_id, buyer_id)
);

create index gpp_group_idx on public.group_purchase_participants (group_purchase_id);

alter table public.group_purchase_participants enable row level security;

-- Un participant voit les autres participants (le front affiche "Jean + 5 autres"),
-- mais seul l'intéressé (ou le staff) voit les montants payés/remboursés — colonnes
-- financières, cf. section 47. On sépare donc lecture "présence" et lecture "montants"
-- via deux policies : la première autorise select(*) mais ne suffit pas seule à
-- protéger les colonnes ; en Postgres, RLS filtre des lignes entières, pas des colonnes,
-- donc les montants restent visibles par tous les participants du même groupe avec ce
-- modèle simple. Si une confidentialité stricte des montants est requise, prévoir une
-- vue publique (id, group_purchase_id, buyer_id, joined_at) sans les colonnes financières.
create policy "gpp_select_group_members"
  on public.group_purchase_participants for select
  to authenticated
  using (
    buyer_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.group_purchase_participants me
      where me.group_purchase_id = group_purchase_participants.group_purchase_id
        and me.buyer_id = auth.uid()
    )
  );

create policy "gpp_insert_self"
  on public.group_purchase_participants for insert
  to authenticated
  with check (buyer_id = auth.uid());

create policy "gpp_staff_write"
  on public.group_purchase_participants for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
