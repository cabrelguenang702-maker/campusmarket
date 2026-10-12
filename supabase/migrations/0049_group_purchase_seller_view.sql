-- 0049 — Le vendeur qui organise un achat groupé voit la liste de ses participants (il doit livrer ces personnes).
drop policy if exists gpp_select_seller on public.group_purchase_participants;
create policy gpp_select_seller on public.group_purchase_participants for select to authenticated
  using (exists (
    select 1
    from public.group_purchases gp
    join public.products p on p.id = gp.product_id
    where gp.id = group_purchase_participants.group_purchase_id and p.seller_id = (select auth.uid())
  ));
