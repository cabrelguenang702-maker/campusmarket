-- 0052 — Achats groupés : participation, paiement au prix du palier, blocage de 48 h
--
-- Modèle (validé) :
--   * Rejoindre = s'engager au prix du palier courant, SANS payer. Rien n'est débité, donc rien à rembourser.
--   * Quand l'objectif de participants est atteint, le groupe passe en « reached » : prix final = palier atteint, le même
--     pour tous. Chaque participant a 48 h pour payer par une commande normale (CamPay) à ce prix ; sa place est
--     réservée pendant ce délai.
--   * Échéance atteinte sans objectif, ou annulation par le vendeur : le groupe se clôt, personne n'a rien payé.
--   * Qui s'engage puis se retire, ou ne paie pas dans les 48 h, est bloqué 48 h pour REJOINDRE un achat groupé
--     (il peut toujours acheter normalement). Il se débloque tout de suite en payant 500 F (même circuit CamPay).
--   * La création passe par create_group_purchase (conditions validées côté base) ; plus d'insertion directe.

-- ---------------------------------------------------------------------------------------------------------------
-- Colonnes
-- ---------------------------------------------------------------------------------------------------------------
alter table public.group_purchase_participants
  alter column paid_amount set default 0,
  add column if not exists status text not null default 'committed' check (status in ('committed', 'paid', 'withdrawn', 'expired')),
  add column if not exists unit_price integer check (unit_price >= 0),
  add column if not exists pay_deadline timestamptz,
  add column if not exists reservation_id uuid references public.reservations (id),
  add column if not exists order_id uuid references public.orders (id),
  add column if not exists left_at timestamptz;

alter table public.group_purchases
  add column if not exists reached_at timestamptz,
  add column if not exists final_unit_price integer check (final_unit_price >= 0);

alter table public.orders add column if not exists group_purchase_id uuid references public.group_purchases (id);
create unique index if not exists orders_group_buyer_uidx on public.orders (group_purchase_id, buyer_id)
  where group_purchase_id is not null and status <> 'cancelled';
create index if not exists gpp_status_deadline_idx on public.group_purchase_participants (pay_deadline) where status = 'committed';

-- Seuls les engagements actifs comptent comme membres.
create or replace function public.is_group_purchase_member(p_group uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_purchase_participants
                  where group_purchase_id = p_group and buyer_id = p_user and status in ('committed', 'paid'));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Blocage et déblocage
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.group_buy_blocks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  blocked_until timestamptz not null,
  reason text not null check (reason in ('withdrawn', 'unpaid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.group_buy_blocks enable row level security;
drop policy if exists group_buy_blocks_select_own on public.group_buy_blocks;
create policy group_buy_blocks_select_own on public.group_buy_blocks for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
drop policy if exists mfa_required on public.group_buy_blocks;
create policy mfa_required on public.group_buy_blocks as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create table if not exists public.group_buy_unblocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount > 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled')),
  created_at timestamptz not null default now()
);
create unique index if not exists group_buy_unblocks_one_pending on public.group_buy_unblocks (user_id) where status = 'pending_payment';
alter table public.group_buy_unblocks enable row level security;
drop policy if exists group_buy_unblocks_select_own on public.group_buy_unblocks;
create policy group_buy_unblocks_select_own on public.group_buy_unblocks for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
drop policy if exists mfa_required on public.group_buy_unblocks;
create policy mfa_required on public.group_buy_unblocks as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create or replace function public.group_buy_unblock_fee() returns integer
language sql immutable parallel safe set search_path = '' as $$ select 500 $$;
grant execute on function public.group_buy_unblock_fee() to authenticated;

-- Le paiement de déblocage passe par le même pipeline que les commandes, billets et formations.
alter table public.payments drop constraint if exists payments_exactly_one_target;
alter table public.payments add column if not exists group_unblock_id uuid references public.group_buy_unblocks (id);
alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id, group_unblock_id) = 1);
create unique index if not exists payments_group_unblock_uidx on public.payments (group_unblock_id) where group_unblock_id is not null;

drop policy if exists payments_select_participant on public.payments;
create policy payments_select_participant on public.payments for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = payments.order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid()))
    or exists (select 1 from public.course_enrollments e where e.id = payments.course_enrollment_id and e.user_id = auth.uid())
    or exists (select 1 from public.event_tickets t where t.id = payments.event_ticket_id and t.attendee_id = auth.uid())
    or exists (select 1 from public.group_buy_unblocks u where u.id = payments.group_unblock_id and u.user_id = auth.uid())
    or public.is_staff()
  );

create or replace function public.apply_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    if new.order_id is not null then
      update public.orders set status = 'paid' where id = new.order_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'order_not_pending_payment_at_settlement', 'order_id', new.order_id));
      end if;
    elsif new.course_enrollment_id is not null then
      update public.course_enrollments set status = 'active' where id = new.course_enrollment_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'enrollment_not_pending_payment_at_settlement', 'course_enrollment_id', new.course_enrollment_id));
      end if;
    elsif new.group_unblock_id is not null then
      update public.group_buy_unblocks set status = 'paid' where id = new.group_unblock_id and status = 'pending_payment'
        returning user_id into v_user;
      if v_user is not null then
        delete from public.group_buy_blocks where user_id = v_user;
        perform public.create_notification(v_user, 'groupe', 'group_buy_unblocked', null, 'group_buy_unblock', new.group_unblock_id, '{}'::jsonb, 'gbu:' || new.group_unblock_id);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'unblock_not_pending_payment_at_settlement', 'group_unblock_id', new.group_unblock_id));
      end if;
    else
      update public.event_tickets set status = 'valid' where id = new.event_ticket_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'ticket_not_pending_payment_at_settlement', 'event_ticket_id', new.event_ticket_id));
      end if;
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fonctions internes (aucune exécution depuis le client)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.apply_group_buy_block(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_until timestamptz := now() + interval '48 hours';
begin
  insert into public.group_buy_blocks (user_id, blocked_until, reason) values (p_user, v_until, p_reason)
  on conflict (user_id) do update
    set blocked_until = greatest(public.group_buy_blocks.blocked_until, excluded.blocked_until), reason = excluded.reason, updated_at = now();
  perform public.create_notification(p_user, 'groupe', 'group_buy_blocked', null, 'group_buy_block', null,
    jsonb_build_object('until', v_until), 'gbb:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
end;
$$;

-- Objectif atteint : prix final = palier atteint ; chaque engagé reçoit 48 h pour payer, sa place est réservée.
create or replace function public.reach_group_purchase(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g public.group_purchases;
  v_base integer;
  v_price integer;
  v_deadline timestamptz := now() + interval '48 hours';
  part record;
  v_res uuid;
begin
  select * into g from public.group_purchases where id = p_group for update;
  if not found or g.status <> 'active' then return; end if;
  select price into v_base from public.products where id = g.product_id;
  select coalesce(
    (select t.unit_price from public.group_purchase_tiers t
      where t.group_purchase_id = p_group and t.min_participants <= g.participant_count
      order by t.min_participants desc limit 1), v_base) into v_price;

  update public.group_purchases set status = 'reached', reached_at = now(), final_unit_price = v_price where id = p_group;

  for part in select id, buyer_id from public.group_purchase_participants
               where group_purchase_id = p_group and status = 'committed' order by joined_at loop
    begin
      insert into public.reservations (product_id, buyer_id, quantity, expires_at) values (g.product_id, part.buyer_id, 1, v_deadline) returning id into v_res;
      update public.group_purchase_participants set unit_price = v_price, pay_deadline = v_deadline, reservation_id = v_res where id = part.id;
      perform public.create_notification(part.buyer_id, 'groupe', 'group_purchase_reached', null, 'group_purchase', p_group,
        jsonb_build_object('product_id', g.product_id, 'unit_price', v_price, 'deadline', v_deadline), 'gp:reached:' || p_group || ':' || part.buyer_id);
    exception when others then
      -- Stock devenu insuffisant (achat classique entre-temps) : ce n'est pas la faute de la personne, aucun blocage.
      update public.group_purchase_participants set status = 'expired', left_at = now() where id = part.id;
      perform public.create_notification(part.buyer_id, 'groupe', 'group_purchase_cancelled', null, 'group_purchase', p_group,
        jsonb_build_object('product_id', g.product_id), 'gp:stock:' || p_group || ':' || part.buyer_id);
    end;
  end loop;
end;
$$;

-- Groupe annulé ou expiré : les engagements non payés se terminent, sans blocage ni paiement.
create or replace function public.close_group_purchase_participants(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  part record;
  v_product uuid;
begin
  select product_id into v_product from public.group_purchases where id = p_group;
  for part in select id, buyer_id, reservation_id, order_id from public.group_purchase_participants
               where group_purchase_id = p_group and status = 'committed' loop
    update public.group_purchase_participants set status = 'expired', left_at = now() where id = part.id;
    if part.reservation_id is not null then
      update public.reservations set status = 'cancelled' where id = part.reservation_id and status = 'active';
    end if;
    if part.order_id is not null then
      update public.orders set status = 'cancelled', cancel_reason = 'group_closed' where id = part.order_id and status = 'pending_payment';
    end if;
    perform public.create_notification(part.buyer_id, 'groupe', 'group_purchase_cancelled', null, 'group_purchase', p_group,
      jsonb_build_object('product_id', v_product), 'gp:closed:' || p_group || ':' || part.buyer_id);
  end loop;
end;
$$;

create or replace function public.tg_group_purchase_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.close_group_purchase_participants(new.id);
  return null;
end;
$$;
drop trigger if exists group_purchases_closed on public.group_purchases;
create trigger group_purchases_closed after update of status on public.group_purchases
  for each row when (old.status = 'active' and new.status in ('cancelled', 'expired'))
  execute function public.tg_group_purchase_closed();

-- Compteur = engagements actifs ; atteindre l'objectif déclenche le passage en phase de paiement.
create or replace function public.sync_group_purchase_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_group uuid := coalesce(new.group_purchase_id, old.group_purchase_id);
  v_count integer;
  g public.group_purchases;
begin
  select count(*) into v_count from public.group_purchase_participants where group_purchase_id = v_group and status in ('committed', 'paid');
  update public.group_purchases set participant_count = v_count where id = v_group returning * into g;
  if g.status = 'active' and g.ends_at > now() and v_count >= g.target_participants then
    perform public.reach_group_purchase(v_group);
  end if;
  return null;
end;
$$;
drop trigger if exists group_purchase_participants_sync on public.group_purchase_participants;
create trigger group_purchase_participants_sync after insert or update of status or delete on public.group_purchase_participants
  for each row execute function public.sync_group_purchase_count();

-- ---------------------------------------------------------------------------------------------------------------
-- Commande au prix du palier
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.place_group_order_terms(p_group uuid, p_product uuid)
returns table (seller_id uuid, unit_price integer, service_fee integer, total_amount integer, reservation_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := (select auth.uid());
  g record;
  part record;
  v_seller uuid;
  v_fee integer;
begin
  if v_buyer is null then raise exception 'Connexion requise.'; end if;
  select gp.product_id, gp.status into g from public.group_purchases gp where gp.id = p_group;
  if not found or g.product_id <> p_product or g.status <> 'reached' then
    raise exception 'Cet achat groupé n''est pas en phase de paiement.';
  end if;
  select gpp.id, gpp.status, gpp.unit_price, gpp.pay_deadline, gpp.reservation_id into part
    from public.group_purchase_participants gpp where gpp.group_purchase_id = p_group and gpp.buyer_id = v_buyer for update;
  if not found or part.status <> 'committed' then raise exception 'Vous ne participez pas à cet achat groupé.'; end if;
  if part.pay_deadline is null or part.pay_deadline <= now() then raise exception 'Le délai de paiement de 48 h est dépassé.'; end if;
  if part.reservation_id is null or not exists (select 1 from public.reservations r where r.id = part.reservation_id and r.status = 'active') then
    raise exception 'Votre place n''est plus réservée.';
  end if;
  select pr.seller_id into v_seller from public.products pr where pr.id = p_product;
  v_fee := public.order_service_fee(part.unit_price);
  return query select v_seller, part.unit_price, v_fee, part.unit_price + v_fee, part.reservation_id;
end $$;
revoke all on function public.place_group_order_terms(uuid, uuid) from public, anon;
grant execute on function public.place_group_order_terms(uuid, uuid) to authenticated;

create or replace function public.tg_orders_enforce_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare t record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.group_purchase_id is not null then
    select * into t from public.place_group_order_terms(new.group_purchase_id, new.product_id);
    new.quantity := 1;
  else
    select * into t from public.place_order_terms(new.product_id, new.quantity);
  end if;
  new.seller_id := t.seller_id;
  new.unit_price := t.unit_price;
  new.service_fee := t.service_fee;
  new.total_amount := t.total_amount;
  new.reservation_id := t.reservation_id;
  new.status := 'pending_payment';
  new.cancel_reason := null;
  return new;
end $$;

-- Suivi de la commande de groupe : création, paiement, annulation.
create or replace function public.tg_group_order_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.group_purchase_participants set order_id = new.id
   where group_purchase_id = new.group_purchase_id and buyer_id = new.buyer_id;
  return null;
end $$;
drop trigger if exists orders_group_created on public.orders;
create trigger orders_group_created after insert on public.orders
  for each row when (new.group_purchase_id is not null) execute function public.tg_group_order_created();

create or replace function public.tg_group_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reason text;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update public.group_purchase_participants set status = 'paid', paid_amount = new.total_amount, order_id = new.id
     where group_purchase_id = new.group_purchase_id and buyer_id = new.buyer_id and status = 'committed';
  elsif new.status = 'cancelled' and old.status = 'pending_payment' then
    -- Annulation par l'acheteur ou réservation expirée alors que l'engagement tient encore = engagement non tenu.
    v_reason := case when new.cancel_reason = 'reservation_expired' then 'unpaid' else 'withdrawn' end;
    update public.group_purchase_participants
       set status = case when v_reason = 'unpaid' then 'expired' else 'withdrawn' end, left_at = now()
     where group_purchase_id = new.group_purchase_id and buyer_id = new.buyer_id and status = 'committed';
    if found then perform public.apply_group_buy_block(new.buyer_id, v_reason); end if;
  end if;
  return null;
end $$;
drop trigger if exists orders_group_status on public.orders;
create trigger orders_group_status after update of status on public.orders
  for each row when (new.group_purchase_id is not null) execute function public.tg_group_order_status();

-- ---------------------------------------------------------------------------------------------------------------
-- Fonctions appelées par le client
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.my_group_buy_block()
returns timestamptz language sql stable security definer set search_path = public as $$
  select blocked_until from public.group_buy_blocks where user_id = auth.uid() and blocked_until > now();
$$;

create or replace function public.join_group_purchase(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  g public.group_purchases;
  p record;
  part public.group_purchase_participants;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  perform public.assert_mfa();
  if not public.is_active_account() then raise exception 'Votre compte ne permet pas cette action.'; end if;

  select * into g from public.group_purchases where id = p_group for update;
  if not found or g.status <> 'active' or g.ends_at <= now() then
    raise exception 'Cet achat groupé n''accepte plus de participants.';
  end if;
  select seller_id, status, deleted_at into p from public.products where id = g.product_id;
  if p.status <> 'published' or p.deleted_at is not null then raise exception 'Cette annonce n''est plus disponible.'; end if;
  if p.seller_id = v_uid then raise exception 'Vous ne pouvez pas rejoindre votre propre achat groupé.'; end if;
  if exists (select 1 from public.group_buy_blocks where user_id = v_uid and blocked_until > now()) then
    raise exception 'Vous ne pouvez pas rejoindre d''achat groupé pour le moment : un engagement précédent n''a pas été tenu. Le blocage se lève automatiquement, ou tout de suite pour 500 F.';
  end if;

  select * into part from public.group_purchase_participants where group_purchase_id = p_group and buyer_id = v_uid for update;
  if found then
    if part.status in ('committed', 'paid') then raise exception 'Vous participez déjà à cet achat groupé.'; end if;
    update public.group_purchase_participants
       set status = 'committed', left_at = null, joined_at = now(), unit_price = null, pay_deadline = null, reservation_id = null, order_id = null
     where id = part.id;
  else
    insert into public.group_purchase_participants (group_purchase_id, buyer_id) values (p_group, v_uid);
  end if;
end;
$$;

create or replace function public.leave_group_purchase(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  part public.group_purchase_participants;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  perform public.assert_mfa();
  select * into part from public.group_purchase_participants where group_purchase_id = p_group and buyer_id = v_uid for update;
  if not found or part.status = 'withdrawn' or part.status = 'expired' then raise exception 'Vous ne participez plus à cet achat groupé.'; end if;
  if part.status = 'paid' then raise exception 'Vous avez déjà payé : contactez le support pour toute demande.'; end if;

  update public.group_purchase_participants set status = 'withdrawn', left_at = now(), pay_deadline = null where id = part.id;
  if part.reservation_id is not null then
    update public.reservations set status = 'cancelled' where id = part.reservation_id and status = 'active';
  end if;
  if part.order_id is not null then
    update public.orders set status = 'cancelled', cancel_reason = 'group_withdrawn' where id = part.order_id and status = 'pending_payment';
  end if;
  perform public.apply_group_buy_block(v_uid, 'withdrawn');
end;
$$;

create or replace function public.create_group_purchase(p_product uuid, p_target integer, p_ends_at timestamptz, p_tiers jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  p record;
  v_id uuid;
  t jsonb;
  v_min integer;
  v_price integer;
  v_prev_min integer := 0;
  v_prev_price integer;
  v_n integer;
begin
  if v_uid is null then raise exception 'Connexion requise.' using errcode = '42501'; end if;
  perform public.assert_mfa();
  if not public.is_active_account() then raise exception 'Votre compte ne permet pas cette action.'; end if;

  select seller_id, price, quantity, status, deleted_at into p from public.products where id = p_product;
  if not found or p.seller_id <> v_uid then raise exception 'Cette annonce ne vous appartient pas.'; end if;
  if p.status <> 'published' or p.deleted_at is not null then raise exception 'Publiez d''abord votre annonce.'; end if;
  if p_target is null or p_target < 2 or p_target > 100 then raise exception 'L''objectif doit être compris entre 2 et 100 participants.'; end if;
  if p.quantity < p_target then raise exception 'Votre stock (% unité(s)) ne couvre pas l''objectif de % participants.', p.quantity, p_target; end if;
  if p_ends_at is null or p_ends_at < now() + interval '1 hour' or p_ends_at > now() + interval '30 days' then
    raise exception 'L''échéance doit se situer entre 1 heure et 30 jours à partir de maintenant.';
  end if;
  if exists (select 1 from public.group_purchases where product_id = p_product and status = 'active') then
    raise exception 'Cette annonce a déjà un achat groupé en cours.';
  end if;
  if (select count(*) from public.group_purchases gp join public.products pr on pr.id = gp.product_id
       where pr.seller_id = v_uid and gp.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Trop d''achats groupés créés aujourd''hui. Réessayez demain.';
  end if;
  if jsonb_typeof(p_tiers) <> 'array' then raise exception 'Paliers invalides.'; end if;
  v_n := jsonb_array_length(p_tiers);
  if v_n < 1 or v_n > 5 then raise exception 'Définissez entre 1 et 5 paliers de prix.'; end if;

  -- Paliers strictement croissants en participants et strictement décroissants en prix, tous sous le prix de l'annonce.
  v_prev_price := p.price;
  for t in select value from jsonb_array_elements(p_tiers) order by (value ->> 'min_participants')::integer loop
    v_min := (t ->> 'min_participants')::integer;
    v_price := (t ->> 'unit_price')::integer;
    if v_min is null or v_price is null or v_min < 2 or v_min > p_target or v_min <= v_prev_min then
      raise exception 'Chaque palier doit avoir un nombre de participants distinct entre 2 et l''objectif.';
    end if;
    if v_price < 0 or v_price >= v_prev_price then
      raise exception 'Le prix doit baisser à chaque palier et rester inférieur au prix de l''annonce.';
    end if;
    v_prev_min := v_min;
    v_prev_price := v_price;
  end loop;

  insert into public.group_purchases (product_id, target_participants, ends_at) values (p_product, p_target, p_ends_at) returning id into v_id;
  insert into public.group_purchase_tiers (group_purchase_id, min_participants, unit_price)
    select v_id, (value ->> 'min_participants')::integer, (value ->> 'unit_price')::integer from jsonb_array_elements(p_tiers);
  return v_id;
end;
$$;

-- Création uniquement via create_group_purchase ; le vendeur garde la possibilité d'annuler (UPDATE) son groupe.
drop policy if exists group_purchases_seller_write on public.group_purchases;
create policy group_purchases_seller_update on public.group_purchases for update to authenticated
  using (exists (select 1 from public.products p where p.id = group_purchases.product_id and p.seller_id = (select auth.uid())))
  with check (exists (select 1 from public.products p where p.id = group_purchases.product_id and p.seller_id = (select auth.uid())));
drop policy if exists group_purchase_tiers_seller_write on public.group_purchase_tiers;

-- ---------------------------------------------------------------------------------------------------------------
-- Tâche planifiée : échéances sans objectif, annonces retirées, délais de paiement dépassés
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.process_group_purchases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  part record;
begin
  update public.group_purchases gp set status = 'expired' where gp.status = 'active' and gp.ends_at <= now();
  get diagnostics v_count = row_count;

  update public.group_purchases gp set status = 'cancelled'
   where gp.status = 'active'
     and exists (select 1 from public.products pr where pr.id = gp.product_id and (pr.status <> 'published' or pr.deleted_at is not null));

  -- Délai de 48 h dépassé sans paiement : engagement expiré, place libérée, blocage de 48 h.
  -- Un paiement lancé depuis moins de 15 min peut encore aboutir : on laisse la main au prochain passage.
  for part in
    select gpp.id, gpp.buyer_id, gpp.reservation_id, gpp.order_id from public.group_purchase_participants gpp
     where gpp.status = 'committed' and gpp.pay_deadline is not null and gpp.pay_deadline <= now()
       and not exists (
         select 1 from public.payments pay join public.payment_attempts a on a.payment_id = pay.id
          where pay.order_id = gpp.order_id and a.status = 'pending' and a.created_at > now() - interval '15 minutes')
     for update skip locked
  loop
    update public.group_purchase_participants set status = 'expired', left_at = now() where id = part.id and status = 'committed';
    if found then
      if part.reservation_id is not null then
        update public.reservations set status = 'expired' where id = part.reservation_id and status = 'active';
      end if;
      if part.order_id is not null then
        update public.orders set status = 'cancelled', cancel_reason = 'group_payment_deadline' where id = part.order_id and status = 'pending_payment';
      end if;
      perform public.apply_group_buy_block(part.buyer_id, 'unpaid');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

do $cron$
begin
  perform cron.unschedule('process-group-purchases') where exists (select 1 from cron.job where jobname = 'process-group-purchases');
  perform cron.schedule('process-group-purchases', '*/10 * * * *', 'select public.process_group_purchases();');
exception when others then
  raise notice 'pg_cron indisponible : planifier public.process_group_purchases() toutes les 10 minutes manuellement (%)', sqlerrm;
end
$cron$;

-- ---------------------------------------------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.apply_group_buy_block(uuid, text) from public, anon, authenticated;
revoke all on function public.reach_group_purchase(uuid) from public, anon, authenticated;
revoke all on function public.close_group_purchase_participants(uuid) from public, anon, authenticated;
revoke all on function public.tg_group_purchase_closed() from public, anon, authenticated;
revoke all on function public.tg_group_order_created() from public, anon, authenticated;
revoke all on function public.tg_group_order_status() from public, anon, authenticated;
revoke all on function public.sync_group_purchase_count() from public, anon, authenticated;
revoke all on function public.process_group_purchases() from public, anon, authenticated;
revoke all on function public.my_group_buy_block() from public, anon;
revoke all on function public.join_group_purchase(uuid) from public, anon;
revoke all on function public.leave_group_purchase(uuid) from public, anon;
revoke all on function public.create_group_purchase(uuid, integer, timestamptz, jsonb) from public, anon;
grant execute on function public.my_group_buy_block() to authenticated;
grant execute on function public.join_group_purchase(uuid) to authenticated;
grant execute on function public.leave_group_purchase(uuid) to authenticated;
grant execute on function public.create_group_purchase(uuid, integer, timestamptz, jsonb) to authenticated;
