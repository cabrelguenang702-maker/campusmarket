-- =============================================================================
-- 0007 — Paiements Mobile Money (MTN MoMo / Orange Money)
-- Réf. Backend_Hardened section 15 (Paiements Mobile Money) et section 47
-- (Paiements — architecture anti-fraude).
--
-- Principe directeur : le frontend ne décide jamais qu'un paiement a réussi.
-- Seul un webhook signé, vérifié côté service_role, peut faire passer
-- payments.status à 'success' — et c'est ce déclenchement, pas un appel du
-- navigateur, qui fait passer orders.status à 'paid' (cf. 0005_commerce.sql).
-- =============================================================================

create type public.payment_status as enum (
  'pending', 'provider_confirmed', 'success', 'failed', 'expired', 'cancelled', 'refunded'
);

create type public.payment_provider as enum ('mtn_momo', 'orange_money');

-- -----------------------------------------------------------------------------
-- payments : une ligne par commande, l'entité financière logique.
-- Le montant est recopié depuis orders.total_amount au moment de la création
-- par le service (jamais reçu du client) : section 47, "aucune confiance dans
-- amount, currency ou reference provenant du frontend".
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id),
  amount integer not null check (amount > 0),
  currency text not null default 'XAF' check (currency = 'XAF'),
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status);

create trigger set_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- payment_attempts : chaque appel réel au prestataire. Un paiement peut avoir
-- plusieurs tentatives (échec réseau, solde insuffisant, nouvelle tentative
-- avec un autre numéro) mais chaque tentative a sa propre idempotency_key —
-- section 15/47, "idempotency key obligatoire pour toute création d'opération
-- financière" — pour qu'un double clic ou un retry ne déclenche jamais un
-- second débit auprès du prestataire.
-- -----------------------------------------------------------------------------
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  idempotency_key uuid not null unique,
  provider public.payment_provider not null,
  phone_number text not null check (phone_number ~ '^\+237[26]\d{8}$'),
  provider_reference text,
  status public.payment_status not null default 'pending',
  failure_reason text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_attempts_payment_idx on public.payment_attempts (payment_id);
create index payment_attempts_status_idx on public.payment_attempts (status) where status = 'pending';
create unique index payment_attempts_provider_ref_idx
  on public.payment_attempts (provider, provider_reference)
  where provider_reference is not null;

create trigger set_payment_attempts_updated_at
  before update on public.payment_attempts
  for each row execute function public.set_updated_at();

comment on column public.payment_attempts.expires_at is
  'Une tentative sans confirmation prestataire passée cette date doit être marquée expired par le job de réconciliation (section 47), jamais laissée pending indéfiniment.';

-- -----------------------------------------------------------------------------
-- provider_events : journal brut de chaque webhook reçu, avant tout traitement
-- métier. external_event_id vient du prestataire ; l'unicité (provider,
-- external_event_id) est ce qui rend le traitement des webhooks idempotent
-- (section 15, "le même événement ne doit pas créer deux effets") même si le
-- prestataire renvoie le même événement plusieurs fois (retry réseau de son
-- côté). Verrouillée : aucune policy authenticated, seule la service_role
-- (qui contourne RLS) peut y écrire, depuis la fonction webhook.
-- -----------------------------------------------------------------------------
create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  external_event_id text not null,
  payment_attempt_id uuid references public.payment_attempts (id),
  signature_valid boolean not null,
  raw_payload jsonb not null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'error')),
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create index provider_events_attempt_idx on public.provider_events (payment_attempt_id);

alter table public.provider_events enable row level security;
-- Aucune policy : deny-all pour anon/authenticated. Seule la service_role
-- (Edge Function webhook) y accède, en contournant RLS comme toujours.

-- -----------------------------------------------------------------------------
-- payment_ledger : journal financier immuable (section 47, "journal financier
-- immuable/logiquement append-only"). Contrairement aux autres tables, on ne
-- se contente pas de RLS : on révoque UPDATE/DELETE au niveau des GRANTS pour
-- tous les rôles applicatifs, y compris service_role, qui contourne RLS mais
-- pas les privilèges SQL. Seul un rôle superutilisateur (hors périmètre
-- applicatif) pourrait altérer cette table — ce qui est le but.
-- -----------------------------------------------------------------------------
create table public.payment_ledger (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  payment_attempt_id uuid references public.payment_attempts (id),
  -- Les valeurs reprennent directement payment_status (cf. triggers plus bas
  -- qui journalisent new.status::text tel quel), plus 'attempt_created' et
  -- 'reconciliation_mismatch' qui ne sont pas des statuts mais des événements.
  event_type text not null check (event_type in (
    'attempt_created', 'pending', 'provider_confirmed', 'success', 'failed',
    'expired', 'cancelled', 'refunded', 'reconciliation_mismatch'
  )),
  amount integer not null,
  currency text not null default 'XAF',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index payment_ledger_payment_idx on public.payment_ledger (payment_id);

alter table public.payment_ledger enable row level security;

-- Le staff peut consulter le journal (support litiges, audit) ; jamais les
-- utilisateurs ordinaires même sur leurs propres paiements — c'est un journal
-- interne, pas une facture (l'historique orders/payments suffit côté client).
create policy "payment_ledger_select_staff"
  on public.payment_ledger for select
  to authenticated
  using (public.is_staff());

revoke update, delete on public.payment_ledger from authenticated, anon, service_role;
revoke update, delete on public.provider_events from authenticated, anon, service_role;

comment on table public.payment_ledger is
  'Append-only : UPDATE/DELETE révoqués y compris pour service_role au niveau GRANT, pas seulement RLS.';

-- -----------------------------------------------------------------------------
-- Machine à états stricte (section 47) : created → pending → provider_confirmed
-- → success, ou pending/provider_confirmed → failed/expired/cancelled, ou
-- success → refunded. Toute autre transition (retour en arrière, saut,
-- ré-succès après échec) est rejetée au niveau base, même par un bug côté
-- service.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_payment_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'pending' and new.status in
      ('provider_confirmed', 'success', 'failed', 'expired', 'cancelled') then
    return new;
  end if;

  if old.status = 'provider_confirmed' and new.status in ('success', 'failed') then
    return new;
  end if;

  if old.status = 'success' and new.status = 'refunded' then
    return new;
  end if;

  raise exception 'Transition de statut de paiement invalide : % -> %', old.status, new.status;
end;
$$;

create trigger payments_status_transition
  before update of status on public.payments
  for each row execute function public.enforce_payment_status_transition();

create trigger payment_attempts_status_transition
  before update of status on public.payment_attempts
  for each row execute function public.enforce_payment_status_transition();

-- -----------------------------------------------------------------------------
-- Répercussion sur la commande + journalisation automatique. La commande ne
-- passe à 'paid' que si elle était encore 'pending_payment' : une commande déjà
-- annulée entre-temps par l'acheteur ne doit pas être réanimée par un webhook
-- tardif (section 47, "alertes sur ... séquences impossibles" — ici on refuse
-- silencieusement plutôt que corrompre l'état, l'anomalie reste visible dans
-- payment_ledger via reconciliation_mismatch pour investigation).
-- -----------------------------------------------------------------------------
create or replace function public.apply_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    update public.orders
      set status = 'paid'
      where id = new.order_id and status = 'pending_payment';

    if not found then
      insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
      values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
        jsonb_build_object('reason', 'order_not_pending_payment_at_settlement', 'order_id', new.order_id));
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);

  return new;
end;
$$;

create trigger payments_settlement
  after update of status on public.payments
  for each row execute function public.apply_payment_settlement();

-- payment_attempts : même journalisation, sans effet sur orders (c'est
-- toujours payments.status, agrégat des tentatives, qui pilote la commande).
create or replace function public.log_payment_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text;
begin
  select currency into v_currency from public.payments where id = new.payment_id;

  insert into public.payment_ledger (payment_id, payment_attempt_id, event_type, amount, currency, metadata)
  values (
    new.payment_id, new.id,
    case when tg_op = 'INSERT' then 'attempt_created' else new.status::text end,
    coalesce((select amount from public.payments where id = new.payment_id), 0),
    coalesce(v_currency, 'XAF'),
    jsonb_build_object('provider', new.provider, 'provider_reference', new.provider_reference)
  );
  return new;
end;
$$;

create trigger payment_attempts_log_insert
  after insert on public.payment_attempts
  for each row execute function public.log_payment_attempt_transition();

create trigger payment_attempts_log_status
  after update of status on public.payment_attempts
  for each row execute function public.log_payment_attempt_transition();

-- -----------------------------------------------------------------------------
-- RLS : payments et payment_attempts sont en lecture seule pour les parties
-- prenantes. Toute écriture passe par les Edge Functions (payments-initiate,
-- payments-webhook) via service_role — jamais de policy insert/update ici,
-- pour la même raison que orders.status='paid' (section 36/47).
-- -----------------------------------------------------------------------------
alter table public.payments enable row level security;

create policy "payments_select_participant"
  on public.payments for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
    or public.is_staff()
  );

alter table public.payment_attempts enable row level security;

-- Le vendeur n'a pas besoin de voir les tentatives de paiement de l'acheteur
-- (numéro de téléphone, référence prestataire) : seul l'acheteur qui paie et
-- le staff (support litiges) y accèdent.
create policy "payment_attempts_select_buyer"
  on public.payment_attempts for select
  to authenticated
  using (
    exists (
      select 1 from public.payments p
      join public.orders o on o.id = p.order_id
      where p.id = payment_attempts.payment_id
        and (o.buyer_id = auth.uid() or public.is_staff())
    )
  );

comment on table public.payments is
  'Écriture réservée à service_role (Edge Functions payments-initiate / payments-webhook). Aucune policy insert/update authenticated : voir orders.status=paid, même principe.';
