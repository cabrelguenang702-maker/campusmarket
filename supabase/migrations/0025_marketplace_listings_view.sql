-- 0025 — Vue de lecture du catalogue : annonce + vendeur + statistiques en une seule ligne, pour que le front
-- filtre, trie (pertinence, note du vendeur) et pagine côté serveur sans N+1.
-- security_invoker : la RLS des tables sous-jacentes s'applique à celui qui interroge (un visiteur ne voit que
-- les annonces publiées ; un vendeur voit aussi les siennes ; le staff voit tout).
create view public.marketplace_listings
with (security_invoker = true) as
select
  p.id,
  p.seller_id,
  p.category_slug,
  p.name,
  p.description,
  p.price,
  p.old_price,
  p.quantity,
  p.reserved_quantity,
  (p.quantity - p.reserved_quantity) as available_quantity,
  p.condition,
  p.negotiable,
  p.campus,
  p.city,
  p.status,
  p.views,
  p.created_at,
  p.specs,
  coalesce(ps.favorites_count, 0) as favorites_count,
  (coalesce(ps.favorites_count, 0) + p.views / 10.0)::numeric(12,1) as relevance,
  pr.full_name as seller_name,
  pr.campus as seller_campus,
  pr.city as seller_city,
  pr.avatar_url as seller_avatar_url,
  pr.verified as seller_verified,
  pr.created_at as seller_since,
  coalesce(ss.rating_avg, 0) as seller_rating,
  coalesce(ss.reviews_count, 0) as seller_reviews,
  coalesce(ss.sales_count, 0) as seller_sales
from public.products p
join public.profiles pr on pr.id = p.seller_id
left join public.product_stats ps on ps.product_id = p.id
left join public.seller_stats ss on ss.seller_id = p.seller_id
where p.deleted_at is null;

revoke all on public.marketplace_listings from anon, authenticated;
grant select on public.marketplace_listings to anon, authenticated;

-- Les recherches par nom et description utilisent ilike : index trigramme si l'extension est présente.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists products_name_trgm_idx on public.products using gin (name gin_trgm_ops)';
  end if;
end $$;
