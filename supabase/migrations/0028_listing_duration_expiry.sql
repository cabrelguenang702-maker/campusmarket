-- 0028 — Durée de l'annonce (15, 30 ou 60 jours, choisie à la publication) et expiration automatique.
-- Le front proposait déjà ce choix mais la base n'avait ni durée ni expiration.
--  * duration_days : choisie par le vendeur (15/30/60, 30 par défaut).
--  * expires_at   : posée par la base au moment où l'annonce passe en `published` (donc à la validation par la
--                   modération, pas à la création) ; non modifiable par le client.
--  * expire_stale_listings() : archive les annonces échues ; planifiée toutes les heures (pg_cron).
alter table public.products
  add column duration_days smallint not null default 30,
  add column expires_at timestamptz,
  add constraint products_duration_days_check check (duration_days in (15, 30, 60));

create index products_expires_idx on public.products (expires_at) where status = 'published';

create function public.tg_products_expiry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.expires_at := null;
    return new;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    new.expires_at := now() + make_interval(days => new.duration_days);
  elsif new.status = 'published' and new.duration_days is distinct from old.duration_days then
    -- Changer la durée d'une annonce déjà publiée ne prolonge pas l'échéance en cours.
    new.duration_days := old.duration_days;
    new.expires_at := old.expires_at;
  else
    new.expires_at := old.expires_at;
  end if;
  return new;
end $$;
revoke all on function public.tg_products_expiry() from public, anon, authenticated;
create trigger products_expiry before insert or update on public.products
  for each row execute function public.tg_products_expiry();

create function public.expire_stale_listings() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.products set status = 'archived'
   where status = 'published' and expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_stale_listings() from public, anon, authenticated;
grant execute on function public.expire_stale_listings() to service_role;

select cron.schedule('expire-stale-listings-hourly', '5 * * * *', 'select public.expire_stale_listings()');

-- La vue du catalogue expose l'échéance (affichée au vendeur dans « Mes annonces »).
create or replace view public.marketplace_listings
with (security_invoker = true) as
select
  p.id, p.seller_id, p.category_slug, p.name, p.description, p.price, p.old_price, p.quantity, p.reserved_quantity,
  (p.quantity - p.reserved_quantity) as available_quantity,
  p.condition, p.negotiable, p.campus, p.city, p.status, p.views, p.created_at, p.specs,
  coalesce(ps.favorites_count, 0) as favorites_count,
  (coalesce(ps.favorites_count, 0) + p.views / 10.0)::numeric(12,1) as relevance,
  pr.full_name as seller_name, pr.campus as seller_campus, pr.city as seller_city, pr.avatar_url as seller_avatar_url,
  pr.verified as seller_verified, pr.created_at as seller_since,
  coalesce(ss.rating_avg, 0) as seller_rating, coalesce(ss.reviews_count, 0) as seller_reviews, coalesce(ss.sales_count, 0) as seller_sales,
  p.expires_at, p.duration_days
from public.products p
join public.profiles pr on pr.id = p.seller_id
left join public.product_stats ps on ps.product_id = p.id
left join public.seller_stats ss on ss.seller_id = p.seller_id
where p.deleted_at is null;
