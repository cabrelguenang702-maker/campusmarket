-- =============================================================================
-- Test de fumée — Academy (0013) : contrôle d'accès module (preview vs
-- contenu protégé), inscription gratuite vs payante, progression idempotente,
-- certificat automatique, avis, généralisation des paiements, Storage.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000001', 'prof.academy-test@example.com'),
  ('ffffffff-0000-0000-0000-000000000002', 'etudiant1.academy-test@example.com'),
  ('ffffffff-0000-0000-0000-000000000003', 'etudiant2.academy-test@example.com');

insert into public.course_categories (slug, name) values ('dev-test', 'Développement (test)');

-- -----------------------------------------------------------------------------
-- Un formateur crée un cours GRATUIT à 2 modules (1 aperçu, 1 protégé) et un
-- cours PAYANT à 1 module ; le staff les publie (comme pour products).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000001'; -- Prof

do $$
begin
  insert into public.courses (id, category_slug, title, description, level, instructor_id, instructor_name, price, status)
  values ('ffffffff-0000-0000-0000-0000000000aa', 'dev-test', 'Cours gratuit de test',
    'Description suffisamment longue pour la contrainte de longueur minimale du cours.',
    'debutant', auth.uid(), 'Prof Test', 0, 'pending_review');

  insert into public.courses (id, category_slug, title, description, level, instructor_id, instructor_name, price, status)
  values ('ffffffff-0000-0000-0000-0000000000bb', 'dev-test', 'Cours payant de test',
    'Description suffisamment longue pour la contrainte de longueur minimale du cours.',
    'intermediaire', auth.uid(), 'Prof Test', 8000, 'pending_review');
end $$;

reset role;

-- Passage à 'published' réservé au staff (comme products) : simulé ici via
-- postgres/service (bypass RLS), équivalent à une action staff authentifiée.
update public.courses set status = 'published' where id in ('ffffffff-0000-0000-0000-0000000000aa', 'ffffffff-0000-0000-0000-0000000000bb');

insert into public.course_modules (id, course_id, title, kind, position, duration_minutes, is_preview) values
  ('ffffffff-0000-0000-0000-0000000000c1', 'ffffffff-0000-0000-0000-0000000000aa', 'Module aperçu', 'video', 0, 5, true),
  ('ffffffff-0000-0000-0000-0000000000c2', 'ffffffff-0000-0000-0000-0000000000aa', 'Module protégé', 'article', 1, 10, false),
  ('ffffffff-0000-0000-0000-0000000000c3', 'ffffffff-0000-0000-0000-0000000000bb', 'Module payant', 'video', 0, 15, false);

insert into public.course_module_content (module_id, media_path) values
  ('ffffffff-0000-0000-0000-0000000000c1', 'ffffffff-0000-0000-0000-0000000000aa/ffffffff-0000-0000-0000-0000000000c1/intro.mp4');
insert into public.course_module_content (module_id, article_content) values
  ('ffffffff-0000-0000-0000-0000000000c2', '[{"type":"p","text":"Contenu protégé"}]'::jsonb);
insert into public.course_module_content (module_id, media_path) values
  ('ffffffff-0000-0000-0000-0000000000c3', 'ffffffff-0000-0000-0000-0000000000bb/ffffffff-0000-0000-0000-0000000000c3/cours.mp4');

-- -----------------------------------------------------------------------------
-- Étudiant 1 (pas encore inscrit) : voit les métadonnées des 2 modules du
-- cours gratuit, voit le contenu du module aperçu, PAS celui du module protégé.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000002'; -- Étudiant 1

do $$
begin
  assert (select count(*) from public.course_modules where course_id = 'ffffffff-0000-0000-0000-0000000000aa') = 2,
    'Les métadonnées des 2 modules doivent être visibles (cours publié), inscrit ou non';

  assert (select count(*) from public.course_module_content where module_id = 'ffffffff-0000-0000-0000-0000000000c1') = 1,
    'Le contenu d''un module aperçu doit être visible sans inscription';

  assert (select count(*) from public.course_module_content where module_id = 'ffffffff-0000-0000-0000-0000000000c2') = 0,
    'Le contenu d''un module NON aperçu ne doit pas être visible sans inscription active';
end $$;

-- Inscription au cours GRATUIT : passage direct à 'active' autorisé.
do $$
begin
  insert into public.course_enrollments (course_id, user_id, unit_price, idempotency_key, status)
  values ('ffffffff-0000-0000-0000-0000000000aa', auth.uid(), 0, gen_random_uuid(), 'active');
end $$;

-- Tentative de s'auto-activer directement sur le cours PAYANT : doit échouer.
\set ON_ERROR_STOP off
insert into public.course_enrollments (course_id, user_id, unit_price, idempotency_key, status)
values ('ffffffff-0000-0000-0000-0000000000bb', 'ffffffff-0000-0000-0000-000000000002', 8000, gen_random_uuid(), 'active');
\set ON_ERROR_STOP on

-- Idem avec un unit_price mensongé (prix réel = 8000) : doit échouer.
\set ON_ERROR_STOP off
insert into public.course_enrollments (course_id, user_id, unit_price, idempotency_key, status)
values ('ffffffff-0000-0000-0000-0000000000bb', 'ffffffff-0000-0000-0000-000000000002', 1, gen_random_uuid(), 'pending_payment');
\set ON_ERROR_STOP on

do $$
declare
  v_enrollment_id uuid;
begin
  -- Inscription correcte en pending_payment (prix exact, formation payante).
  insert into public.course_enrollments (id, course_id, user_id, unit_price, idempotency_key, status)
  values ('ffffffff-0000-0000-0000-0000000000dd', 'ffffffff-0000-0000-0000-0000000000bb', auth.uid(), 8000, gen_random_uuid(), 'pending_payment');

  assert (select count(*) from public.course_enrollments where id = 'ffffffff-0000-0000-0000-0000000000dd' and status = 'pending_payment') = 1,
    'Une inscription payante correcte (bon prix, pending_payment) doit réussir';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.course_enrollments where course_id = 'ffffffff-0000-0000-0000-0000000000bb' and status = 'active') = 0,
    'Aucune inscription au cours payant ne doit être active avant paiement';
end $$;

-- Après inscription active au cours gratuit, l'étudiant 1 voit le module protégé.
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000002';

do $$
begin
  assert (select count(*) from public.course_module_content where module_id = 'ffffffff-0000-0000-0000-0000000000c2') = 1,
    'Une fois inscrit et actif, le contenu du module protégé doit devenir visible';
end $$;

reset role;

-- Étudiant 2 (jamais inscrit nulle part) ne doit toujours rien voir de protégé.
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000003'; -- Étudiant 2

do $$
begin
  assert (select count(*) from public.course_module_content where module_id = 'ffffffff-0000-0000-0000-0000000000c2') = 0,
    'Un étudiant non inscrit ne doit jamais voir le contenu d''un module protégé, même si un autre étudiant y a accès';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Progression idempotente + certificat automatique sur le cours gratuit
-- (2 modules : aperçu + protégé).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000002';

do $$
begin
  insert into public.module_progress (user_id, module_id) values (auth.uid(), 'ffffffff-0000-0000-0000-0000000000c1');
  -- Idempotence : un second appel identique ne doit jamais échouer côté client
  -- (ON CONFLICT DO NOTHING, c'est la clé primaire qui rend ça possible).
  insert into public.module_progress (user_id, module_id) values (auth.uid(), 'ffffffff-0000-0000-0000-0000000000c1')
    on conflict (user_id, module_id) do nothing;

  assert (select count(*) from public.module_progress where user_id = auth.uid() and module_id = 'ffffffff-0000-0000-0000-0000000000c1') = 1,
    'Un double marquage identique ne doit jamais créer deux lignes de progression';

  -- Toujours pas de certificat : un seul des deux modules est complété.
  insert into public.module_progress (user_id, module_id) values (auth.uid(), 'ffffffff-0000-0000-0000-0000000000c2');
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.certificates where user_id = 'ffffffff-0000-0000-0000-000000000002' and course_id = 'ffffffff-0000-0000-0000-0000000000aa') = 1,
    'Les 2 modules du cours gratuit sont maintenant complétés : un certificat doit avoir été émis automatiquement';
end $$;

-- Impossible de marquer un module du cours PAYANT (inscription encore pending_payment).
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
insert into public.module_progress (user_id, module_id) values ('ffffffff-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-0000000000c3');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.module_progress where module_id = 'ffffffff-0000-0000-0000-0000000000c3') = 0,
    'Aucune progression ne doit être enregistrable sur une inscription encore pending_payment';
end $$;

-- -----------------------------------------------------------------------------
-- Avis : réservé aux inscrits actifs, cache rating_avg/reviews_count maintenu.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000003'; -- Étudiant 2, jamais inscrit

\set ON_ERROR_STOP off
insert into public.course_reviews (course_id, user_id, rating, body)
values ('ffffffff-0000-0000-0000-0000000000aa', 'ffffffff-0000-0000-0000-000000000003', 5, 'Super cours');
\set ON_ERROR_STOP on

reset role;
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000002'; -- Étudiant 1, inscrit actif

do $$
begin
  insert into public.course_reviews (course_id, user_id, rating, body)
  values ('ffffffff-0000-0000-0000-0000000000aa', auth.uid(), 4, 'Bon cours, clair et progressif.');
end $$;

reset role;

do $$
begin
  assert (select rating_avg from public.courses where id = 'ffffffff-0000-0000-0000-0000000000aa') = 4.0,
    'rating_avg doit refléter le seul avis déposé (4)';
  assert (select reviews_count from public.courses where id = 'ffffffff-0000-0000-0000-0000000000aa') = 1,
    'reviews_count doit valoir 1';
end $$;

-- -----------------------------------------------------------------------------
-- Paiement de la formation payante : simulation service_role (comme le ferait
-- payments-webhook) — succès du paiement doit activer l'inscription.
-- -----------------------------------------------------------------------------
insert into public.payments (id, course_enrollment_id, amount)
values ('ffffffff-0000-0000-0000-0000000000ee', 'ffffffff-0000-0000-0000-0000000000dd', 8000);

insert into public.payment_attempts (payment_id, idempotency_key, provider, phone_number, provider_reference)
values ('ffffffff-0000-0000-0000-0000000000ee', gen_random_uuid(), 'mtn_momo', '+237670000099', 'CAMPAY-ACADEMY-TEST');

do $$
begin
  update public.payments set status = 'success' where id = 'ffffffff-0000-0000-0000-0000000000ee';

  assert (select status from public.course_enrollments where id = 'ffffffff-0000-0000-0000-0000000000dd') = 'active',
    'Un paiement réussi doit activer automatiquement l''inscription à la formation payante';
  assert (select enrolled_count from public.courses where id = 'ffffffff-0000-0000-0000-0000000000bb') = 1,
    'enrolled_count doit être incrémenté à l''activation';
end $$;

-- payments_select_participant doit maintenant montrer ce paiement à l'étudiant
-- via course_enrollment_id (pas order_id, qui est NULL ici).
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000002';

do $$
begin
  assert (select count(*) from public.payments where id = 'ffffffff-0000-0000-0000-0000000000ee') = 1,
    'L''étudiant doit voir son propre paiement de formation via course_enrollment_id, malgré order_id NULL';
end $$;

reset role;

-- Tiers ne doit rien voir de ce paiement.
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000003';

do $$
begin
  assert (select count(*) from public.payments where id = 'ffffffff-0000-0000-0000-0000000000ee') = 0,
    'Un tiers ne doit jamais voir le paiement de formation d''un autre utilisateur';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Storage course-media : même logique d'autorisation que le contenu.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000001'; -- Prof (instructeur), dépose les fichiers

do $$
begin
  insert into storage.objects (bucket_id, name) values
    ('course-media', 'ffffffff-0000-0000-0000-0000000000aa/ffffffff-0000-0000-0000-0000000000c1/intro.mp4'),
    ('course-media', 'ffffffff-0000-0000-0000-0000000000bb/ffffffff-0000-0000-0000-0000000000c3/cours.mp4');
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'ffffffff-0000-0000-0000-000000000003'; -- Étudiant 2, non inscrit nulle part

do $$
begin
  assert (select count(*) from storage.objects
          where name = 'ffffffff-0000-0000-0000-0000000000aa/ffffffff-0000-0000-0000-0000000000c1/intro.mp4') = 1,
    'Le fichier du module aperçu doit être visible sans inscription';
  assert (select count(*) from storage.objects
          where name = 'ffffffff-0000-0000-0000-0000000000bb/ffffffff-0000-0000-0000-0000000000c3/cours.mp4') = 0,
    'Le fichier du module payant ne doit pas être visible sans inscription active';
end $$;

reset role;

do $$
begin
  raise notice 'academy_rls_test.sql : tous les tests sont passés.';
end $$;
