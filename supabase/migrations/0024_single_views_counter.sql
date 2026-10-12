-- 0024 — Un seul compteur de vues. products.views existait déjà (géré « par le système » : le trigger
-- protect_product_moderation interdit tout UPDATE client dessus) mais rien ne l'incrémentait ; la migration 0022
-- avait créé un doublon product_stats.views_count. On garde products.views et on supprime le doublon.
alter table public.product_stats drop column views_count;

create or replace function public.increment_product_views(p_product_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.products
     set views = views + 1
   where id = p_product_id
     and status = 'published' and deleted_at is null
     and seller_id <> (select auth.uid());
$$;
revoke all on function public.increment_product_views(uuid) from public, anon;
grant execute on function public.increment_product_views(uuid) to authenticated;
