-- 0026 — Deux fonctionnalités de l'interface sans équivalent en base :
--  1. « Me prévenir si disponible » : abonnement à une annonce réservée, notifié au retour du stock.
--  2. Favoris clôturés : un favori dont l'annonce est vendue ou archivée reste visible (état « vendue / expirée »)
--     au lieu de disparaître de la liste. Les annonces supprimées, retirées par la modération, en brouillon ou en
--     revue restent invisibles : la policy ne couvre que sold/archived.

create table public.product_alerts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index product_alerts_product_idx on public.product_alerts (product_id);
alter table public.product_alerts enable row level security;

create policy product_alerts_select_own on public.product_alerts
  for select to authenticated using (user_id = (select auth.uid()));
create policy product_alerts_insert_own on public.product_alerts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_account()
    and exists (
      select 1 from public.products p
      where p.id = product_alerts.product_id and p.status = 'published' and p.deleted_at is null
        and p.seller_id <> (select auth.uid())
    )
  );
create policy product_alerts_delete_own on public.product_alerts
  for delete to authenticated using (user_id = (select auth.uid()));
create trigger product_alerts_rate_limit before insert on public.product_alerts
  for each row execute function public.enforce_rate_limit('user_id', '50', '86400');

revoke update on public.product_alerts from authenticated;

create function public.tg_products_notify_back_in_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status = 'published' and new.deleted_at is null
     and (new.quantity - new.reserved_quantity) > 0
     and (old.status is distinct from 'published' or (old.quantity - old.reserved_quantity) <= 0) then
    for r in select user_id from public.product_alerts where product_id = new.id loop
      perform public.create_notification(
        r.user_id, 'produit', 'product_available', new.seller_id, 'product', new.id,
        jsonb_build_object('name', new.name), 'product_available:' || new.id::text
      );
    end loop;
    delete from public.product_alerts where product_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.tg_products_notify_back_in_stock() from public, anon, authenticated;
create trigger products_notify_back_in_stock
  after update of status, quantity, reserved_quantity on public.products
  for each row execute function public.tg_products_notify_back_in_stock();

create policy products_select_favorited_closed on public.products
  for select to authenticated
  using (
    status in ('sold', 'archived') and deleted_at is null
    and exists (
      select 1 from public.product_favorites f
      where f.product_id = products.id and f.user_id = (select auth.uid())
    )
  );
