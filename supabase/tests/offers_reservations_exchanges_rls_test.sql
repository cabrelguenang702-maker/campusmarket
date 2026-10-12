-- =============================================================================
-- Test de fumée — offres de prix, réservations, troc (0008).
-- À exécuter en LOCAL uniquement, après migrations + seed.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'alice.offers-test@example.com'),
  ('cccccccc-0000-0000-0000-000000000002', 'bob.offers-test@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carla.offers-test@example.com');

insert into public.products (id, seller_id, category_slug, name, description, price, quantity, negotiable, condition, campus, city, status)
values
  ('cccccccc-0000-0000-0000-0000000000aa', 'cccccccc-0000-0000-0000-000000000002', 'telephones',
   'Produit négociable', 'Description suffisamment longue pour la contrainte de longueur minimale.',
   30000, 2, true, 'bon_etat', 'UY1', 'Yaoundé', 'published'),
  ('cccccccc-0000-0000-0000-0000000000bb', 'cccccccc-0000-0000-0000-000000000001', 'telephones',
   'Produit à troquer (Alice)', 'Description suffisamment longue pour la contrainte de longueur minimale.',
   15000, 1, false, 'bon_etat', 'UY1', 'Yaoundé', 'published');

-- -----------------------------------------------------------------------------
-- OFFRES
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001'; -- Alice, acheteuse

do $$
begin
  insert into public.offers (product_id, buyer_id, seller_id, amount)
  values ('cccccccc-0000-0000-0000-0000000000aa', auth.uid(), 'cccccccc-0000-0000-0000-000000000002', 25000);
end $$;

\set ON_ERROR_STOP off
-- Doit échouer : montant >= prix affiché, ce n'est plus une négociation.
insert into public.offers (product_id, buyer_id, seller_id, amount)
values ('cccccccc-0000-0000-0000-0000000000aa', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 35000);
\set ON_ERROR_STOP on

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000003'; -- Carla, tierce partie

do $$
begin
  assert (select count(*) from public.offers where product_id = 'cccccccc-0000-0000-0000-0000000000aa') = 0,
    'Carla ne doit voir aucune offre qui ne la concerne pas';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000002'; -- Bob, vendeur

do $$
declare
  v_offer_id uuid;
begin
  select id into v_offer_id from public.offers where product_id = 'cccccccc-0000-0000-0000-0000000000aa' and amount = 25000;

  -- Bob contre-propose.
  update public.offers set status = 'countered', counter_amount = 28000 where id = v_offer_id;
  assert (select status from public.offers where id = v_offer_id) = 'countered',
    'Bob doit pouvoir contre-proposer une offre pending';

  -- Bob ne peut pas s'auto-accepter la contre-offre qu'il vient de faire.
  update public.offers set status = 'accepted' where id = v_offer_id;
  assert (select status from public.offers where id = v_offer_id) = 'countered',
    'Bob ne doit pas pouvoir accepter lui-même sa propre contre-offre (0 ligne affectée attendu)';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001'; -- Alice accepte la contre-offre

do $$
declare
  v_offer_id uuid;
  v_order_id uuid;
begin
  select id into v_offer_id from public.offers where product_id = 'cccccccc-0000-0000-0000-0000000000aa' and amount = 25000;

  update public.offers set status = 'accepted' where id = v_offer_id;

  select order_id into v_order_id from public.offers where id = v_offer_id;
  assert v_order_id is not null, 'Accepter la contre-offre doit créer une commande liée';
  assert (select unit_price from public.orders where id = v_order_id) = 28000,
    'La commande créée doit reprendre le montant négocié (counter_amount), pas le montant initial';
  assert (select buyer_id from public.orders where id = v_order_id) = 'cccccccc-0000-0000-0000-000000000001',
    'La commande doit être passée au nom de l''acheteur, même si c''est lui qui a cliqué "accepter"';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- RÉSERVATIONS — anti double-réservation sur un stock de 2 unités.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001';

do $$
begin
  insert into public.reservations (id, product_id, buyer_id, quantity)
  values ('cccccccc-0000-0000-0000-0000000000cc', 'cccccccc-0000-0000-0000-0000000000aa', auth.uid(), 2);

  assert (select reserved_quantity from public.products where id = 'cccccccc-0000-0000-0000-0000000000aa') = 2,
    'reserved_quantity doit refléter la réservation active de 2 unités';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000003'; -- Carla tente de réserver le stock déjà pris

\set ON_ERROR_STOP off
insert into public.reservations (product_id, buyer_id, quantity)
values ('cccccccc-0000-0000-0000-0000000000aa', 'cccccccc-0000-0000-0000-000000000003', 1);
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.reservations where product_id = 'cccccccc-0000-0000-0000-0000000000aa' and buyer_id = 'cccccccc-0000-0000-0000-000000000003') = 0,
    'La réservation de Carla doit avoir été rejetée (stock déjà retenu par Alice)';
end $$;

set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001';

do $$
begin
  update public.reservations set status = 'cancelled' where id = 'cccccccc-0000-0000-0000-0000000000cc';
  assert (select reserved_quantity from public.products where id = 'cccccccc-0000-0000-0000-0000000000aa') = 0,
    'Annuler la réservation doit libérer le stock retenu';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- TROC
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001'; -- Alice propose son produit contre celui de Bob

do $$
declare
  v_exchange_id uuid;
begin
  insert into public.exchanges (id, requester_id, requester_product_id, owner_id, owner_product_id, cash_adjustment)
  values ('cccccccc-0000-0000-0000-0000000000dd', auth.uid(), 'cccccccc-0000-0000-0000-0000000000bb',
    'cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-0000000000aa', 5000);
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000002'; -- Bob accepte

do $$
begin
  update public.exchanges set status = 'accepted' where id = 'cccccccc-0000-0000-0000-0000000000dd';
  assert (select status from public.exchanges where id = 'cccccccc-0000-0000-0000-0000000000dd') = 'accepted',
    'Bob (propriétaire) doit pouvoir accepter une proposition de troc pending';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001'; -- Alice confirme la remise

do $$
begin
  update public.exchanges set status = 'completed' where id = 'cccccccc-0000-0000-0000-0000000000dd';
  assert (select status from public.exchanges where id = 'cccccccc-0000-0000-0000-0000000000dd') = 'completed',
    'Alice (demandeuse) doit pouvoir finaliser un troc accepted';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- CORRECTIFS DE LA REVUE : contre-offre sans montant, offre sur produit devenu
-- indisponible, expiration périodique des offres et réservations.
-- -----------------------------------------------------------------------------
insert into public.products (id, seller_id, category_slug, name, description, price, quantity, negotiable, condition, campus, city, status)
values ('cccccccc-0000-0000-0000-0000000000ee', 'cccccccc-0000-0000-0000-000000000002', 'telephones',
  'Deuxième produit négociable', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  20000, 1, true, 'bon_etat', 'UY1', 'Yaoundé', 'published');

set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000001';

do $$
declare
  v_offer_id uuid;
begin
  insert into public.offers (id, product_id, buyer_id, seller_id, amount)
  values ('cccccccc-0000-0000-0000-0000000000ff', 'cccccccc-0000-0000-0000-0000000000ee', auth.uid(), 'cccccccc-0000-0000-0000-000000000002', 15000);
  v_offer_id := 'cccccccc-0000-0000-0000-0000000000ff';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000002'; -- Bob tente une contre-offre sans montant

do $$
begin
  begin
    update public.offers set status = 'countered' where id = 'cccccccc-0000-0000-0000-0000000000ff';
    assert false, 'Une contre-offre sans counter_amount doit être rejetée';
  exception when others then
    if sqlerrm not like '%counter_amount%' then raise; end if;
  end;
end $$;

reset role;

-- Le produit est vendu/retiré AVANT que le vendeur n'accepte l'offre initiale.
update public.products set status = 'archived' where id = 'cccccccc-0000-0000-0000-0000000000ee';

set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000002';

do $$
begin
  begin
    update public.offers set status = 'accepted' where id = 'cccccccc-0000-0000-0000-0000000000ff';
    assert false, 'Accepter une offre sur un produit devenu indisponible doit échouer, pas créer une commande fantôme';
  exception when others then
    if sqlerrm not like '%n''est plus disponible%' then raise; end if;
  end;
end $$;

reset role;

do $$
begin
  assert (select order_id from public.offers where id = 'cccccccc-0000-0000-0000-0000000000ff') is null,
    'Aucune commande ne doit avoir été créée pour une offre acceptée sur un produit indisponible';
end $$;

-- Expiration périodique : on recule artificiellement expires_at dans le passé
-- (comme le ferait le temps qui passe) puis on appelle les fonctions de nettoyage.
update public.offers set expires_at = now() - interval '1 minute'
  where id = 'cccccccc-0000-0000-0000-0000000000ff';

do $$
declare
  v_count integer;
begin
  v_count := public.expire_stale_offers();
  assert v_count >= 1, 'expire_stale_offers doit traiter au moins l''offre expirée du test';
  assert (select status from public.offers where id = 'cccccccc-0000-0000-0000-0000000000ff') = 'expired',
    'L''offre en retard doit passer à expired';
end $$;

update public.reservations set expires_at = now() - interval '1 minute'
  where product_id = 'cccccccc-0000-0000-0000-0000000000aa';

-- (La réservation de ce produit a déjà été annulée plus haut dans ce test ;
-- on en recrée une active pour vérifier l'expiration à son tour.)
insert into public.reservations (id, product_id, buyer_id, quantity, expires_at)
values ('cccccccc-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-0000000000aa',
  'cccccccc-0000-0000-0000-000000000001', 1, now() - interval '1 minute');

do $$
declare
  v_count integer;
begin
  v_count := public.expire_stale_reservations();
  assert v_count >= 1, 'expire_stale_reservations doit traiter au moins la réservation expirée du test';
  assert (select status from public.reservations where id = 'cccccccc-0000-0000-0000-000000000011') = 'expired',
    'La réservation en retard doit passer à expired';
  assert (select reserved_quantity from public.products where id = 'cccccccc-0000-0000-0000-0000000000aa') = 0,
    'Le stock doit être libéré quand la réservation expire';
end $$;

-- -----------------------------------------------------------------------------
-- EXPLOIT (trouvé en auditant 0014) : les WITH CHECK des policies UPDATE sont
-- combinés par OR indépendamment du USING qui a donné l'accès. Un acheteur ne
-- doit JAMAIS pouvoir s'auto-accepter sa propre offre initiale pending.
-- -----------------------------------------------------------------------------
insert into public.products (id, seller_id, category_slug, name, description, price, quantity, negotiable, condition, campus, city, status)
values ('cccccccc-0000-0000-0000-0000000000f1', 'cccccccc-0000-0000-0000-000000000002', 'telephones',
  'Produit test exploit', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  40000, 1, true, 'bon_etat', 'UY1', 'Yaoundé', 'published');

set role authenticated;
set request.jwt.uid = 'cccccccc-0000-0000-0000-000000000003'; -- Carla, acheteuse

do $$
begin
  insert into public.offers (id, product_id, buyer_id, seller_id, amount)
  values ('cccccccc-0000-0000-0000-0000000000f2', 'cccccccc-0000-0000-0000-0000000000f1', auth.uid(), 'cccccccc-0000-0000-0000-000000000002', 10000);

  begin
    update public.offers set status = 'accepted' where id = 'cccccccc-0000-0000-0000-0000000000f2';
    assert false, 'Un acheteur ne doit JAMAIS pouvoir s''auto-accepter sa propre offre initiale';
  exception when others then
    if sqlerrm not like '%Seul le vendeur%' then raise; end if;
  end;
end $$;

reset role;

do $$
begin
  assert (select status from public.offers where id = 'cccccccc-0000-0000-0000-0000000000f2') = 'pending',
    'L''offre doit être restée pending après la tentative d''auto-acceptation';
  assert (select order_id from public.offers where id = 'cccccccc-0000-0000-0000-0000000000f2') is null,
    'Aucune commande ne doit avoir été créée par une auto-acceptation refusée';
end $$;

do $$
begin
  raise notice 'offers_reservations_exchanges_rls_test.sql : tous les tests sont passés.';
end $$;
