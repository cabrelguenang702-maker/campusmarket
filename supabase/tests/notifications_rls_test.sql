-- =============================================================================
-- Test de fumée — notifications (0015) : câblage sur les modules existants,
-- déduplication, préférences, sécurité non désactivable, file e-mail, et
-- exploits explicites (fausse notification, modification, lecture croisée).
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('33334444-0000-0000-0000-000000000001', 'alice.notif-test@example.com'),
  ('33334444-0000-0000-0000-000000000002', 'bob.notif-test@example.com'),
  ('33334444-0000-0000-0000-000000000003', 'staff.notif-test@example.com');

insert into public.user_roles (user_id, role) values ('33334444-0000-0000-0000-000000000003', 'moderator');

insert into public.products (id, seller_id, category_slug, name, description, price, quantity, negotiable, condition, campus, city, status)
values ('33334444-0000-0000-0000-0000000000aa', '33334444-0000-0000-0000-000000000002', 'telephones',
  'Produit test notifications', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  30000, 1, true, 'bon_etat', 'UY1', 'Yaoundé', 'published');

-- -----------------------------------------------------------------------------
-- Messagerie : l'autre participant est notifié, pas l'expéditeur ; les messages
-- répétés sont regroupés (déduplication) avec un compteur.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001'; -- Alice

do $$
begin
  insert into public.conversations (id, participant_one, participant_two)
  values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), '33334444-0000-0000-0000-000000000002');
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Salut 1');
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Salut 2');
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Salut 3');

  assert (select count(*) from public.notifications) = 0, 'L''expéditeur ne doit recevoir aucune notification de son propre message';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000002'; -- Bob

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.notifications where type = 'new_message';
  assert v_count = 1, '3 messages d''affilée doivent produire UNE notification regroupée, pas ' || v_count;
  assert (select (payload ->> 'count')::int from public.notifications where type = 'new_message') = 3,
    'Le compteur de la notification regroupée doit valoir 3';
  assert (select payload::text from public.notifications where type = 'new_message') not like '%Salut%',
    'Le contenu du message ne doit jamais apparaître dans le payload (payload minimal)';
end $$;

-- Marquer lu, puis un nouveau message doit créer une NOUVELLE notification.
do $$
begin
  update public.notifications set read_at = now() where type = 'new_message';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
do $$
begin
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Salut 4');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where type = 'new_message' and user_id = '33334444-0000-0000-0000-000000000002') = 2,
    'Après lecture, un nouveau message doit créer une nouvelle notification (la déduplication ne vise que les non lues)';
end $$;

-- -----------------------------------------------------------------------------
-- Blocage : plus aucune notification de message.
-- -----------------------------------------------------------------------------
delete from public.notifications;
insert into public.blocked_users (blocker_id, blocked_id) values ('33334444-0000-0000-0000-000000000002', '33334444-0000-0000-0000-000000000001');
-- (Alice ne peut plus écrire via RLS ; on simule un message déjà en route côté serveur.)
insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', '33334444-0000-0000-0000-000000000001', 'Message bloqué');

do $$
begin
  assert (select count(*) from public.notifications) = 0, 'Un message d''un utilisateur bloqué ne doit pas générer de notification';
end $$;
delete from public.blocked_users;

-- -----------------------------------------------------------------------------
-- Offres : le vendeur est notifié d'une offre ; l'acheteur d'une contre-offre.
-- -----------------------------------------------------------------------------
delete from public.notifications;
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
do $$
begin
  insert into public.offers (id, product_id, buyer_id, seller_id, amount)
  values ('33334444-0000-0000-0000-0000000000cc', '33334444-0000-0000-0000-0000000000aa', auth.uid(), '33334444-0000-0000-0000-000000000002', 20000);
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002' and type = 'offer_received') = 1,
    'Le vendeur doit être notifié d''une nouvelle offre';
end $$;

set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000002';
do $$
begin
  update public.offers set status = 'countered', counter_amount = 25000 where id = '33334444-0000-0000-0000-0000000000cc';
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000001' and type = 'offer_countered') = 1,
    'L''acheteur doit être notifié de la contre-offre';
end $$;

-- L'acceptation crée une commande : le vendeur reçoit "order_received".
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
do $$
begin
  update public.offers set status = 'accepted' where id = '33334444-0000-0000-0000-0000000000cc';
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002' and type = 'offer_accepted') = 1,
    'Le vendeur doit être notifié de l''acceptation de la contre-offre';
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002' and type = 'order_received') = 1,
    'La commande créée par l''acceptation doit notifier le vendeur';
end $$;

-- -----------------------------------------------------------------------------
-- EXPLOITS : fausse notification, lecture croisée, modification de contenu.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001'; -- Alice

do $$
begin
  -- 1. Impossible de s'insérer une fausse notification "système" ou "sécurité".
  begin
    insert into public.notifications (user_id, category, type) values (auth.uid(), 'securite', 'password_changed');
    assert false, 'Un client ne doit jamais pouvoir insérer une notification';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;

  -- 2. Impossible d'appeler create_notification directement (ni pour soi, ni pour autrui).
  begin
    perform public.create_notification('33334444-0000-0000-0000-000000000002', 'systeme', 'faux_message_du_support');
    assert false, 'create_notification ne doit pas être appelable par un client';
  exception when insufficient_privilege then
    null;
  end;

  -- 3. Alice ne voit pas les notifications de Bob.
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002') = 0,
    'Un utilisateur ne doit jamais voir les notifications d''un autre';

  -- 4. Alice ne peut modifier que read_at de SES notifications.
  begin
    update public.notifications set type = 'order_paid', payload = '{"forged":true}'::jsonb
      where user_id = auth.uid();
    assert false, 'Le contenu d''une notification ne doit pas être modifiable par son destinataire';
  exception when others then
    if sqlerrm not like '%read_at%' then raise; end if;
  end;

  -- 5. Alice ne peut pas marquer lue la notification de Bob (0 ligne affectée).
  update public.notifications set read_at = now() where user_id = '33334444-0000-0000-0000-000000000002';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002' and read_at is not null) = 0,
    'Les notifications de Bob ne doivent pas avoir été marquées lues par Alice';
end $$;

-- -----------------------------------------------------------------------------
-- Préférences : désactiver une catégorie coupe l'in-app ; la sécurité ne peut
-- pas être désactivée.
-- -----------------------------------------------------------------------------
delete from public.notifications;
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000002'; -- Bob

do $$
begin
  insert into public.notification_preferences (user_id, category, in_app, email) values (auth.uid(), 'message', false, false);

  begin
    insert into public.notification_preferences (user_id, category, in_app, email) values (auth.uid(), 'securite', false, false);
    assert false, 'Les notifications de sécurité ne doivent pas être désactivables';
  exception when check_violation then
    null;
  end;

  -- Une préférence ne peut pas être écrite pour quelqu'un d'autre.
  begin
    insert into public.notification_preferences (user_id, category, in_app, email)
    values ('33334444-0000-0000-0000-000000000001', 'message', false, false);
    assert false, 'On ne doit pas pouvoir écrire les préférences d''un autre utilisateur';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
do $$
begin
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Encore un');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002') = 0,
    'Catégorie "message" désactivée : aucune notification ne doit être créée';
end $$;

-- -----------------------------------------------------------------------------
-- File e-mail : alimentée seulement si le canal e-mail est activé, une seule
-- fois malgré la déduplication, et verrouillée pour les clients.
-- -----------------------------------------------------------------------------
delete from public.notifications;
update public.notification_preferences set in_app = true, email = true
  where user_id = '33334444-0000-0000-0000-000000000002' and category = 'message';

set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
do $$
begin
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Mail 1');
  insert into public.messages (conversation_id, sender_id, body) values ('33334444-0000-0000-0000-0000000000bb', auth.uid(), 'Mail 2');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notification_email_queue where user_id = '33334444-0000-0000-0000-000000000002') = 1,
    'Deux messages regroupés ne doivent enfiler qu''UN e-mail (pas un par message)';
end $$;

set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000002';
do $$
declare
  v_n bigint := 0;
begin
  begin
    select count(*) into v_n from public.notification_email_queue;
  exception when insufficient_privilege then
    v_n := 0;   -- 0021 : plus aucun droit client sur cette table (avant : 0 ligne par RLS)
  end;
  assert v_n = 0, 'La file e-mail ne doit être lisible par aucun client';
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Sécurité : nouvel appareil -> notification non désactivable + e-mail ;
-- attribution de rôle -> la personne CONCERNÉE est prévenue (pas l'admin).
-- -----------------------------------------------------------------------------
delete from public.notifications;
delete from public.notification_email_queue;

set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
do $$
begin
  perform public.record_login('empreinte-notif-test-001');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000001' and type = 'new_device_detected' and category = 'securite') = 1,
    'Un nouvel appareil doit générer une notification de sécurité';
  assert (select count(*) from public.notification_email_queue where user_id = '33334444-0000-0000-0000-000000000001') = 1,
    'Une notification de sécurité doit toujours être doublée d''un e-mail';
end $$;

insert into public.user_roles (user_id, role) values ('33334444-0000-0000-0000-000000000001', 'admin'); -- rend Alice admin pour le test
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000001';
set request.jwt.claims = '{"aal":"aal2"}';
do $$
declare
  v_result jsonb;
begin
  v_result := public.grant_role('33334444-0000-0000-0000-000000000002', 'support');
  assert (v_result ->> 'success')::boolean, 'grant_role doit réussir pour ce test';
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002' and type = 'role_granted') = 1,
    'La personne dont le rôle change doit être notifiée';
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000001' and type = 'role_granted') = 0,
    'L''admin qui agit ne doit pas être notifié de sa propre action';
end $$;

-- -----------------------------------------------------------------------------
-- Avertissement de modération : l'utilisateur est désormais prévenu (comblait
-- un manque signalé en 0014), sans le motif.
-- -----------------------------------------------------------------------------
delete from public.notifications;
set role authenticated;
set request.jwt.uid = '33334444-0000-0000-0000-000000000003'; -- modérateur (staff)
do $$
begin
  perform public.moderate_warn_user('33334444-0000-0000-0000-000000000002', 'Motif confidentiel de test');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '33334444-0000-0000-0000-000000000002' and type = 'moderation_warning') = 1,
    'Un avertissement de modération doit notifier l''utilisateur concerné';
  assert (select payload::text from public.notifications where type = 'moderation_warning') not like '%confidentiel%',
    'Le motif de l''avertissement ne doit pas fuiter dans la notification';
end $$;

-- -----------------------------------------------------------------------------
-- Robustesse : une notification qui échoue ne doit JAMAIS faire échouer l'action
-- d'origine. On force un échec (utilisateur cible inexistant côté FK) via un
-- appel direct en tant que propriétaire.
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.create_notification('99999999-9999-9999-9999-999999999999', 'systeme', 'test_echec');
  -- Arrivé ici sans exception : l'erreur de clé étrangère a été avalée.
end $$;

do $$
begin
  raise notice 'notifications_rls_test.sql : tous les tests sont passés.';
end $$;
