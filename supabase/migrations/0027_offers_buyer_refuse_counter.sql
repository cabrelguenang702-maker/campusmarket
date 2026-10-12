-- 0027 — L'acheteur doit pouvoir refuser (ou retirer) une contre-offre du vendeur.
-- Le trigger enforce_offer_status_transition l'autorisait déjà (countered -> rejected/withdrawn, par l'acheteur),
-- mais aucune policy RLS d'UPDATE ne le permettait : le bouton « Refuser » aurait mis à jour 0 ligne sans erreur.
create policy offers_refuse_counter_buyer on public.offers
  for update to authenticated
  using (buyer_id = (select auth.uid()) and status = 'countered')
  with check (buyer_id = (select auth.uid()) and status in ('rejected', 'withdrawn'));
