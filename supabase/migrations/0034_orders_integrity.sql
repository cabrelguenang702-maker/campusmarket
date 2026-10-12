-- 0034 — Intégrité des commandes. Trouvé en branchant l'écran d'achat :
--  1. L'acheteur insérait lui-même unit_price, service_fee et total_amount (seules des CHECK >= 0 existaient), or
--     payments-initiate débite orders.total_amount : on pouvait acheter un article 250 000 FCFA pour 1 FCFA. Il pouvait
--     aussi choisir seller_id (commande attribuée à un autre vendeur).
--  2. Aucune réservation n'était créée pour une commande ; payée, la commande ne retirait rien du stock (le trigger de
--     fermeture ne libérait que reserved_quantity) : l'article restait achetable à l'infini.
--  3. Une commande dont la réservation expirait restait « pending_payment » ; une commande annulée ne libérait pas le stock.
--  4. Une commande issue d'une offre acceptée n'avait ni frais de service ni réservation.
--
-- Principe : le client n'envoie que product_id, quantity, idempotency_key (+ lieu et message). Tout le reste est fixé par
-- la base. Frais de service : 2 % (valeur reprise de l'interface, À CONFIRMER : c'est un paramètre métier).

create function public.order_service_fee(p_subtotal integer) returns integer
language sql immutable parallel safe set search_path = '' as $$
  select round(p_subtotal * 0.02)::integer
$$;
revoke all on function public.order_service_fee(integer) from public, anon;
grant execute on function public.order_service_fee(integer) to authenticated, service_role;

-- Calcule les conditions d'une commande et réserve le stock (30 min, défaut de reservations.expires_at).
create function public.place_order_terms(p_product_id uuid, p_quantity integer)
returns table (seller_id uuid, unit_price integer, service_fee integer, total_amount integer, reservation_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := (select auth.uid());
  p record;
  v_res uuid;
  v_subtotal integer;
  v_fee integer;
begin
  if v_buyer is null then raise exception 'Connexion requise.'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 5 then raise exception 'Quantité invalide : choisissez entre 1 et 5.'; end if;

  select pr.id, pr.seller_id, pr.price, pr.quantity, pr.reserved_quantity, pr.status, pr.deleted_at
    into p from public.products pr where pr.id = p_product_id for update;
  if not found or p.status <> 'published' or p.deleted_at is not null then
    raise exception 'Cette annonce n''est plus disponible.';
  end if;
  if p.seller_id = v_buyer then raise exception 'Vous ne pouvez pas acheter votre propre annonce.'; end if;
  if p.quantity - p.reserved_quantity < p_quantity then
    raise exception 'Stock insuffisant : % unité(s) disponible(s).', greatest(p.quantity - p.reserved_quantity, 0);
  end if;

  insert into public.reservations (product_id, buyer_id, quantity) values (p.id, v_buyer, p_quantity) returning id into v_res;

  v_subtotal := p.price * p_quantity;
  v_fee := public.order_service_fee(v_subtotal);
  return query select p.seller_id, p.price, v_fee, v_subtotal + v_fee, v_res;
end $$;
revoke all on function public.place_order_terms(uuid, integer) from public, anon;
grant execute on function public.place_order_terms(uuid, integer) to authenticated;

-- Déclenché pour les clients seulement : les commandes créées par le serveur (offre acceptée) fixent leurs propres termes.
create function public.tg_orders_enforce_integrity() returns trigger
language plpgsql set search_path = '' as $$
declare t record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  select * into t from public.place_order_terms(new.product_id, new.quantity);
  new.seller_id := t.seller_id;
  new.unit_price := t.unit_price;
  new.service_fee := t.service_fee;
  new.total_amount := t.total_amount;
  new.reservation_id := t.reservation_id;
  new.status := 'pending_payment';
  new.cancel_reason := null;
  return new;
end $$;
revoke all on function public.tg_orders_enforce_integrity() from public, anon, authenticated;
create trigger orders_enforce_integrity before insert on public.orders
  for each row execute function public.tg_orders_enforce_integrity();

-- Offre acceptée -> commande : même règles (frais de service et réservation du stock).
create or replace function public.convert_accepted_offer_to_order() returns trigger
language plpgsql security definer set search_path = 'public' as $$
declare
  v_price integer;
  v_fee integer;
  v_order_id uuid;
  v_res uuid;
  v_available integer;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then
    return new;
  end if;

  perform 1 from public.products p where p.id = new.product_id for update;

  select (p.quantity - p.reserved_quantity) into v_available
    from public.products p
    where p.id = new.product_id and p.status = 'published';

  if v_available is null or v_available < 1 then
    raise exception 'Cette annonce n''est plus disponible : impossible de convertir l''offre % en commande', new.id;
  end if;

  v_price := case when old.status = 'countered' then new.counter_amount else new.amount end;
  v_fee := public.order_service_fee(v_price);

  insert into public.reservations (product_id, buyer_id, quantity) values (new.product_id, new.buyer_id, 1) returning id into v_res;

  insert into public.orders (idempotency_key, product_id, buyer_id, seller_id, quantity, unit_price, service_fee, total_amount, status, reservation_id)
  values (gen_random_uuid(), new.product_id, new.buyer_id, new.seller_id, 1, v_price, v_fee, v_price + v_fee, 'pending_payment', v_res)
  returning id into v_order_id;

  update public.offers set order_id = v_order_id where id = new.id;
  return new;
end;
$$;

-- Fermeture d'une réservation : libère toujours le réservé ; si elle est convertie (commande payée), l'article est vendu :
-- le stock diminue et l'annonce passe à `sold` quand il n'en reste plus.
create or replace function public.release_stock_on_reservation_close() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    if new.status = 'converted' then
      update public.products
         set reserved_quantity = greatest(reserved_quantity - old.quantity, 0),
             quantity = greatest(quantity - old.quantity, 0),
             status = case when quantity - old.quantity <= 0 and status = 'published' then 'sold' else status end
       where id = old.product_id;
    else
      update public.products
         set reserved_quantity = greatest(reserved_quantity - old.quantity, 0)
       where id = old.product_id;
    end if;
  end if;
  return new;
end;
$$;

-- Commande payée : convertit la réservation. Si elle avait expiré entre-temps (paiement tardif), on retire le stock
-- directement s'il en reste ; sinon la commande passe en litige (remboursement manuel par le support).
create or replace function public.convert_reservation_on_order_paid() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.reservation_id is not null then
    update public.reservations set status = 'converted', order_id = new.id
     where id = new.reservation_id and status = 'active';
    if not found then
      update public.products
         set quantity = quantity - new.quantity,
             status = case when quantity - new.quantity <= 0 and status = 'published' then 'sold' else status end
       where id = new.product_id and quantity - reserved_quantity >= new.quantity;
      if not found then
        update public.orders set status = 'disputed' where id = new.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Commande annulée : libère la réservation active, ou remet en stock si elle était déjà payée.
create function public.tg_orders_release_on_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status in ('pending_payment', 'paid') then
    if new.reservation_id is not null then
      update public.reservations set status = 'cancelled' where id = new.reservation_id and status = 'active';
      if found then return null; end if;
    end if;
    if old.status = 'paid' then
      update public.products
         set quantity = quantity + new.quantity,
             status = case when status = 'sold' and deleted_at is null then 'published' else status end
       where id = new.product_id;
    end if;
  end if;
  return null;
end $$;
revoke all on function public.tg_orders_release_on_cancel() from public, anon, authenticated;
create trigger orders_release_on_cancel after update of status on public.orders
  for each row execute function public.tg_orders_release_on_cancel();

-- Réservation expirée : la commande en attente de paiement est annulée. On épargne les réservations dont un paiement
-- vient d'être lancé (tentative en cours < 15 min) : le rapprochement ou le webhook doit pouvoir conclure.
create or replace function public.expire_stale_reservations() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare v_count integer;
begin
  with expiring as (
    select r.id from public.reservations r
     where r.status = 'active' and r.expires_at < now()
       and not exists (
         select 1 from public.orders o
           join public.payments pay on pay.order_id = o.id
           join public.payment_attempts a on a.payment_id = pay.id
          where o.reservation_id = r.id and a.status = 'pending' and a.created_at > now() - interval '15 minutes')
  ), done as (
    update public.reservations set status = 'expired' where id in (select id from expiring) returning id
  ), cancelled as (
    update public.orders o set status = 'cancelled', cancel_reason = 'reservation_expired'
     where o.status = 'pending_payment' and o.reservation_id in (select id from done) returning o.id
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;
