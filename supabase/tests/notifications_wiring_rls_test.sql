-- =============================================================================
-- Test de fumée — câblage des notifications restantes (0017) : modération
-- produit, formation, achats groupés (dont le cas "pas de notif"), fils de
-- discussion d'espace (portée bornée), rappels d'événement (fenêtre + dédup).
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('55556666-0000-0000-0000-000000000001', 'vendeur.wiring-test@example.com'),
  ('55556666-0000-0000-0000-000000000002', 'etudiant.wiring-test@example.com'),
  ('55556666-0000-0000-0000-000000000003', 'participant1.wiring-test@example.com'),
  ('55556666-0000-0000-0000-000000000004', 'participant2.wiring-test@example.com'),
  ('55556666-0000-0000-0000-000000000005', 'auteur.wiring-test@example.com'),
  ('55556666-0000-0000-0000-000000000006', 'commentateur1.wiring-test@example.com'),
  ('55556666-0000-0000-0000-000000000007', 'commentateur2.wiring-test@example.com');

-- -----------------------------------------------------------------------------
-- Retrait d'annonce par la modération.
-- -----------------------------------------------------------------------------
insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city, status)
values ('55556666-0000-0000-0000-0000000000aa', '55556666-0000-0000-0000-000000000001', 'telephones',
  'Produit test retrait', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  15000, 'bon_etat', 'UY1', 'Yaoundé', 'published');

update public.products set status = 'removed' where id = '55556666-0000-0000-0000-0000000000aa';

do $$
begin
  assert (select count(*) from public.notifications
          where user_id = '55556666-0000-0000-0000-000000000001' and type = 'product_removed') = 1,
    'Le vendeur doit être notifié du retrait de son annonce par la modération';
end $$;

-- -----------------------------------------------------------------------------
-- Formation : inscription gratuite directe, puis formation payante réglée.
-- -----------------------------------------------------------------------------
insert into public.course_categories (slug, name) values ('wiring-test', 'Test câblage');
insert into public.courses (id, category_slug, title, description, level, instructor_id, instructor_name, price, status)
values ('55556666-0000-0000-0000-0000000000bb', 'wiring-test', 'Cours gratuit câblage',
  'Description suffisamment longue pour la contrainte de longueur minimale.', 'debutant',
  '55556666-0000-0000-0000-000000000001', 'Formateur Test', 0, 'published');

set role authenticated;
set request.jwt.uid = '55556666-0000-0000-0000-000000000002';
do $$
begin
  insert into public.course_enrollments (course_id, user_id, unit_price, idempotency_key, status)
  values ('55556666-0000-0000-0000-0000000000bb', auth.uid(), 0, gen_random_uuid(), 'active');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications
          where user_id = '55556666-0000-0000-0000-000000000002' and type = 'enrollment_confirmed') = 1,
    'Une inscription gratuite directement active doit notifier l''étudiant';
end $$;

-- -----------------------------------------------------------------------------
-- Achats groupés : palier atteint -> tous les participants ; annulé -> idem ;
-- expiré sans palier atteint -> AUCUNE notification (choix assumé, remboursement
-- intégral porté par la couche service).
-- -----------------------------------------------------------------------------
insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city, status)
values ('55556666-0000-0000-0000-0000000000cc', '55556666-0000-0000-0000-000000000001', 'telephones',
  'Produit achat groupé test', 'Description suffisamment longue pour la contrainte de longueur minimale.',
  20000, 'bon_etat', 'UY1', 'Yaoundé', 'published');

insert into public.group_purchases (id, product_id, target_participants, ends_at)
values ('55556666-0000-0000-0000-0000000000dd', '55556666-0000-0000-0000-0000000000cc', 3, now() + interval '3 days');

insert into public.group_purchase_participants (group_purchase_id, buyer_id, paid_amount) values
  ('55556666-0000-0000-0000-0000000000dd', '55556666-0000-0000-0000-000000000003', 20000),
  ('55556666-0000-0000-0000-0000000000dd', '55556666-0000-0000-0000-000000000004', 20000);

update public.group_purchases set status = 'reached' where id = '55556666-0000-0000-0000-0000000000dd';

do $$
begin
  assert (select count(*) from public.notifications where type = 'group_purchase_reached') = 2,
    'Les 2 participants doivent être notifiés quand le palier est atteint';
end $$;

delete from public.notifications where type = 'group_purchase_reached';

insert into public.group_purchases (id, product_id, target_participants, ends_at, status)
values ('55556666-0000-0000-0000-0000000000ee', '55556666-0000-0000-0000-0000000000cc', 5, now() + interval '3 days', 'active');
insert into public.group_purchase_participants (group_purchase_id, buyer_id, paid_amount)
values ('55556666-0000-0000-0000-0000000000ee', '55556666-0000-0000-0000-000000000003', 20000);

update public.group_purchases set status = 'expired' where id = '55556666-0000-0000-0000-0000000000ee';

do $$
begin
  assert (select count(*) from public.notifications where type like 'group_purchase%') = 0,
    'Une expiration SANS palier atteint ne doit générer aucune notification générique (choix assumé)';
end $$;

update public.group_purchases set status = 'cancelled' where id = '55556666-0000-0000-0000-0000000000dd';

do $$
begin
  assert (select count(*) from public.notifications where type = 'group_purchase_cancelled') = 2,
    'Une annulation doit notifier tous les participants';
end $$;

-- -----------------------------------------------------------------------------
-- Fils de discussion d'espace : portée bornée aux participants du fil, pas à
-- tout l'espace ; pas de notification sur la simple création du post.
-- -----------------------------------------------------------------------------
delete from public.notifications;
insert into public.space_categories (slug, name) values ('wiring-test', 'Test câblage');
insert into public.spaces (id, kind, category_slug, name, description, privacy, created_by)
values ('55556666-0000-0000-0000-0000000000ff', 'communaute', 'wiring-test', 'Espace test câblage',
  'Description suffisamment longue pour la contrainte de longueur minimale.', 'publique', '55556666-0000-0000-0000-000000000005');

insert into public.space_members (space_id, user_id) values
  ('55556666-0000-0000-0000-0000000000ff', '55556666-0000-0000-0000-000000000006'),
  ('55556666-0000-0000-0000-0000000000ff', '55556666-0000-0000-0000-000000000007');

set role authenticated;
set request.jwt.uid = '55556666-0000-0000-0000-000000000005'; -- Auteur du post
do $$
begin
  insert into public.space_posts (id, space_id, author_id, body)
  values ('55556666-0000-0000-0000-0000000001a1', '55556666-0000-0000-0000-0000000000ff', auth.uid(), 'Un sujet de discussion');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications) = 0,
    'La simple création d''un post ne doit générer aucune notification (fan-out non borné évité)';
end $$;

-- Commentateur 1 commente : l'auteur du post est notifié.
set role authenticated;
set request.jwt.uid = '55556666-0000-0000-0000-000000000006';
do $$
begin
  insert into public.space_post_comments (post_id, author_id, body) values ('55556666-0000-0000-0000-0000000001a1', auth.uid(), 'Premier commentaire');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '55556666-0000-0000-0000-000000000005' and type = 'new_comment') = 1,
    'L''auteur du post doit être notifié du premier commentaire';
  assert (select count(*) from public.notifications where user_id = '55556666-0000-0000-0000-000000000006') = 0,
    'Le commentateur ne doit jamais être notifié de son propre commentaire';
end $$;

-- Commentateur 2 commente à son tour : l'auteur ET le commentateur 1 sont
-- notifiés (participants au fil), mais AUCUN autre membre de l'espace (il n'y
-- en a pas d'autre ici, la portée reste bornée au fil, pas à l'espace entier).
set role authenticated;
set request.jwt.uid = '55556666-0000-0000-0000-000000000007';
do $$
begin
  insert into public.space_post_comments (post_id, author_id, body) values ('55556666-0000-0000-0000-0000000001a1', auth.uid(), 'Deuxième commentaire');
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.notifications where user_id = '55556666-0000-0000-0000-000000000005' and type = 'new_comment') = 1,
    'L''auteur reste à UNE notification non lue (dédupliquée), pas deux';
  assert (select count(*) from public.notifications where user_id = '55556666-0000-0000-0000-000000000006' and type = 'new_comment') = 1,
    'Le premier commentateur doit être notifié du nouveau commentaire de quelqu''un d''autre';
  assert (select count(*) from public.notifications where user_id = '55556666-0000-0000-0000-000000000007') = 0,
    'Le second commentateur ne doit jamais être notifié de son propre commentaire';
end $$;

-- -----------------------------------------------------------------------------
-- Rappel d'événement : fenêtre de 23 à 25h avant le début, déduplication.
-- -----------------------------------------------------------------------------
delete from public.notifications;
insert into public.event_categories (slug, name) values ('wiring-test', 'Test câblage');

insert into public.events (id, created_by, organizer_name, category_slug, name, description, venue, campus, city, starts_at, capacity, price, status)
values
  ('55556666-0000-0000-0000-0000000002a1', '55556666-0000-0000-0000-000000000001', 'Organisateur', 'wiring-test',
   'Événement dans 24h', 'Description suffisamment longue pour la contrainte de longueur minimale.',
   'Amphi', 'UY1', 'Yaoundé', now() + interval '24 hours', 100, 0, 'published'),
  ('55556666-0000-0000-0000-0000000002a2', '55556666-0000-0000-0000-000000000001', 'Organisateur', 'wiring-test',
   'Événement dans 3 jours', 'Description suffisamment longue pour la contrainte de longueur minimale.',
   'Amphi', 'UY1', 'Yaoundé', now() + interval '3 days', 100, 0, 'published');

insert into public.event_tickets (event_id, attendee_id, unit_price, idempotency_key, status) values
  ('55556666-0000-0000-0000-0000000002a1', '55556666-0000-0000-0000-000000000003', 0, gen_random_uuid(), 'valid'),
  ('55556666-0000-0000-0000-0000000002a2', '55556666-0000-0000-0000-000000000003', 0, gen_random_uuid(), 'valid');

delete from public.notifications where type = 'ticket_confirmed'; -- généré par l'achat, hors périmètre de ce test

do $$
declare
  v_count integer;
begin
  v_count := public.send_event_reminders();
  assert v_count = 1, 'Un seul billet doit être concerné (l''événement dans 24h, pas celui dans 3 jours)';

  assert (select count(*) from public.notifications where type = 'event_reminder'
          and target_id = '55556666-0000-0000-0000-0000000002a1') = 1,
    'Le rappel doit cibler l''événement dans la fenêtre 23-25h';
  assert (select count(*) from public.notifications where type = 'event_reminder'
          and target_id = '55556666-0000-0000-0000-0000000002a2') = 0,
    'L''événement dans 3 jours ne doit déclencher aucun rappel';

  -- Un second appel (simule le cron horaire suivant, tant que non lu) ne doit
  -- pas créer de doublon grâce à la déduplication par clé.
  v_count := public.send_event_reminders();
  assert (select count(*) from public.notifications where type = 'event_reminder') = 1,
    'Un second appel de send_event_reminders ne doit pas dupliquer le rappel (déduplication)';
end $$;

do $$
begin
  raise notice 'notifications_wiring_rls_test.sql : tous les tests sont passés.';
end $$;
