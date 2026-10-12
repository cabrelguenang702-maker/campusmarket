-- 0033 — Les photos d'une annonce publiée ne doivent pas changer sans nouvelle validation.
-- products_update_own interdit déjà de modifier une annonce `published` sans la repasser en revue, mais la policy
-- product_media_write_own (FOR ALL) laissait le vendeur ajouter, remplacer ou retirer des photos d'une annonce déjà
-- validée : on pouvait publier une annonce propre puis changer ses photos. Les écritures sur product_media ne sont
-- désormais possibles que tant que l'annonce n'est pas `published` (le vendeur la repasse en revue pour la modifier).
drop policy product_media_write_own on public.product_media;

create policy product_media_insert_own on public.product_media
  for insert to authenticated
  with check (exists (
    select 1 from public.products p
    where p.id = product_media.product_id and p.seller_id = (select auth.uid()) and p.status <> 'published'
  ));
create policy product_media_update_own on public.product_media
  for update to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_media.product_id and p.seller_id = (select auth.uid()) and p.status <> 'published'
  ))
  with check (exists (
    select 1 from public.products p
    where p.id = product_media.product_id and p.seller_id = (select auth.uid()) and p.status <> 'published'
  ));
create policy product_media_delete_own on public.product_media
  for delete to authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_media.product_id and p.seller_id = (select auth.uid()) and p.status <> 'published'
  ));
