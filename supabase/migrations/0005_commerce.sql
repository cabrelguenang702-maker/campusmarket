-- =============================================================================
-- 0005 — Commerce : commandes (remise en main propre sur le campus)
-- Réf. Backend_Hardened section 6 (domaine commerce), section 14 (cycle de vie
-- des annonces), section 30 (correspondance /produit/:id/acheter)
-- Le calcul des frais de service et la décrémentation de stock restent dans la
-- couche service (section 7 : "logique métier complexe reste dans les services"),
-- jamais dans un trigger — ce schéma pose seulement les garde-fous d'intégrité.
-- =============================================================================

create type public.order_status as enum (
  'pending_payment', 'paid', 'confirmed', 'completed', 'cancelled', 'disputed'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Clé d'idempotence fournie par le client à la création : évite qu'un double clic
  -- ou un retry réseau ne crée deux commandes pour un seul paiement (section 36/47).
  idempotency_key uuid not null unique,
  product_id uuid not null references public.products (id),
  buyer_id uuid not null references public.profiles (id),
  seller_id uuid not null references public.profiles (id),
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),      -- prix figé au moment de la commande
  service_fee integer not null default 0 check (service_fee >= 0),
  total_amount integer not null check (total_amount >= 0),
  meeting_point text,
  buyer_note text check (char_length(buyer_note) <= 500),
  status public.order_status not null default 'pending_payment',
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create index orders_buyer_idx on public.orders (buyer_id, status);
create index orders_seller_idx on public.orders (seller_id, status);
create index orders_product_idx on public.orders (product_id);

create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

-- Acheteur et vendeur voient uniquement les commandes qui les concernent (jamais
-- les commandes des autres) ; le staff voit tout pour le support et la modération.
create policy "orders_select_participant"
  on public.orders for select
  to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_staff());

-- Seul l'acheteur crée sa commande, toujours à son propre nom, jamais au nom d'un
-- autre (mass assignment / IDOR — section 44), et seulement au statut initial.
create policy "orders_insert_buyer"
  on public.orders for insert
  to authenticated
  with check (buyer_id = auth.uid() and status = 'pending_payment');

-- Ni l'acheteur ni le vendeur ne fait passer une commande à "paid" depuis le client :
-- ce statut n'est écrit que par le webhook de paiement via la service_role (section 47,
-- "ne jamais valider un paiement uniquement depuis le navigateur"). Seules les
-- transitions non financières (annulation, confirmation de remise) sont ouvertes ici.
create policy "orders_update_buyer_cancel"
  on public.orders for update
  to authenticated
  using (buyer_id = auth.uid() and status in ('pending_payment', 'paid'))
  with check (buyer_id = auth.uid() and status in ('cancelled'));

create policy "orders_update_seller_confirm"
  on public.orders for update
  to authenticated
  using (seller_id = auth.uid() and status = 'paid')
  with check (seller_id = auth.uid() and status in ('confirmed', 'completed'));

create policy "orders_staff_update"
  on public.orders for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table public.orders is
  'Le passage à paid/disputed est réservé au webhook de paiement et au workflow de litige (service_role), jamais aux policies "authenticated" ci-dessus.';
