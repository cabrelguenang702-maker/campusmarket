-- =============================================================================
-- Test de fumée — paiements. À exécuter en LOCAL uniquement (voir
-- tests/smoke_test.sql pour le principe général et la commande d'exécution).
--
-- Vérifie : isolation acheteur/vendeur/tiers sur payments et payment_attempts,
-- verrouillage total de provider_events, immuabilité de payment_ledger
-- (UPDATE/DELETE révoqués au niveau GRANT), et la machine à états (une
-- transition interdite doit lever une vraie erreur, pas juste être ignorée).
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'alice.pay-test@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob.pay-test@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'carla.pay-test@example.com');

insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city, status)
values ('bbbbbbbb-0000-0000-0000-0000000000aa', 'bbbbbbbb-0000-0000-0000-000000000002', 'telephones',
  'Produit test paiements', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  20000, 'bon_etat', 'UY1', 'Yaoundé', 'published');

insert into public.orders (id, idempotency_key, product_id, buyer_id, seller_id, quantity, unit_price, total_amount, status)
values ('bbbbbbbb-0000-0000-0000-0000000000bb', gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-0000000000aa',
  'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 1, 20000, 20000, 'pending_payment');

-- Écritures faites en tant que service_role, comme le ferait payments-initiate.
insert into public.payments (id, order_id, amount)
values ('bbbbbbbb-0000-0000-0000-0000000000cc', 'bbbbbbbb-0000-0000-0000-0000000000bb', 20000);

insert into public.payment_attempts (id, payment_id, idempotency_key, provider, phone_number, provider_reference)
values ('bbbbbbbb-0000-0000-0000-0000000000dd', 'bbbbbbbb-0000-0000-0000-0000000000cc',
  gen_random_uuid(), 'mtn_momo', '+237670000000', 'CAMPAY-REF-TEST-1');

set role authenticated;
set request.jwt.uid = 'bbbbbbbb-0000-0000-0000-000000000001'; -- Alice, acheteuse

do $$
begin
  assert (select count(*) from public.payments where id = 'bbbbbbbb-0000-0000-0000-0000000000cc') = 1,
    'Alice doit voir le paiement de sa propre commande';
  assert (select count(*) from public.payment_attempts where id = 'bbbbbbbb-0000-0000-0000-0000000000dd') = 1,
    'Alice doit voir sa propre tentative de paiement';
  -- Depuis 0021 : aucun droit client du tout (avant : 0 ligne par RLS). Les deux conviennent.
  begin
    begin
      perform 1 from public.provider_events;
      assert not found, 'provider_events doit être totalement invisible, même à l''acheteur concerné';
    exception when insufficient_privilege then
      null;
    end;
  end;

  -- Contrairement à orders (où une policy update existe et rejette via WITH
  -- CHECK), payments n'a AUCUNE policy update pour authenticated : USING est
  -- donc implicitement faux pour toutes les lignes, et la mise à jour affecte
  -- silencieusement 0 ligne, sans erreur — comportement standard de Postgres.
  update public.payments set status = 'success' where id = 'bbbbbbbb-0000-0000-0000-0000000000cc';
  assert (select status from public.payments where id = 'bbbbbbbb-0000-0000-0000-0000000000cc') = 'pending',
    'Alice ne doit jamais pouvoir modifier le statut de son propre paiement (aucune policy update authenticated)';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'bbbbbbbb-0000-0000-0000-000000000003'; -- Carla, tierce partie

do $$
begin
  assert (select count(*) from public.payments where id = 'bbbbbbbb-0000-0000-0000-0000000000cc') = 0,
    'Carla ne doit voir aucun paiement d''une commande qui ne la concerne pas';
  assert (select count(*) from public.payment_attempts where id = 'bbbbbbbb-0000-0000-0000-0000000000dd') = 0,
    'Carla ne doit voir aucune tentative de paiement d''une commande qui ne la concerne pas';
end $$;

reset role;

-- Le vendeur voit le paiement (statut agrégé) mais pas le détail des tentatives
-- (numéro de téléphone de l'acheteur, référence prestataire).
set role authenticated;
set request.jwt.uid = 'bbbbbbbb-0000-0000-0000-000000000002'; -- Bob, vendeur

do $$
begin
  assert (select count(*) from public.payments where id = 'bbbbbbbb-0000-0000-0000-0000000000cc') = 1,
    'Bob (vendeur) doit voir le paiement de sa commande';
  assert (select count(*) from public.payment_attempts where id = 'bbbbbbbb-0000-0000-0000-0000000000dd') = 0,
    'Bob (vendeur) ne doit PAS voir le détail des tentatives de paiement de l''acheteur';
end $$;

reset role;

-- Machine à états : simulée en tant que service_role (postgres), comme le
-- ferait payments-webhook.
reset role;

do $$
begin
  -- Transition valide : pending -> success.
  update public.payments set status = 'success' where id = 'bbbbbbbb-0000-0000-0000-0000000000cc';
  assert (select status from public.orders where id = 'bbbbbbbb-0000-0000-0000-0000000000bb') = 'paid',
    'Le passage du paiement à success doit faire passer la commande à paid';
  assert (select count(*) from public.payment_ledger where payment_id = 'bbbbbbbb-0000-0000-0000-0000000000cc' and event_type = 'success') = 1,
    'Le journal financier doit contenir la transition vers success';

  -- Transition invalide : success -> pending (retour en arrière interdit).
  begin
    update public.payments set status = 'pending' where id = 'bbbbbbbb-0000-0000-0000-0000000000cc';
    assert false, 'Un paiement success ne doit jamais pouvoir repasser à pending';
  exception when others then
    if sqlerrm not like '%Transition de statut de paiement invalide%' then
      raise;
    end if;
  end;

end $$;

-- payment_ledger est append-only même pour service_role, qui contourne RLS
-- mais pas les GRANTs révoqués explicitement dans la migration.
set role service_role;

do $$
begin
  begin
    delete from public.payment_ledger where payment_id = 'bbbbbbbb-0000-0000-0000-0000000000cc';
    assert false, 'payment_ledger ne doit jamais accepter de DELETE, même pour service_role';
  exception when insufficient_privilege then
    null; -- comportement attendu : privilège DELETE révoqué au niveau GRANT
  end;
end $$;

reset role;

do $$
begin
  raise notice 'payments_rls_test.sql : tous les tests sont passés.';
end $$;
