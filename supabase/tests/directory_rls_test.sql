-- =============================================================================
-- Test de fumée — annuaire (0018) : émoji drapeau, cycle de vie d'une
-- suggestion d'université (soumission, approbation, rejet, garde-fous).
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('77778888-0000-0000-0000-000000000001', 'suggereur.dir-test@example.com'),
  ('77778888-0000-0000-0000-000000000002', 'tiers.dir-test@example.com'),
  ('77778888-0000-0000-0000-000000000003', 'staff.dir-test@example.com');

insert into public.user_roles (user_id, role) values ('77778888-0000-0000-0000-000000000003', 'moderator');

-- -----------------------------------------------------------------------------
-- Émoji drapeau : peuplé par la migration pour les pays du seed.
-- -----------------------------------------------------------------------------
do $$
begin
  assert (select flag_emoji from public.countries where code = 'CM') = '🇨🇲',
    'flag_emoji doit être peuplé pour le Cameroun';
  assert (select flag_emoji from public.countries where code = 'SN') = '🇸🇳',
    'flag_emoji doit être peuplé pour le Sénégal';
end $$;

-- -----------------------------------------------------------------------------
-- Soumission d'une suggestion.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000001';

do $$
begin
  insert into public.university_suggestions (id, suggested_by, name, city, country_code)
  values ('77778888-0000-0000-0000-0000000000aa', auth.uid(), 'Institut Supérieur de Test', 'Kribi', 'CM');
end $$;

reset role;

-- Un tiers ne doit pas voir cette suggestion.
set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000002';

do $$
begin
  assert (select count(*) from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000aa') = 0,
    'Un tiers ne doit pas voir la suggestion d''un autre utilisateur';
end $$;

-- Un utilisateur normal ne doit pas pouvoir la traiter lui-même.
do $$
declare
  v_result jsonb;
begin
  v_result := public.review_university_suggestion('77778888-0000-0000-0000-0000000000aa', true, 'IST');
  assert (v_result ->> 'success')::boolean = false and v_result ->> 'error' = 'not_staff',
    'Un utilisateur non-staff ne doit jamais pouvoir traiter une suggestion';
end $$;

reset role;

do $$
begin
  assert (select status from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000aa') = 'pending',
    'La suggestion doit rester pending après la tentative refusée';
  assert (select count(*) from public.audit_logs where action = 'review_university_suggestion' and result = 'failure') = 1,
    'La tentative refusée doit être journalisée';
end $$;

-- -----------------------------------------------------------------------------
-- Le staff approuve, mais sans sigle : refusé explicitement (pas de troncature
-- automatique hasardeuse).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000003';

do $$
declare
  v_result jsonb;
begin
  v_result := public.review_university_suggestion('77778888-0000-0000-0000-0000000000aa', true, null);
  assert (v_result ->> 'success')::boolean = false and v_result ->> 'error' = 'short_name_required',
    'Approuver sans sigle doit être refusé explicitement';

  -- Avec un sigle : succès, université réellement créée.
  v_result := public.review_university_suggestion('77778888-0000-0000-0000-0000000000aa', true, 'IST');
  assert (v_result ->> 'success')::boolean = true, 'L''approbation avec sigle doit réussir';
end $$;

reset role;

do $$
declare
  v_uni_id uuid;
begin
  assert (select status from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000aa') = 'approved',
    'La suggestion doit passer à approved';
  select resulting_university_id into v_uni_id from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000aa';
  assert v_uni_id is not null, 'resulting_university_id doit être renseigné';
  assert (select name from public.universities where id = v_uni_id) = 'Institut Supérieur de Test',
    'La vraie université créée doit reprendre le nom suggéré';
  assert (select short_name from public.universities where id = v_uni_id) = 'IST',
    'La vraie université créée doit utiliser le sigle donné par le staff, pas une troncature du nom';
  assert (select count(*) from public.notifications
          where user_id = '77778888-0000-0000-0000-000000000001' and type = 'university_suggestion_approved') = 1,
    'Le suggéreur doit être notifié de l''approbation';
end $$;

-- Rejouer l'approbation (déjà traitée) doit échouer proprement, pas dupliquer.
set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000003';
do $$
declare
  v_result jsonb;
begin
  v_result := public.review_university_suggestion('77778888-0000-0000-0000-0000000000aa', true, 'IST');
  assert (v_result ->> 'success')::boolean = false and v_result ->> 'error' = 'not_found_or_already_handled',
    'Retraiter une suggestion déjà résolue doit être refusé';
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.universities where short_name = 'IST') = 1,
    'Rejouer l''approbation ne doit pas créer une seconde université';
end $$;

-- -----------------------------------------------------------------------------
-- Rejet.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000001';
do $$
begin
  insert into public.university_suggestions (id, suggested_by, name, city, country_code)
  values ('77778888-0000-0000-0000-0000000000bb', auth.uid(), 'École Fantaisiste', 'Douala', 'CM');
end $$;
reset role;

set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000003';
do $$
declare
  v_result jsonb;
begin
  v_result := public.review_university_suggestion('77778888-0000-0000-0000-0000000000bb', false, null, 'Doublon présumé');
  assert (v_result ->> 'success')::boolean = true, 'Le rejet lui-même doit réussir';
end $$;
reset role;

do $$
begin
  assert (select status from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000bb') = 'rejected',
    'La suggestion rejetée doit passer à rejected';
  assert (select resulting_university_id from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000bb') is null,
    'Un rejet ne doit jamais créer d''université';
  assert (select count(*) from public.notifications
          where user_id = '77778888-0000-0000-0000-000000000001' and type = 'university_suggestion_rejected') = 1,
    'Le suggéreur doit être notifié du rejet';
end $$;

-- -----------------------------------------------------------------------------
-- Aucune policy UPDATE authenticated sur university_suggestions, même pour le
-- staff : seule review_university_suggestion() peut faire changer le statut.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '77778888-0000-0000-0000-000000000003';
do $$
begin
  update public.university_suggestions set status = 'approved' where id = '77778888-0000-0000-0000-0000000000bb';
  assert (select status from public.university_suggestions where id = '77778888-0000-0000-0000-0000000000bb') = 'rejected',
    'Même le staff ne doit pas pouvoir modifier une suggestion par UPDATE direct (0 ligne affectée attendu)';
end $$;
reset role;

do $$
begin
  raise notice 'directory_rls_test.sql : tous les tests sont passés.';
end $$;
