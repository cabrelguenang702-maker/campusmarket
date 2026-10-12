-- =============================================================================
-- Test de fumée — commandes (orders) : transitions de statut par RLS.
-- À exécuter en LOCAL uniquement, après migrations + seed (voir tests/smoke_test.sql
-- pour le principe général). Complète ce dernier avec les cas spécifiques aux
-- commandes, qui sont les plus sensibles (argent, section 47).
--
-- Point important vérifié ici : une transition interdite par RLS sur une ligne que
-- l'utilisateur a le droit de voir/modifier (USING passe) lève une vraie erreur
-- ("new row violates row-level security policy"), alors qu'une tentative sur une ligne
-- hors de son périmètre (USING ne passe pas, ex. commande déjà dans un autre état)
-- se traduit par une mise à jour de 0 ligne, sans erreur — c'est le comportement
-- standard de PostgreSQL et il ne faut pas le confondre avec une faille.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice.orders-test@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bob.orders-test@example.com');

insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city, status)
values ('aaaaaaaa-0000-0000-0000-0000000000aa', 'aaaaaaaa-0000-0000-0000-000000000002', 'telephones',
  'Produit test commandes', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  50000, 'bon_etat', 'UY1', 'Yaoundé', 'published');

insert into public.orders (id, idempotency_key, product_id, buyer_id, seller_id, quantity, unit_price, total_amount, status)
values ('aaaaaaaa-0000-0000-0000-0000000000bb', gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-0000000000aa',
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 1, 50000, 50000, 'paid');

set role authenticated;
set request.jwt.uid = 'aaaaaaaa-0000-0000-0000-000000000001'; -- Alice, acheteuse

do $$
begin
  -- Alice ne peut pas s'auto-valider le paiement : USING passe (elle est buyer, status=paid)
  -- mais WITH CHECK échoue (elle ne peut viser que 'cancelled') -> vraie erreur RLS attendue.
  begin
    update public.orders set status = 'confirmed' where id = 'aaaaaaaa-0000-0000-0000-0000000000bb';
    assert false, 'Alice ne doit jamais pouvoir passer sa commande à confirmed elle-même';
  exception when insufficient_privilege then
    null; -- comportement attendu
  end;

  assert (select status from public.orders where id = 'aaaaaaaa-0000-0000-0000-0000000000bb') = 'paid',
    'Le statut ne doit pas avoir changé après la tentative refusée';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Bob, vendeur

do $$
begin
  -- Bob confirme la remise : autorisé (seller + status=paid -> confirmed).
  update public.orders set status = 'confirmed' where id = 'aaaaaaaa-0000-0000-0000-0000000000bb';
  assert (select status from public.orders where id = 'aaaaaaaa-0000-0000-0000-0000000000bb') = 'confirmed',
    'Bob doit pouvoir confirmer une commande payée';

  -- Bob tente ensuite d'annuler : la commande n'est plus "paid", donc hors de son
  -- périmètre d'action -> 0 ligne affectée, silencieusement, sans erreur.
  update public.orders set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-0000000000bb';
  assert (select status from public.orders where id = 'aaaaaaaa-0000-0000-0000-0000000000bb') = 'confirmed',
    'Bob ne doit PAS pouvoir annuler une commande déjà confirmée';
end $$;

reset role;
\echo 'Test de fumée "orders" terminé : aucune ligne "ECHEC" ci-dessus = OK.'
