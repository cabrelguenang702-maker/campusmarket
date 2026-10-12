-- 0035 — Cycle de vie d'une commande, côté droits.
--  * Le vendeur pouvait passer une commande payée directement à `completed` (policy orders_update_seller_confirm) :
--    il clôturait seul la vente, sans que l'acheteur ait reçu l'article. Désormais : le vendeur confirme la remise
--    (`confirmed`), c'est l'ACHETEUR qui clôture (`completed`) ou ouvre un litige (`disputed`).
--  * Les policies d'UPDATE ne limitaient aucune colonne : un vendeur pouvait modifier total_amount / unit_price d'une
--    commande payée en la confirmant. Un trigger refuse tout changement hors statut et motif d'annulation, et ne
--    laisse passer que les transitions prévues.
drop policy orders_update_seller_confirm on public.orders;
create policy orders_update_seller_confirm on public.orders
  for update to authenticated
  using (seller_id = (select auth.uid()) and status = 'paid')
  with check (seller_id = (select auth.uid()) and status = 'confirmed');

create policy orders_update_buyer_complete on public.orders
  for update to authenticated
  using (buyer_id = (select auth.uid()) and status = 'confirmed')
  with check (buyer_id = (select auth.uid()) and status = 'completed');

create policy orders_update_buyer_dispute on public.orders
  for update to authenticated
  using (buyer_id = (select auth.uid()) and status in ('paid', 'confirmed'))
  with check (buyer_id = (select auth.uid()) and status = 'disputed');

create function public.tg_orders_protect_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if new.product_id is distinct from old.product_id or new.buyer_id is distinct from old.buyer_id
     or new.seller_id is distinct from old.seller_id or new.quantity is distinct from old.quantity
     or new.unit_price is distinct from old.unit_price or new.service_fee is distinct from old.service_fee
     or new.total_amount is distinct from old.total_amount or new.idempotency_key is distinct from old.idempotency_key
     or new.reservation_id is distinct from old.reservation_id or new.created_at is distinct from old.created_at then
    raise exception 'Seuls le statut et le motif d''annulation d''une commande peuvent être modifiés.';
  end if;

  if new.status is distinct from old.status and not (
       (old.status in ('pending_payment', 'paid') and new.status = 'cancelled')
    or (old.status = 'paid' and new.status in ('confirmed', 'disputed'))
    or (old.status = 'confirmed' and new.status in ('completed', 'disputed'))
  ) then
    raise exception 'Transition de statut de commande invalide : % -> %', old.status, new.status;
  end if;
  return new;
end $$;
revoke all on function public.tg_orders_protect_update() from public, anon, authenticated;
create trigger orders_protect_update before update on public.orders
  for each row execute function public.tg_orders_protect_update();
