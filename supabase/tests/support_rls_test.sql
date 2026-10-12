-- =============================================================================
-- Test de fumée — support (0019) : FAQ, cycle de vie d'un ticket (ouvert ->
-- en_attente -> ouvert -> ferme), auto-assignation, notification, isolation,
-- immuabilité, pièces jointes, garde-fous contre l'exploit inter-policies.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('99990000-0000-0000-0000-000000000001', 'etudiant.support-test@example.com'),
  ('99990000-0000-0000-0000-000000000002', 'tiers.support-test@example.com'),
  ('99990000-0000-0000-0000-000000000003', 'agent1.support-test@example.com'),
  ('99990000-0000-0000-0000-000000000004', 'agent2.support-test@example.com');

insert into public.user_roles (user_id, role) values
  ('99990000-0000-0000-0000-000000000003', 'support'),
  ('99990000-0000-0000-0000-000000000004', 'support');

insert into public.faq_categories (slug, name) values ('paiements-test', 'Paiements (test)');
insert into public.faq_items (id, category_slug, question, answer, published) values
  ('99990000-0000-0000-0000-0000000000f1', 'paiements-test', 'Question publiée ?', 'Réponse publiée.', true),
  ('99990000-0000-0000-0000-0000000000f2', 'paiements-test', 'Question brouillon ?', 'Réponse brouillon.', false);

-- -----------------------------------------------------------------------------
-- FAQ : visibilité publiée/brouillon.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000001';

do $$
begin
  assert (select count(*) from public.faq_items where id = '99990000-0000-0000-0000-0000000000f1') = 1,
    'Un item publié doit être visible';
  assert (select count(*) from public.faq_items where id = '99990000-0000-0000-0000-0000000000f2') = 0,
    'Un item non publié ne doit pas être visible pour un utilisateur normal';

  begin
    insert into public.faq_items (category_slug, question, answer) values ('paiements-test', 'Intrusion ?', 'Intrusion.');
    assert false, 'Un utilisateur normal ne doit jamais pouvoir écrire dans la FAQ';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Création de ticket : statut et assignation imposés à la création.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000001'; -- Étudiant

\set ON_ERROR_STOP off
insert into public.support_tickets (user_id, subject, category_slug, status)
values (auth.uid(), 'Tentative avec statut forcé', 'paiements-test', 'resolu');
\set ON_ERROR_STOP on

do $$
begin
  insert into public.support_tickets (id, user_id, subject, category_slug)
  values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Paiement débité mais billet non reçu', 'paiements-test');

  assert (select status from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 'ouvert',
    'Un ticket doit être créé ouvert';
end $$;

reset role;

-- Un tiers ne doit rien voir de ce ticket.
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000002';

do $$
begin
  assert (select count(*) from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 0,
    'Un tiers ne doit pas voir le ticket d''un autre utilisateur';

  begin
    insert into public.support_ticket_messages (ticket_id, sender_id, body)
    values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Intrusion');
    assert false, 'Un tiers ne doit jamais pouvoir écrire sur le ticket d''un autre';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Message de l'étudiant : reste ouvert, aperçu mis à jour.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000001';

do $$
begin
  insert into public.support_ticket_messages (ticket_id, sender_id, body)
  values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Référence MP240912.4471');
end $$;

reset role;

do $$
begin
  assert (select status from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 'ouvert',
    'Un message de l''étudiant doit laisser (ou remettre) le ticket ouvert';
  assert (select last_message_preview from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') like 'Référence%',
    'L''aperçu doit refléter le dernier message';
end $$;

-- -----------------------------------------------------------------------------
-- Réponse d'un agent : passe en_attente, auto-assignation, notification.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000003'; -- Agent 1

do $$
begin
  assert (select count(*) from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 1,
    'Un membre du support doit voir tous les tickets';

  insert into public.support_ticket_messages (ticket_id, sender_id, body)
  values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Nous vérifions la transaction, réponse sous 24h.');
end $$;

reset role;

do $$
begin
  assert (select status from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 'en_attente',
    'La réponse d''un agent doit passer le ticket en_attente';
  assert (select assigned_to from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = '99990000-0000-0000-0000-000000000003',
    'Le premier agent qui répond doit être auto-assigné';
  assert (select count(*) from public.notifications
          where user_id = '99990000-0000-0000-0000-000000000001' and type = 'support_reply') = 1,
    'L''étudiant doit être notifié de la réponse du support';
end $$;

-- Un second agent répond : l'assignation ne change PAS (déjà assignée à l'agent 1).
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000004'; -- Agent 2
do $$
begin
  insert into public.support_ticket_messages (ticket_id, sender_id, body)
  values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Je prends le relais si besoin.');
end $$;
reset role;

do $$
begin
  assert (select assigned_to from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = '99990000-0000-0000-0000-000000000003',
    'L''assignation existante ne doit pas être écrasée par un second agent qui répond';
end $$;

-- L'étudiant répond à nouveau : le ticket redevient ouvert (à charge du support).
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000001';
do $$
begin
  insert into public.support_ticket_messages (ticket_id, sender_id, body) values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Toujours rien reçu.');
end $$;
reset role;

do $$
begin
  assert (select status from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 'ouvert',
    'Une réponse de l''étudiant doit repasser le ticket ouvert';
end $$;

-- -----------------------------------------------------------------------------
-- Le staff résout le ticket ; puis le ferme (via update direct, staff_manage).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000003';
do $$
begin
  update public.support_tickets set status = 'resolu' where id = '99990000-0000-0000-0000-0000000000aa';
  assert (select status from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 'resolu',
    'Le staff doit pouvoir marquer un ticket résolu';
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- EXPLOIT : un utilisateur normal ne doit pas pouvoir s'auto-assigner un
-- ticket ou changer son statut vers autre chose que 'ferme' via l'accès que
-- lui donne support_tickets_close_own (même famille de vérification que 0014).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000001';

\set ON_ERROR_STOP off
update public.support_tickets set assigned_to = '99990000-0000-0000-0000-000000000001' where id = '99990000-0000-0000-0000-0000000000aa';
\set ON_ERROR_STOP on

do $$
begin
  assert (select assigned_to from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = '99990000-0000-0000-0000-000000000003',
    'Un utilisateur normal ne doit jamais pouvoir modifier assigned_to (seul is_staff() le peut)';
end $$;

-- L'étudiant ferme lui-même son ticket.
do $$
begin
  update public.support_tickets set status = 'ferme' where id = '99990000-0000-0000-0000-0000000000aa';
  assert (select status from public.support_tickets where id = '99990000-0000-0000-0000-0000000000aa') = 'ferme',
    'L''étudiant doit pouvoir fermer lui-même son propre ticket';
end $$;

-- Un ticket fermé n'accepte plus de nouveaux messages de l'étudiant.
\set ON_ERROR_STOP off
insert into public.support_ticket_messages (ticket_id, sender_id, body)
values ('99990000-0000-0000-0000-0000000000aa', auth.uid(), 'Encore un message');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.support_ticket_messages where ticket_id = '99990000-0000-0000-0000-0000000000aa') = 4,
    'Aucun message ne doit avoir été ajouté après la fermeture (4 messages précédents inchangés)';
end $$;

-- -----------------------------------------------------------------------------
-- Immuabilité : sujet/catégorie/auteur ne changent jamais.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000003'; -- staff, pourtant bloqué aussi
do $$
begin
  begin
    update public.support_tickets set subject = 'Sujet modifié' where id = '99990000-0000-0000-0000-0000000000aa';
    assert false, 'Le sujet d''un ticket ne doit jamais être modifiable, même par le staff';
  exception when others then
    if sqlerrm not like '%ne se modifient pas%' then raise; end if;
  end;
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- Pièces jointes : demandeur et staff seulement.
-- -----------------------------------------------------------------------------
insert into public.support_tickets (id, user_id, subject, category_slug)
values ('99990000-0000-0000-0000-0000000000bb', '99990000-0000-0000-0000-000000000001', 'Ticket pour pièce jointe', 'paiements-test');

set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000001';
do $$
begin
  insert into storage.objects (bucket_id, name) values ('support-attachments', '99990000-0000-0000-0000-0000000000bb/justificatif.pdf');
end $$;
reset role;

set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000002'; -- tiers
do $$
begin
  assert (select count(*) from storage.objects where name = '99990000-0000-0000-0000-0000000000bb/justificatif.pdf') = 0,
    'Un tiers ne doit pas voir la pièce jointe d''un ticket qui ne le concerne pas';
end $$;
reset role;

set role authenticated;
set request.jwt.uid = '99990000-0000-0000-0000-000000000003'; -- staff
do $$
begin
  assert (select count(*) from storage.objects where name = '99990000-0000-0000-0000-0000000000bb/justificatif.pdf') = 1,
    'Le staff doit pouvoir voir la pièce jointe de n''importe quel ticket';
end $$;
reset role;

do $$
begin
  raise notice 'support_rls_test.sql : tous les tests sont passés.';
end $$;
