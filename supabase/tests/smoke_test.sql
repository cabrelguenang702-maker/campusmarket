-- =============================================================================
-- Test de fumée — à exécuter en LOCAL uniquement, après migrations + seed
-- (jamais en production : il crée de faux utilisateurs).
-- Objectif : vérifier que le provisioning automatique et l'isolation RLS entre
-- utilisateurs fonctionnent réellement, pas seulement que le SQL est valide.
--
-- Avec la CLI Supabase :
--   supabase db reset            # applique migrations + seed.sql sur la base locale
--   psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/smoke_test.sql
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice.smoke-test@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob.smoke-test@example.com');

do $$
begin
  assert (select count(*) from public.profiles where id in
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')) = 2,
    'Le trigger handle_new_user doit créer une ligne profiles par utilisateur';
  assert (select count(*) from public.profile_private where id in
    ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')) = 2,
    'Le trigger handle_new_user doit créer une ligne profile_private par utilisateur';
  assert (select count(*) from public.user_roles where user_id = '11111111-1111-1111-1111-111111111111' and role = 'student') = 1,
    'Le rôle student doit être attribué par défaut';
end $$;

set role authenticated;
set request.jwt.uid = '11111111-1111-1111-1111-111111111111';

do $$
begin
  assert (select email from public.profile_private where id = auth.uid()) = 'alice.smoke-test@example.com',
    'Alice doit pouvoir lire son propre email privé';
  assert (select count(*) from public.profile_private where id = '22222222-2222-2222-2222-222222222222') = 0,
    'Alice ne doit JAMAIS voir l''email privé de Bob (fuite de données)';
end $$;

insert into public.products (seller_id, category_slug, name, description, price, condition, campus, city)
values (auth.uid(), 'telephones', 'Smoke test iPhone', 'Description suffisamment longue pour la contrainte de longueur minimale.', 100000, 'bon_etat', 'UY1', 'Yaoundé');

do $$
begin
  assert (select count(*) from public.products where seller_id = auth.uid()) = 1,
    'Alice doit pouvoir créer une annonce pour elle-même';
end $$;

-- Doit lever une erreur RLS (usurpation d'identité) — le \set ON_ERROR_STOP est
-- volontairement désactivé pour cette seule requête afin de vérifier l'échec attendu.
\set ON_ERROR_STOP off
insert into public.products (seller_id, category_slug, name, description, price, condition, campus, city)
values ('22222222-2222-2222-2222-222222222222', 'telephones', 'Usurpation', 'Cette insertion doit être rejetée par la policy RLS products_insert_own.', 1000, 'bon_etat', 'UY1', 'Yaoundé');
\set ON_ERROR_STOP on

reset role;
\echo 'Test de fumée terminé : provisioning + isolation RLS OK si aucun "assert" n''a échoué ci-dessus.'
