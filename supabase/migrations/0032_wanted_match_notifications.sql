-- 0032 — « Me prévenir » sur Je recherche : plutôt qu'un abonnement à activer à la main, chaque demande ouverte
-- prévient son auteur quand une annonce correspondante est publiée (même catégorie, prix <= budget + 15 %,
-- vendeur différent). Même règle que l'écran « Résultats correspondants ». Limité à 50 demandes par annonce.
create function public.tg_products_notify_wanted_match() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status = 'published' and new.deleted_at is null and old.status is distinct from 'published'
     and (new.quantity - new.reserved_quantity) > 0 then
    for r in
      select id, author_id from public.wanted_requests
       where status = 'open' and category_slug = new.category_slug
         and new.price <= budget * 1.15 and author_id <> new.seller_id
       order by created_at desc limit 50
    loop
      perform public.create_notification(
        r.author_id, 'produit', 'wanted_match', new.seller_id, 'product', new.id,
        jsonb_build_object('name', new.name, 'request_id', r.id), 'wanted_match:' || r.id::text
      );
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.tg_products_notify_wanted_match() from public, anon, authenticated;
create trigger products_notify_wanted_match
  after update of status on public.products
  for each row execute function public.tg_products_notify_wanted_match();
