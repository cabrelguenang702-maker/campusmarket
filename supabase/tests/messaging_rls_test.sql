-- =============================================================================
-- Test de fumée — messagerie (0012) : isolation, unicité de conversation,
-- blocage, immuabilité des messages, anti-flood, policies Storage.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'alice.msg-test@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'bob.msg-test@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'carla.msg-test@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'dan.msg-test@example.com');

insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city, status)
values ('eeeeeeee-0000-0000-0000-0000000000aa', 'eeeeeeee-0000-0000-0000-000000000002', 'telephones',
  'Produit test messagerie', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  10000, 'bon_etat', 'UY1', 'Yaoundé', 'published');

-- -----------------------------------------------------------------------------
-- Création de conversation + provisioning automatique de conversation_states.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000001'; -- Alice

do $$
begin
  insert into public.conversations (id, participant_one, participant_two, product_id)
  values ('eeeeeeee-0000-0000-0000-0000000000bb', auth.uid(), 'eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-0000000000aa');
end $$;

reset role;

-- Vérifié hors RLS (service/postgres) : la policy conversation_states_select_own
-- ne montrerait de toute façon que la ligne d'Alice si on vérifiait sous son
-- propre rôle, ce qui ne prouverait rien sur la ligne de Bob.
do $$
begin
  assert (select count(*) from public.conversation_states where conversation_id = 'eeeeeeee-0000-0000-0000-0000000000bb') = 2,
    'Les deux participants doivent avoir une ligne conversation_states auto-provisionnée';
end $$;

-- Doublon exact (même paire, même produit) : doit échouer sur l'index unique.
\set ON_ERROR_STOP off
insert into public.conversations (participant_one, participant_two, product_id)
values ('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-0000000000aa');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.conversations where product_id = 'eeeeeeee-0000-0000-0000-0000000000aa') = 1,
    'Une seule conversation ne doit exister pour cette paire+produit malgré la tentative en ordre inversé';
end $$;

-- Conversation générale (sans produit) entre Bob et Carla, pour tester le blocage plus bas.
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000002'; -- Bob

do $$
begin
  insert into public.conversations (id, participant_one, participant_two)
  values ('eeeeeeee-0000-0000-0000-0000000000cc', auth.uid(), 'eeeeeeee-0000-0000-0000-000000000003');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Isolation : Dan (tiers) ne voit ni la conversation ni ses messages.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000004'; -- Dan

do $$
begin
  assert (select count(*) from public.conversations where id = 'eeeeeeee-0000-0000-0000-0000000000bb') = 0,
    'Dan ne doit voir aucune conversation dont il n''est pas participant';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Envoi de message, cache last_message_at/preview, immuabilité, statuts.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000001'; -- Alice

do $$
declare
  v_msg_id uuid;
begin
  insert into public.messages (id, conversation_id, sender_id, body)
  values ('eeeeeeee-0000-0000-0000-0000000000dd', 'eeeeeeee-0000-0000-0000-0000000000bb', auth.uid(), 'Bonjour, le produit est-il toujours disponible ?');

  assert (select last_message_preview from public.conversations where id = 'eeeeeeee-0000-0000-0000-0000000000bb') like 'Bonjour%',
    'last_message_preview doit être mis à jour par le trigger après un nouveau message';

  -- Alice (expéditrice) ne doit pas pouvoir marquer son propre message comme lu.
  update public.messages set read_at = now() where id = 'eeeeeeee-0000-0000-0000-0000000000dd';
  assert (select read_at from public.messages where id = 'eeeeeeee-0000-0000-0000-0000000000dd') is null,
    'L''expéditeur ne doit jamais pouvoir marquer son propre message comme lu (0 ligne affectée attendu)';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000002'; -- Bob, destinataire

do $$
begin
  update public.messages set delivered_at = now(), read_at = now() where id = 'eeeeeeee-0000-0000-0000-0000000000dd';
  assert (select read_at from public.messages where id = 'eeeeeeee-0000-0000-0000-0000000000dd') is not null,
    'Le destinataire doit pouvoir marquer un message comme reçu/lu';

  begin
    update public.messages set body = 'Message modifié' where id = 'eeeeeeee-0000-0000-0000-0000000000dd';
    assert false, 'Le contenu d''un message ne doit jamais être modifiable après envoi';
  exception when others then
    if sqlerrm not like '%modifié après envoi%' then raise; end if;
  end;

  begin
    update public.messages set read_at = null where id = 'eeeeeeee-0000-0000-0000-0000000000dd';
    assert false, 'read_at ne doit jamais pouvoir être annulé une fois positionné';
  exception when others then
    if sqlerrm not like '%annulé%' then raise; end if;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Blocage : Bob bloque Carla, Carla ne peut plus lui envoyer de message, même
-- dans une conversation déjà existante.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000002'; -- Bob

do $$
begin
  insert into public.blocked_users (blocker_id, blocked_id) values (auth.uid(), 'eeeeeeee-0000-0000-0000-000000000003');
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000003'; -- Carla, bloquée par Bob

\set ON_ERROR_STOP off
insert into public.messages (conversation_id, sender_id, body)
values ('eeeeeeee-0000-0000-0000-0000000000cc', 'eeeeeeee-0000-0000-0000-000000000003', 'Salut Bob !');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.messages where conversation_id = 'eeeeeeee-0000-0000-0000-0000000000cc') = 0,
    'Carla, bloquée par Bob, ne doit pouvoir envoyer aucun message dans leur conversation existante';
end $$;

-- Un utilisateur bloqué ne peut pas non plus initier une NOUVELLE conversation.
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000003';

\set ON_ERROR_STOP off
insert into public.conversations (participant_one, participant_two)
values ('eeeeeeee-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000002');
\set ON_ERROR_STOP on

reset role;

-- -----------------------------------------------------------------------------
-- Anti-flood : 20 messages passent, le 21e dans la même minute est rejeté.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000001'; -- Alice, déjà 1 message envoyé plus haut

do $$
declare
  i integer;
begin
  for i in 1..19 loop
    insert into public.messages (conversation_id, sender_id, body)
    values ('eeeeeeee-0000-0000-0000-0000000000bb', auth.uid(), 'Message de flood ' || i);
  end loop;
end $$;

\set ON_ERROR_STOP off
insert into public.messages (conversation_id, sender_id, body)
values ('eeeeeeee-0000-0000-0000-0000000000bb', 'eeeeeeee-0000-0000-0000-000000000001', 'Message de trop');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.messages where sender_id = 'eeeeeeee-0000-0000-0000-000000000001') = 20,
    'Exactement 20 messages doivent être passés avant le blocage anti-flood (1 initial + 19 en boucle)';
end $$;

-- -----------------------------------------------------------------------------
-- Storage : bucket privé, policies vérifiant l'appartenance à la conversation.
-- -----------------------------------------------------------------------------
do $$
begin
  assert (select public from storage.buckets where id = 'message-attachments') = false,
    'Le bucket message-attachments doit être privé (public=false)';
end $$;

set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000001'; -- Alice, participante

do $$
begin
  insert into storage.objects (bucket_id, name)
  values ('message-attachments', 'eeeeeeee-0000-0000-0000-0000000000bb/photo-test.jpg');
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'eeeeeeee-0000-0000-0000-000000000004'; -- Dan, tiers

do $$
begin
  assert (select count(*) from storage.objects where name = 'eeeeeeee-0000-0000-0000-0000000000bb/photo-test.jpg') = 0,
    'Dan ne doit pas pouvoir lire une pièce jointe d''une conversation dont il n''est pas participant';
end $$;

\set ON_ERROR_STOP off
insert into storage.objects (bucket_id, name)
values ('message-attachments', 'eeeeeeee-0000-0000-0000-0000000000bb/intrusion.jpg');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from storage.objects where name = 'eeeeeeee-0000-0000-0000-0000000000bb/intrusion.jpg') = 0,
    'Dan ne doit pas pouvoir déposer de pièce jointe dans une conversation dont il n''est pas participant';
end $$;

do $$
begin
  raise notice 'messaging_rls_test.sql : tous les tests sont passés.';
end $$;
