-- =============================================================================
-- 0008 — Fin de la phase 5 (Commerce) : offres de prix, réservations, troc
-- Réf. Backend_Hardened section 6 (entités offers/reservations/exchanges),
-- section 53 (tests de concurrence : "double réservation"), section 36/44
-- (jamais de confiance dans les montants/propriétés venant du client).
--
-- Les trois entités partagent le même principe que orders/payments : les
-- transitions d'état sensibles sont doublement gardées (RLS with check +
-- trigger de machine à états), jamais laissées au client.
-- =============================================================================

-- =============================================================================
-- OFFRES DE PRIX — négociation sur une annonce marquée "negotiable" (cf.
-- products.negotiable, 0004_marketplace.sql). Correspond au composant front
-- OfferDialog.tsx : l'acheteur propose un montant, le vendeur accepte, refuse
-- ou contre-propose ; l'acheteur peut alors accepter la contre-offre.
-- =============================================================================
create type public.offer_status as enum (
  'pending', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired'
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  buyer_id uuid not null references public.profiles (id),
  seller_id uuid not null references public.profiles (id),
  amount integer not null check (amount > 0),
  message text check (char_length(message) <= 500),
  counter_amount integer check (counter_amount is null or counter_amount > 0),
  counter_message text check (counter_message is null or char_length(counter_message) <= 500),
  status public.offer_status not null default 'pending',
  -- Renseigné par le trigger d'acceptation, jamais par le client (section 47,
  -- même logique que orders.status='paid' : une conversion en commande n'est
  -- jamais une écriture directe du frontend).
  order_id uuid references public.orders (id),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  -- Une contre-offre sans montant n'a pas de sens : le trigger de transition
  -- l'impose déjà, cette contrainte est une seconde ligne de défense au
  -- niveau du schéma lui-même.
  check (status <> 'countered' or counter_amount is not null)
);

create index offers_product_idx on public.offers (product_id);
create index offers_buyer_idx on public.offers (buyer_id, status);
create index offers_seller_idx on public.offers (seller_id, status);

create trigger set_offers_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

alter table public.offers enable row level security;

create policy "offers_select_participant"
  on public.offers for select
  to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_staff());

-- Le montant proposé doit rester strictement inférieur au prix affiché (sinon
-- ce n'est pas une négociation, c'est un achat direct) et l'annonce doit être
-- réellement négociable, publiée, et appartenir au vendeur déclaré — jamais
-- de confiance dans product_id/seller_id fournis par le client sans les
-- confronter à l'état réel de l'annonce (section 44, IDOR).
create policy "offers_insert_buyer"
  on public.offers for insert
  to authenticated
  with check (
    buyer_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.products p
      where p.id = product_id
        and p.negotiable
        and p.status = 'published'
        and p.seller_id = seller_id
        and p.seller_id <> auth.uid()
        and amount < p.price
    )
  );

-- Le vendeur répond à une offre encore pending : accepter, refuser, contre-proposer.
create policy "offers_respond_seller"
  on public.offers for update
  to authenticated
  using (seller_id = auth.uid() and status = 'pending')
  with check (seller_id = auth.uid() and status in ('accepted', 'rejected', 'countered'));

-- L'acheteur retire sa propre offre tant qu'elle est pending.
create policy "offers_withdraw_buyer"
  on public.offers for update
  to authenticated
  using (buyer_id = auth.uid() and status = 'pending')
  with check (buyer_id = auth.uid() and status = 'withdrawn');

-- L'acheteur accepte la contre-offre du vendeur (et seulement celle-ci : il ne
-- peut jamais s'auto-accepter sa proposition initiale, section 36).
create policy "offers_accept_counter_buyer"
  on public.offers for update
  to authenticated
  using (buyer_id = auth.uid() and status = 'countered')
  with check (buyer_id = auth.uid() and status = 'accepted');

create policy "offers_staff_update"
  on public.offers for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create or replace function public.enforce_offer_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
  v_is_staff boolean := coalesce(public.is_staff(), false);
begin
  if old.status = new.status then
    return new;
  end if;

  -- IMPORTANT : ce trigger est l'autorité sur QUI peut faire QUELLE transition.
  -- Les policies RLS UPDATE combinent leurs WITH CHECK par OR indépendamment de
  -- la policy dont le USING a donné accès à la ligne : offers_accept_counter_buyer
  -- (acheteur -> accepted) validait donc aussi un pending -> accepted déclenché
  -- par l'ACHETEUR sur sa propre offre initiale (transition valide dans
  -- l'abstrait, c'est ainsi qu'un vendeur accepte), forçant une vente à son
  -- propre prix sans consentement du vendeur. Trouvé en auditant 0014.
  -- v_uid NULL = contexte serveur de confiance (cron d'expiration, service_role) :
  -- pas de contrôle d'identité, seuls des clients authentifiés passent par RLS.

  if old.status = 'pending' and new.status = 'countered' then
    if new.counter_amount is null then
      raise exception 'Une contre-offre doit préciser counter_amount';
    end if;
    if v_uid is not null and v_uid is distinct from old.seller_id and not v_is_staff then
      raise exception 'Seul le vendeur peut contre-proposer';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('accepted', 'rejected') then
    if v_uid is not null and v_uid is distinct from old.seller_id and not v_is_staff then
      raise exception 'Seul le vendeur peut accepter ou refuser une offre initiale';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'withdrawn' then
    if v_uid is not null and v_uid is distinct from old.buyer_id and not v_is_staff then
      raise exception 'Seul l''acheteur peut retirer son offre';
    end if;
    return new;
  end if;

  if old.status = 'countered' and new.status = 'accepted' then
    if v_uid is not null and v_uid is distinct from old.buyer_id and not v_is_staff then
      raise exception 'Seul l''acheteur peut accepter la contre-offre du vendeur';
    end if;
    return new;
  end if;

  if old.status in ('pending', 'countered') and new.status = 'expired' then
    return new;
  end if;

  if old.status = 'countered' and new.status in ('rejected', 'withdrawn') then
    if v_uid is not null and v_uid is distinct from old.buyer_id and not v_is_staff then
      raise exception 'Seul l''acheteur peut refuser ou retirer après une contre-offre';
    end if;
    return new;
  end if;

  raise exception 'Transition de statut d''offre invalide : % -> %', old.status, new.status;
end;
$$;

create trigger offers_status_transition
  before update of status on public.offers
  for each row execute function public.enforce_offer_status_transition();

-- Une offre acceptée (par le vendeur ou par l'acheteur sur une contre-offre)
-- devient une commande au montant réellement convenu — jamais amount par
-- défaut si counter_amount a été négocié. SECURITY DEFINER : l'auteur du clic
-- "accepter" peut être l'acheteur (accepte une contre-offre) ou le vendeur
-- (accepte l'offre initiale), dans les deux cas la commande créée doit avoir
-- buyer_id = offers.buyer_id, ce que la policy orders_insert_buyer normale
-- interdirait si c'est le vendeur qui a cliqué.
create or replace function public.convert_accepted_offer_to_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price integer;
  v_order_id uuid;
  v_available integer;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then
    return new;
  end if;

  -- L'annonce a pu être vendue, retirée ou épuisée entre la création de
  -- l'offre et son acceptation (parfois 24h d'écart) : on reverrouille et
  -- revérifie l'état réel du produit avant de créer quoi que ce soit, plutôt
  -- que de faire confiance à l'état de l'offre seule (section 44, IDOR/TOCTOU).
  perform 1 from public.products p where p.id = new.product_id for update;

  select (p.quantity - p.reserved_quantity) into v_available
    from public.products p
    where p.id = new.product_id and p.status = 'published';

  if v_available is null or v_available < 1 then
    raise exception 'Cette annonce n''est plus disponible : impossible de convertir l''offre % en commande', new.id;
  end if;

  v_price := case when old.status = 'countered' then new.counter_amount else new.amount end;

  insert into public.orders (idempotency_key, product_id, buyer_id, seller_id, quantity, unit_price, total_amount, status)
  values (gen_random_uuid(), new.product_id, new.buyer_id, new.seller_id, 1, v_price, v_price, 'pending_payment')
  returning id into v_order_id;

  update public.offers set order_id = v_order_id where id = new.id;

  return new;
end;
$$;

create trigger offers_accepted_to_order
  after update of status on public.offers
  for each row execute function public.convert_accepted_offer_to_order();

comment on table public.offers is
  'La conversion en commande (order_id) est écrite uniquement par convert_accepted_offer_to_order (SECURITY DEFINER), jamais par le client.';

-- Job de nettoyage périodique (à planifier via pg_cron, voir 0010) : une offre
-- pending/countered jamais tranchée dans le délai reste sinon indéfiniment
-- "en attente" et bloque implicitement le produit dans l'esprit du vendeur.
create or replace function public.expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.offers
    set status = 'expired'
    where status in ('pending', 'countered') and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =============================================================================
-- RÉSERVATIONS — retient temporairement du stock pendant qu'un acheteur
-- finalise son paiement, pour éviter qu'un second acheteur n'achète le même
-- article entre-temps (section 53 : "tests de concurrence : double réservation").
-- Contrairement aux calculs métier volontairement laissés hors DB (0005/0006),
-- ce verrou de stock EST placé en trigger PostgreSQL : c'est exactement le
-- type d'invariant protégé par une transaction atomique + verrou de ligne
-- (section 36/53), pas une règle de tarification.
-- =============================================================================
alter table public.products add column reserved_quantity integer not null default 0 check (reserved_quantity >= 0);

comment on column public.products.reserved_quantity is
  'Quantité actuellement retenue par des réservations actives (public.reservations). Stock réellement disponible = quantity - reserved_quantity.';

create type public.reservation_status as enum ('active', 'converted', 'expired', 'cancelled');

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  buyer_id uuid not null references public.profiles (id),
  quantity integer not null default 1 check (quantity > 0),
  status public.reservation_status not null default 'active',
  order_id uuid references public.orders (id),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reservations_product_idx on public.reservations (product_id) where status = 'active';
create index reservations_buyer_idx on public.reservations (buyer_id, status);

create trigger set_reservations_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

alter table public.reservations enable row level security;

create policy "reservations_select_own"
  on public.reservations for select
  to authenticated
  using (buyer_id = auth.uid() or public.is_staff());

create policy "reservations_insert_own"
  on public.reservations for insert
  to authenticated
  with check (buyer_id = auth.uid() and status = 'active');

-- L'acheteur peut annuler sa propre réservation avant expiration ; la
-- conversion ('converted') n'est jamais écrite par le client (voir trigger
-- payments -> reservation plus bas, symétrique à apply_payment_settlement).
create policy "reservations_cancel_own"
  on public.reservations for update
  to authenticated
  using (buyer_id = auth.uid() and status = 'active')
  with check (buyer_id = auth.uid() and status = 'cancelled');

create policy "reservations_staff_update"
  on public.reservations for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create or replace function public.enforce_reservation_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'active' and new.status in ('converted', 'expired', 'cancelled') then
    return new;
  end if;
  raise exception 'Transition de statut de réservation invalide : % -> %', old.status, new.status;
end;
$$;

create trigger reservations_status_transition
  before update of status on public.reservations
  for each row execute function public.enforce_reservation_status_transition();

-- Verrou anti double-réservation : verrouille la ligne produit (FOR UPDATE)
-- avant de vérifier le stock réellement disponible, pour qu'un second insert
-- concurrent sur le même produit attende la fin du premier au lieu de lire un
-- stock périmé (classique race condition "check-then-act").
create or replace function public.reserve_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available integer;
begin
  select quantity - reserved_quantity into v_available
  from public.products
  where id = new.product_id
  for update;

  if v_available is null then
    raise exception 'Produit introuvable : %', new.product_id;
  end if;
  if v_available < new.quantity then
    raise exception 'Stock insuffisant pour réserver % unité(s) (disponible : %)', new.quantity, v_available;
  end if;

  update public.products set reserved_quantity = reserved_quantity + new.quantity where id = new.product_id;
  return new;
end;
$$;

create trigger reservations_reserve_stock
  before insert on public.reservations
  for each row execute function public.reserve_stock();

create or replace function public.release_stock_on_reservation_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update public.products
      set reserved_quantity = greatest(reserved_quantity - old.quantity, 0)
      where id = old.product_id;
  end if;
  return new;
end;
$$;

create trigger reservations_release_stock
  after update of status on public.reservations
  for each row execute function public.release_stock_on_reservation_close();

-- Un paiement réussi sur la commande liée convertit automatiquement la
-- réservation active correspondante (le stock reste retenu jusqu'à la
-- décrémentation réelle par la couche service, hors périmètre ici — voir
-- commentaire de 0005_commerce.sql).
alter table public.orders add column reservation_id uuid references public.reservations (id);

create or replace function public.convert_reservation_on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.reservation_id is not null then
    update public.reservations
      set status = 'converted', order_id = new.id
      where id = new.reservation_id and status = 'active';
  end if;
  return new;
end;
$$;

create trigger orders_convert_reservation
  after update of status on public.orders
  for each row execute function public.convert_reservation_on_order_paid();

-- Job de nettoyage périodique (à planifier via pg_cron, ex. toutes les 5 min) :
-- select public.expire_stale_reservations();
-- Pure SQL, sans appel externe (contrairement aux paiements) : pas besoin
-- d'Edge Function dédiée.
create or replace function public.expire_stale_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.reservations
    set status = 'expired'
    where status = 'active' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.expire_stale_reservations is
  'Planifié via pg_cron dans 0010_commerce_cron.sql, aux côtés de expire_stale_offers().';

-- =============================================================================
-- TROC — échange direct entre deux annonces, avec soulte optionnelle
-- (complément en argent dans un sens ou l'autre). Le paiement de la soulte,
-- s'il y en a une, repasse par le module Paiements (0007) via une commande
-- classique — hors périmètre de cette table, qui ne gère que l'accord d'échange.
-- =============================================================================
create type public.exchange_status as enum (
  'pending', 'accepted', 'rejected', 'withdrawn', 'completed', 'cancelled'
);

create table public.exchanges (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id),
  requester_product_id uuid not null references public.products (id),
  owner_id uuid not null references public.profiles (id),
  owner_product_id uuid not null references public.products (id),
  -- Positif : le demandeur ajoute cette somme ; négatif : c'est le propriétaire qui complète.
  cash_adjustment integer not null default 0,
  message text check (char_length(message) <= 500),
  meeting_point text,
  status public.exchange_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> owner_id),
  check (requester_product_id <> owner_product_id)
);

create index exchanges_requester_idx on public.exchanges (requester_id, status);
create index exchanges_owner_idx on public.exchanges (owner_id, status);

create trigger set_exchanges_updated_at
  before update on public.exchanges
  for each row execute function public.set_updated_at();

alter table public.exchanges enable row level security;

create policy "exchanges_select_participant"
  on public.exchanges for select
  to authenticated
  using (requester_id = auth.uid() or owner_id = auth.uid() or public.is_staff());

-- Le demandeur doit réellement posséder l'annonce qu'il propose en échange, et
-- l'annonce visée doit réellement appartenir au propriétaire déclaré et être
-- publiée — même principe anti-IDOR que pour les offres.
create policy "exchanges_insert_requester"
  on public.exchanges for insert
  to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.products p
      where p.id = requester_product_id and p.seller_id = auth.uid() and p.status = 'published'
    )
    and exists (
      select 1 from public.products p
      where p.id = owner_product_id and p.seller_id = owner_id and p.status = 'published'
    )
  );

create policy "exchanges_respond_owner"
  on public.exchanges for update
  to authenticated
  using (owner_id = auth.uid() and status = 'pending')
  with check (owner_id = auth.uid() and status in ('accepted', 'rejected'));

create policy "exchanges_withdraw_requester"
  on public.exchanges for update
  to authenticated
  using (requester_id = auth.uid() and status = 'pending')
  with check (requester_id = auth.uid() and status = 'withdrawn');

-- Une fois acceptée, l'une ou l'autre partie peut confirmer la remise en main
-- propre (completed) ou signaler un abandon (cancelled) — même logique que la
-- confirmation de remise sur les commandes classiques (0005_commerce.sql).
create policy "exchanges_finalize_participant"
  on public.exchanges for update
  to authenticated
  using ((requester_id = auth.uid() or owner_id = auth.uid()) and status = 'accepted')
  with check ((requester_id = auth.uid() or owner_id = auth.uid()) and status in ('completed', 'cancelled'));

create policy "exchanges_staff_update"
  on public.exchanges for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create or replace function public.enforce_exchange_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'pending' and new.status in ('accepted', 'rejected', 'withdrawn') then
    return new;
  end if;
  if old.status = 'accepted' and new.status in ('completed', 'cancelled') then
    return new;
  end if;
  raise exception 'Transition de statut de troc invalide : % -> %', old.status, new.status;
end;
$$;

create trigger exchanges_status_transition
  before update of status on public.exchanges
  for each row execute function public.enforce_exchange_status_transition();

comment on table public.exchanges is
  'La soulte (cash_adjustment), si non nulle, se règle via une commande + paiement classiques créés côté service au moment de l''acceptation — pas modélisé ici.';
