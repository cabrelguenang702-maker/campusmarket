-- =============================================================================
-- Test — durcissement (0021) : oracles d'autorisation, droits minimaux, fonctions
-- exposées, limites de débit, stock, avatar, stockage, OTP atomique, rétention.
-- LOCAL uniquement (il crée de faux comptes). Un vrai échec = une assertion tombée
-- dans un bloc DO ; les refus attendus passent par t_exec() et n'affichent rien.
--
-- Acteurs (abcdabcd-0000-0000-0000-0000000000NN) :
--   01 admin · 02 modérateur · 03 alice (vendeuse) · 04 bob · 05 carol
-- =============================================================================
\set ON_ERROR_STOP on

\set as_pg    'reset role;'
\set as_admin 'reset role; set role authenticated; set request.jwt.uid = ''abcdabcd-0000-0000-0000-000000000001''; set request.jwt.claims = ''{}'';'
\set as_mod   'reset role; set role authenticated; set request.jwt.uid = ''abcdabcd-0000-0000-0000-000000000002''; set request.jwt.claims = ''{}'';'
\set as_alice 'reset role; set role authenticated; set request.jwt.uid = ''abcdabcd-0000-0000-0000-000000000003''; set request.jwt.claims = ''{}'';'
\set as_bob   'reset role; set role authenticated; set request.jwt.uid = ''abcdabcd-0000-0000-0000-000000000004''; set request.jwt.claims = ''{}'';'
\set as_carol 'reset role; set role authenticated; set request.jwt.uid = ''abcdabcd-0000-0000-0000-000000000005''; set request.jwt.claims = ''{}'';'
\set as_anon  'reset role; set role anon; set request.jwt.uid = ''''; set request.jwt.claims = ''{}'';'
\set as_svc   'reset role; set role service_role; set request.jwt.uid = ''''; set request.jwt.claims = ''{}'';'

create or replace function public.t_exec(p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;
grant execute on function public.t_exec(text) to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('abcdabcd-0000-0000-0000-000000000001', 'admin.hard@example.com'),
  ('abcdabcd-0000-0000-0000-000000000002', 'mod.hard@example.com'),
  ('abcdabcd-0000-0000-0000-000000000003', 'alice.hard@example.com'),
  ('abcdabcd-0000-0000-0000-000000000004', 'bob.hard@example.com'),
  ('abcdabcd-0000-0000-0000-000000000005', 'carol.hard@example.com');
insert into public.user_roles (user_id, role) values
  ('abcdabcd-0000-0000-0000-000000000001', 'admin'),
  ('abcdabcd-0000-0000-0000-000000000002', 'moderator');

-- =============================================================================
-- 1. Posture du catalogue (ce que l'audit a relevé)
-- =============================================================================
do $$
declare
  v_n bigint;
begin
  -- Aucun droit TRUNCATE/REFERENCES/TRIGGER pour un client, nulle part.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  assert v_n = 0, 'TRUNCATE/REFERENCES/TRIGGER ne doivent être accordés à aucun client (' || v_n || ' restants)';

  -- anon : SELECT uniquement, et seulement sur des tables avec une policy anon.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT';
  assert v_n = 0, 'anon ne doit jamais pouvoir écrire (' || v_n || ' droits d''écriture restants)';

  select count(*) into v_n from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee = 'anon' and g.privilege_type = 'SELECT'
     and not exists (
       select 1 from pg_policy p
       where p.polrelid = (quote_ident(g.table_schema) || '.' || quote_ident(g.table_name))::regclass
         and p.polcmd in ('r', '*') and p.polpermissive
         and (0 = any (p.polroles) or (select oid from pg_roles where rolname = 'anon') = any (p.polroles)));
  assert v_n = 0, 'anon n''a SELECT que sur les tables ayant une policy anon (' || v_n || ' en trop)';

  -- Tables de service : aucun droit client du tout.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('provider_events', 'phone_verification_codes', 'notification_email_queue')
     and grantee in ('anon', 'authenticated');
  assert v_n = 0, 'Les tables de service ne doivent avoir aucun droit client';

  -- Journaux : plus d'INSERT client (et pas de UPDATE/DELETE, déjà en 0011).
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('audit_logs', 'security_logs')
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  assert v_n = 0, 'audit_logs/security_logs : aucun droit d''écriture client';

  -- anon n'exécute plus que ce que ses policies évaluent.
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('is_staff', 'is_admin', 'has_role', 'is_space_member', 'is_space_admin', 'is_space_moderator', 't_exec');
  assert v_n = 0, 'anon ne doit exécuter aucune autre fonction publique que les helpers de policy (' || v_n || ')';
  assert has_function_privilege('anon', 'public.is_staff(uuid)', 'execute'),
    'anon doit garder is_staff : product_media_select (anon) l''évalue';

  -- Aucune fonction de trigger exécutable par un client.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute');
  assert v_n = 0, 'Aucune fonction de trigger ne doit être exécutable par authenticated (' || v_n || ')';

  -- Fonctions OTP/rétention : service_role seulement.
  assert not has_function_privilege('authenticated', 'public.verify_phone_otp(uuid,text,text)', 'execute')
     and not has_function_privilege('anon', 'public.verify_phone_otp(uuid,text,text)', 'execute')
     and has_function_privilege('service_role', 'public.verify_phone_otp(uuid,text,text)', 'execute'),
    'verify_phone_otp : service_role uniquement';
  assert not has_function_privilege('authenticated', 'public.create_phone_otp(uuid,text,text,timestamptz)', 'execute'),
    'create_phone_otp : service_role uniquement';
  assert not has_function_privilege('authenticated', 'public.purge_expired_security_data()', 'execute'),
    'purge_expired_security_data : interne';

  -- Toute table de public a la RLS, et toute fonction DEFINER fige son search_path.
  assert not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'Toute table de public doit avoir la RLS activée';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'private') and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
    'Toute fonction SECURITY DEFINER doit figer son search_path';
end $$;

-- =============================================================================
-- 2. Les droits retirés ne cassent pas les parcours légitimes
-- =============================================================================
:as_anon
do $$
begin
  assert public.t_exec('select count(*) from public.countries') = 'ok:1', 'anon lit toujours les pays';
  assert public.t_exec('select count(*) from public.universities') = 'ok:1', 'anon lit toujours les universités';
  assert public.t_exec('select count(*) from public.products') = 'ok:1', 'anon lit toujours la vitrine';
  assert public.t_exec('select count(*) from public.product_media') = 'ok:1',
    'anon lit product_media (la policy évalue is_staff : EXECUTE conservé)';
  assert public.t_exec('select count(*) from public.profile_private') = 'err:42501', 'anon : aucun accès aux données privées';
  assert public.t_exec('select count(*) from public.orders') = 'err:42501', 'anon : aucun accès aux commandes';
  assert public.t_exec('select count(*) from public.audit_logs') = 'err:42501', 'anon : aucun accès à l''audit';
  assert public.t_exec($q$insert into public.reports (reporter_id, target_type, target_id, reason)
                          values (gen_random_uuid(), 'product', gen_random_uuid(), 'anon test')$q$) = 'err:42501',
    'anon ne peut rien insérer';
  assert public.t_exec('truncate public.categories') = 'err:42501', 'anon : TRUNCATE refusé';
end $$;

:as_alice
do $$
begin
  assert public.t_exec('truncate public.audit_logs') = 'err:42501', 'authenticated : TRUNCATE de l''audit refusé';
  assert public.t_exec('truncate public.products') = 'err:42501', 'authenticated : TRUNCATE d''une table métier refusé';
  assert public.t_exec('select count(*) from public.profile_private where id = auth.uid()') = 'ok:1',
    'Alice lit toujours ses propres données privées';
  assert public.t_exec('select count(*) from public.cities_overview') = 'ok:1', 'La vue des villes reste lisible';
end $$;

-- =============================================================================
-- 3. Oracles d'autorisation : un client ne sonde que lui-même
-- =============================================================================
:as_pg
insert into public.space_categories (slug, name) values ('hard-test', 'Hardening (test)');
insert into public.spaces (id, kind, category_slug, name, description, privacy, created_by)
values ('abcdabcd-0000-0000-0000-0000000000a1', 'groupe', 'hard-test',
        'Groupe privé test', 'Description du groupe privé de test.', 'privee', 'abcdabcd-0000-0000-0000-000000000003');
insert into public.blocked_users (blocker_id, blocked_id) values
  ('abcdabcd-0000-0000-0000-000000000003', 'abcdabcd-0000-0000-0000-000000000004');

:as_carol
do $$
begin
  -- Carol, simple étudiante, n'apprend plus rien sur les autres.
  assert not public.is_admin('abcdabcd-0000-0000-0000-000000000001'), 'Carol ne doit pas pouvoir découvrir qui est admin';
  assert not public.is_staff('abcdabcd-0000-0000-0000-000000000002'), 'Carol ne doit pas pouvoir découvrir qui est modérateur';
  assert not public.has_role('admin', 'abcdabcd-0000-0000-0000-000000000001'), 'has_role : même fermeture';
  assert public.staff_rank('abcdabcd-0000-0000-0000-000000000001') = 0, 'staff_rank d''autrui masqué';
  assert not public.has_back_office_access('abcdabcd-0000-0000-0000-000000000001'), 'has_back_office_access d''autrui masqué';
  assert not public.is_space_member('abcdabcd-0000-0000-0000-0000000000a1', 'abcdabcd-0000-0000-0000-000000000003'),
    'Carol ne doit pas pouvoir savoir qui est membre d''un groupe privé';
  assert not public.is_space_admin('abcdabcd-0000-0000-0000-0000000000a1', 'abcdabcd-0000-0000-0000-000000000003'),
    'Idem pour is_space_admin';
  assert not public.is_blocked('abcdabcd-0000-0000-0000-000000000003', 'abcdabcd-0000-0000-0000-000000000004'),
    'Carol ne doit pas pouvoir savoir qu''Alice a bloqué Bob';
  -- Mais elle se sonde toujours elle-même (les policies en dépendent).
  assert not public.is_admin(), 'Carol n''est pas admin';
  assert public.is_active_account(), 'Carol est active';
  assert not public.is_active_account('abcdabcd-0000-0000-0000-000000000003'), 'is_active_account d''autrui masqué';
end $$;

:as_alice
do $$
begin
  assert public.is_blocked('abcdabcd-0000-0000-0000-000000000003', 'abcdabcd-0000-0000-0000-000000000004'),
    'Alice (partie prenante) voit bien son propre blocage';
  assert public.is_space_member('abcdabcd-0000-0000-0000-0000000000a1'), 'Alice, créatrice, est membre de son groupe';
  assert public.is_space_admin('abcdabcd-0000-0000-0000-0000000000a1'), 'Alice, créatrice, administre son groupe';
end $$;

:as_bob
do $$
begin
  assert public.is_blocked('abcdabcd-0000-0000-0000-000000000003', 'abcdabcd-0000-0000-0000-000000000004'),
    'Bob (l''autre partie) voit aussi le blocage qui le concerne';
end $$;

:as_anon
do $$
begin
  assert not public.is_staff('abcdabcd-0000-0000-0000-000000000002'), 'anon ne découvre pas le staff';
  assert public.t_exec($q$select public.is_blocked(gen_random_uuid(), gen_random_uuid())$q$) = 'err:42501',
    'anon : is_blocked non exécutable';
  assert public.t_exec($q$select public.is_active_account(gen_random_uuid())$q$) = 'err:42501',
    'anon : is_active_account non exécutable';
end $$;

-- Le staff, lui, peut inspecter (c'est son rôle) ; un contexte interne aussi.
:as_mod
do $$
begin
  assert public.is_admin('abcdabcd-0000-0000-0000-000000000001'), 'Un membre du staff peut inspecter un autre compte';
  assert public.staff_rank('abcdabcd-0000-0000-0000-000000000001') = 3, 'staff_rank d''un admin visible du staff';
  assert public.is_space_member('abcdabcd-0000-0000-0000-0000000000a1', 'abcdabcd-0000-0000-0000-000000000003'),
    'Le staff voit les membres d''un groupe';
end $$;

:as_pg
do $$
begin
  assert public.is_admin('abcdabcd-0000-0000-0000-000000000001'), 'Contexte interne : réponse complète';
  assert public.is_blocked('abcdabcd-0000-0000-0000-000000000003', 'abcdabcd-0000-0000-0000-000000000004'),
    'Contexte interne : is_blocked complet (triggers de notification)';
end $$;

:as_svc
do $$
begin
  assert public.is_admin('abcdabcd-0000-0000-0000-000000000001'), 'service_role : réponse complète';
end $$;

-- Les fonctions d'admin de 0020 s'appuient sur ces helpers avec l'uid d'un AUTRE compte :
-- elles doivent continuer à fonctionner pour un appelant staff.
:as_admin
do $$
declare
  v jsonb;
begin
  v := public.admin_suspend_user('abcdabcd-0000-0000-0000-000000000005', 'Test de non-régression');
  assert (v ->> 'success')::boolean, 'admin_suspend_user (staff_rank d''autrui) fonctionne toujours : ' || v::text;
  v := public.admin_reactivate_user('abcdabcd-0000-0000-0000-000000000005');
  assert (v ->> 'success')::boolean, 'admin_reactivate_user fonctionne toujours : ' || v::text;
  assert (select count(*) from public.admin_list_support_agents()) >= 1, 'admin_list_support_agents fonctionne toujours';
end $$;

-- =============================================================================
-- 4. Stock et compteurs d'annonce : le vendeur n'écrit plus reserved_quantity
-- =============================================================================
:as_alice
insert into public.products (id, seller_id, category_slug, name, description, price, quantity, condition, campus, city)
values ('abcdabcd-0000-0000-0000-0000000000b1', 'abcdabcd-0000-0000-0000-000000000003', 'telephones',
        'Annonce stock test', 'Description suffisamment longue pour la contrainte de longueur minimale.', 10000, 5, 'bon_etat', 'UY1', 'Yaoundé');

:as_pg
update public.products set status = 'published', reserved_quantity = 2 where id = 'abcdabcd-0000-0000-0000-0000000000b1';

:as_alice
do $$
begin
  -- Exploit : remettre le compteur de réservations à zéro pour revendre le stock retenu.
  assert public.t_exec($q$update public.products set reserved_quantity = 0 where id = 'abcdabcd-0000-0000-0000-0000000000b1'$q$) like 'err:%',
    'Un vendeur ne doit pas pouvoir effacer reserved_quantity (double-vente)';
  assert public.t_exec($q$update public.products set views = 999999 where id = 'abcdabcd-0000-0000-0000-0000000000b1'$q$) like 'err:%',
    'Un vendeur ne doit pas pouvoir falsifier views';
  assert public.t_exec($q$update public.products set quantity = 1 where id = 'abcdabcd-0000-0000-0000-0000000000b1'$q$) like 'err:%',
    'La quantité ne peut pas descendre sous les réservations actives';
  assert public.t_exec($q$update public.products set quantity = 8, price = 9000, status = 'pending_review' where id = 'abcdabcd-0000-0000-0000-0000000000b1'$q$) = 'ok:1',
    'Les modifications légitimes (quantité, prix, remise en modération) passent toujours';
end $$;

:as_pg
do $$
begin
  assert (select reserved_quantity from public.products where id = 'abcdabcd-0000-0000-0000-0000000000b1') = 2,
    'reserved_quantity est resté intact';
end $$;

-- Les triggers de réservation (SECURITY DEFINER) écrivent toujours reserved_quantity.
:as_bob
do $$
begin
  null;
end $$;
:as_pg
update public.products set status = 'published' where id = 'abcdabcd-0000-0000-0000-0000000000b1';
:as_bob
do $$
begin
  assert public.t_exec($q$insert into public.reservations (product_id, buyer_id, quantity)
    values ('abcdabcd-0000-0000-0000-0000000000b1', 'abcdabcd-0000-0000-0000-000000000004', 1)$q$) = 'ok:1',
    'Une réservation légitime fonctionne toujours';
end $$;
:as_pg
do $$
begin
  assert (select reserved_quantity from public.products where id = 'abcdabcd-0000-0000-0000-0000000000b1') = 3,
    'Le trigger de réservation (DEFINER) met toujours à jour reserved_quantity';
end $$;

-- =============================================================================
-- 5. Avatar : https uniquement
-- =============================================================================
:as_alice
do $$
begin
  assert public.t_exec($q$update public.profiles set avatar_url = 'javascript:alert(1)' where id = auth.uid()$q$) = 'err:23514',
    'javascript: refusé';
  assert public.t_exec($q$update public.profiles set avatar_url = 'data:text/html;base64,PHNjcmlwdD4=' where id = auth.uid()$q$) = 'err:23514',
    'data: refusé';
  assert public.t_exec($q$update public.profiles set avatar_url = 'http://tracker.example/pixel.png' where id = auth.uid()$q$) = 'err:23514',
    'http non chiffré refusé';
  assert public.t_exec($q$update public.profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/a.png' where id = auth.uid()$q$) = 'ok:1',
    'https accepté';
  assert public.t_exec($q$update public.profiles set avatar_url = null where id = auth.uid()$q$) = 'ok:1', 'null accepté';
end $$;

-- =============================================================================
-- 6. Limites de débit
-- =============================================================================
:as_pg
insert into public.faq_categories (slug, name) values ('hard-test', 'Hardening (test)');

:as_carol
do $$
declare
  i integer;
  r text;
begin
  -- Signalements : 20 par heure.
  for i in 1..20 loop
    r := public.t_exec(format($q$insert into public.reports (reporter_id, target_type, target_id, reason)
      values (auth.uid(), 'product', gen_random_uuid(), 'Spam %s')$q$, i));
    assert r = 'ok:1', 'Les 20 premiers signalements passent (' || i || ' : ' || r || ')';
  end loop;
  assert public.t_exec($q$insert into public.reports (reporter_id, target_type, target_id, reason)
    values (auth.uid(), 'product', gen_random_uuid(), 'Le 21e')$q$) = 'err:P0429',
    'Le 21e signalement de l''heure est refusé (rate_limited)';

  -- Tickets : 5 par heure.
  for i in 1..5 loop
    assert public.t_exec(format($q$insert into public.support_tickets (user_id, subject, category_slug)
      values (auth.uid(), 'Ticket %s', 'hard-test')$q$, i)) = 'ok:1', 'Les 5 premiers tickets passent';
  end loop;
  assert public.t_exec($q$insert into public.support_tickets (user_id, subject, category_slug)
    values (auth.uid(), 'Ticket de trop', 'hard-test')$q$) = 'err:P0429', 'Le 6e ticket de l''heure est refusé';
end $$;

-- La limite est par utilisateur : Bob n'est pas affecté par Carol.
:as_bob
do $$
begin
  assert public.t_exec($q$insert into public.reports (reporter_id, target_type, target_id, reason)
    values (auth.uid(), 'product', gen_random_uuid(), 'Bob signale')$q$) = 'ok:1', 'La limite de Carol ne touche pas Bob';
end $$;

-- Hors fenêtre : les lignes plus vieilles qu'une heure ne comptent plus.
:as_pg
update public.reports set created_at = now() - interval '2 hours' where reporter_id = 'abcdabcd-0000-0000-0000-000000000005';
:as_carol
do $$
begin
  assert public.t_exec($q$insert into public.reports (reporter_id, target_type, target_id, reason)
    values (auth.uid(), 'product', gen_random_uuid(), 'Nouvelle heure')$q$) = 'ok:1',
    'Après la fenêtre, le quota est de nouveau disponible';
end $$;

-- Les appels internes ne sont jamais limités (migrations, seeds, service_role).
:as_pg
do $$
declare
  i integer;
begin
  for i in 1..25 loop
    insert into public.reports (reporter_id, target_type, target_id, reason)
    values ('abcdabcd-0000-0000-0000-000000000005', 'product', gen_random_uuid(), 'Interne ' || i);
  end loop;
end $$;
:as_svc
do $$
begin
  assert public.t_exec($q$insert into public.reports (reporter_id, target_type, target_id, reason)
    values ('abcdabcd-0000-0000-0000-000000000005', 'product', gen_random_uuid(), 'service_role')$q$) = 'ok:1',
    'service_role n''est pas limité';
end $$;

-- Tous les déclencheurs de limite sont posés.
:as_pg
do $$
declare
  t text;
begin
  foreach t in array array['reports', 'support_tickets', 'university_suggestions', 'products', 'spaces', 'events',
                           'offers', 'orders', 'reservations', 'exchanges', 'course_reviews', 'space_posts',
                           'space_post_comments', 'verification_requests'] loop
    assert exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_rate_limit'),
      'Limite de débit manquante sur ' || t;
  end loop;
end $$;

-- =============================================================================
-- 7. Stockage : images d'annonce
-- =============================================================================
do $$
begin
  assert (select public from storage.buckets where id = 'product-media') = false, 'product-media est privé';
  assert (select file_size_limit from storage.buckets where id = 'product-media') = 10485760, 'Taille limitée à 10 Mo';
  assert (select allowed_mime_types from storage.buckets where id = 'product-media') = array['image/jpeg', 'image/png', 'image/webp'],
    'Types limités aux images';
  assert not exists (select 1 from storage.buckets where file_size_limit is null),
    'Aucun bucket sans limite de taille';
  assert not exists (select 1 from storage.buckets where allowed_mime_types is null),
    'Aucun bucket sans liste de types autorisés';
  assert not exists (select 1 from storage.buckets where public),
    'Aucun bucket public';
end $$;

:as_alice
do $$
begin
  assert public.t_exec($q$insert into storage.objects (bucket_id, name)
    values ('product-media', 'abcdabcd-0000-0000-0000-000000000003/b1/photo1.jpg')$q$) = 'ok:1', 'Alice dépose dans son dossier';
  assert public.t_exec($q$insert into storage.objects (bucket_id, name)
    values ('product-media', 'abcdabcd-0000-0000-0000-000000000004/b1/usurpe.jpg')$q$) = 'err:42501',
    'Alice ne dépose pas dans le dossier de Bob';
  assert public.t_exec($q$insert into public.product_media (product_id, storage_path)
    values ('abcdabcd-0000-0000-0000-0000000000b1', 'abcdabcd-0000-0000-0000-000000000003/b1/photo1.jpg')$q$) = 'ok:1',
    'Alice rattache son fichier à son annonce';
  -- Exploit : "publier" le chemin d'un fichier d'un AUTRE dossier pour le rendre lisible via l'annonce publiée.
  assert public.t_exec($q$insert into public.product_media (product_id, storage_path)
    values ('abcdabcd-0000-0000-0000-0000000000b1', 'abcdabcd-0000-0000-0000-000000000004/secret/prive.jpg')$q$) like 'err:%',
    'Un chemin hors du dossier du vendeur est refusé';
  assert public.t_exec($q$insert into public.product_media (product_id, storage_path)
    values ('abcdabcd-0000-0000-0000-0000000000b1', 'verification-documents/abcdabcd-0000-0000-0000-000000000003/x.jpg')$q$) like 'err:%',
    'Un chemin pointant vers un autre bucket est refusé';
end $$;

:as_pg
insert into storage.objects (bucket_id, name) values ('product-media', 'abcdabcd-0000-0000-0000-000000000004/secret/prive.jpg');
update public.products set status = 'published', deleted_at = null where id = 'abcdabcd-0000-0000-0000-0000000000b1';

:as_anon
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'product-media' and name = 'abcdabcd-0000-0000-0000-000000000003/b1/photo1.jpg') = 1,
    'Un visiteur voit l''image d''une annonce publiée';
  assert (select count(*) from storage.objects where bucket_id = 'product-media' and name = 'abcdabcd-0000-0000-0000-000000000004/secret/prive.jpg') = 0,
    'Un visiteur ne voit pas un fichier non rattaché à une annonce publiée';
end $$;

:as_bob
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'product-media' and name like 'abcdabcd-0000-0000-0000-000000000004/%') = 1,
    'Bob voit son propre dossier';
end $$;

-- Une annonce retirée n'est plus servie.
:as_pg
update public.products set status = 'removed', moderation_reason = 'test' where id = 'abcdabcd-0000-0000-0000-0000000000b1';
:as_anon
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'product-media' and name = 'abcdabcd-0000-0000-0000-000000000003/b1/photo1.jpg') = 0,
    'Une annonce retirée n''est plus servie aux visiteurs';
end $$;
:as_alice
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'product-media' and name = 'abcdabcd-0000-0000-0000-000000000003/b1/photo1.jpg') = 1,
    'Le vendeur voit toujours son propre fichier';
end $$;
:as_mod
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'product-media' and name = 'abcdabcd-0000-0000-0000-000000000003/b1/photo1.jpg') = 1,
    'Le staff voit le fichier d''une annonce retirée (preuve de modération)';
end $$;

-- Un compte suspendu ne téléverse plus.
:as_admin
select public.admin_suspend_user('abcdabcd-0000-0000-0000-000000000003', 'Test stockage');
:as_alice
do $$
begin
  assert public.t_exec($q$insert into storage.objects (bucket_id, name)
    values ('product-media', 'abcdabcd-0000-0000-0000-000000000003/b1/apres-suspension.jpg')$q$) = 'err:42501',
    'Un compte suspendu ne téléverse plus';
end $$;
:as_admin
select public.admin_reactivate_user('abcdabcd-0000-0000-0000-000000000003');

-- =============================================================================
-- 8. OTP téléphone : atomicité et limites
-- =============================================================================
:as_alice
do $$
begin
  assert public.t_exec($q$select public.verify_phone_otp(auth.uid(), '+237670000001', 'x')$q$) = 'err:42501',
    'Un client ne peut pas appeler verify_phone_otp directement';
  assert public.t_exec($q$select public.create_phone_otp(auth.uid(), '+237670000001', 'x', now())$q$) = 'err:42501',
    'Un client ne peut pas appeler create_phone_otp directement';
end $$;

:as_pg
-- Isolation : d'autres tests (auth_hardening) laissent des codes OTP qui compteraient dans les quotas.
delete from public.phone_verification_codes;
delete from public.security_logs where event_type in ('otp_failed', 'otp_verified', 'otp_expired');
:as_svc
do $$
declare
  v jsonb;
  v_hash text := 'hash-correct';
  i integer;
begin
  v := public.create_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000001', v_hash, now() + interval '10 minutes');
  assert v ->> 'status' = 'created', 'Création du code';
  v := public.create_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000001', v_hash, now() + interval '10 minutes');
  v := public.create_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000001', v_hash, now() + interval '10 minutes');
  assert v ->> 'status' = 'created', 'Trois demandes par heure passent';
  v := public.create_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000001', v_hash, now() + interval '10 minutes');
  assert v ->> 'status' = 'too_many_requests', 'La 4e demande de l''heure est refusée (par utilisateur)';

  -- Harcèlement par SMS : d'autres comptes visant LE MÊME numéro.
  v := public.create_phone_otp('abcdabcd-0000-0000-0000-000000000004', '+237670000001', v_hash, now() + interval '10 minutes');
  assert v ->> 'status' = 'too_many_requests', 'Le numéro lui-même est limité, quel que soit le compte demandeur';
  v := public.create_phone_otp('abcdabcd-0000-0000-0000-000000000004', '+237670000002', v_hash, now() + interval '10 minutes');
  assert v ->> 'status' = 'created', 'Un autre numéro n''est pas affecté';
end $$;

-- Essais : compte, plafond, jamais contournables, code correct accepté à temps.
:as_pg
delete from public.phone_verification_codes;
:as_svc
do $$
declare
  v jsonb;
  i integer;
begin
  perform public.create_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000003', 'hash-ok', now() + interval '10 minutes');

  v := public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000003', 'hash-faux');
  assert v ->> 'status' = 'invalid_code' and (v ->> 'attempts_remaining')::int = 4, 'Essai 1 : 4 restants';
  for i in 2..5 loop
    v := public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000003', 'hash-faux');
  end loop;
  assert v ->> 'status' = 'invalid_code' and (v ->> 'attempts_remaining')::int = 0, 'Essai 5 : 0 restant';

  -- Après le plafond, MÊME le bon code est refusé : l'essai bruteforcé ne passe plus.
  v := public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000003', 'hash-ok');
  assert v ->> 'status' = 'too_many_attempts', 'Le bon code est refusé après 5 essais ratés';
  assert (select attempts from public.phone_verification_codes) = 5, 'Les tentatives refusées ne sont pas comptées en plus';
  assert (select count(*) from public.security_logs where event_type = 'otp_failed'
            and user_id = 'abcdabcd-0000-0000-0000-000000000003') = 5, 'Chaque échec est journalisé';
  assert not exists (select 1 from public.profile_private where id = 'abcdabcd-0000-0000-0000-000000000003' and phone_verified),
    'Le numéro n''a pas été validé';
end $$;

:as_pg
delete from public.phone_verification_codes;
:as_svc
do $$
declare
  v jsonb;
begin
  perform public.create_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000004', 'hash-ok', now() + interval '10 minutes');
  v := public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000004', 'hash-faux');
  v := public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000004', 'hash-ok');
  assert v ->> 'status' = 'verified', 'Le bon code est accepté (après un essai raté)';
  assert (select phone_verified and phone = '+237670000004' from public.profile_private where id = 'abcdabcd-0000-0000-0000-000000000003'),
    'profile_private est mis à jour';
  assert public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000003', '+237670000004', 'hash-ok') ->> 'status' = 'no_active_code',
    'Un code est à usage unique';
  assert exists (select 1 from public.security_logs where event_type = 'otp_verified'
                   and user_id = 'abcdabcd-0000-0000-0000-000000000003'), 'Vérification journalisée';
  assert public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000004', '+237670000004', 'hash-ok') ->> 'status' = 'no_active_code',
    'Le code d''un utilisateur ne vaut pas pour un autre';
end $$;

-- Code expiré
:as_pg
insert into public.phone_verification_codes (user_id, phone, code_hash, expires_at)
values ('abcdabcd-0000-0000-0000-000000000004', '+237670000005', 'hash-ok', now() - interval '1 minute');
:as_svc
do $$
begin
  assert public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000004', '+237670000005', 'hash-ok') ->> 'status' = 'code_expired',
    'Un code expiré est refusé';
end $$;

-- Numéro déjà vérifié par un autre compte
:as_pg
delete from public.phone_verification_codes;
insert into public.phone_verification_codes (user_id, phone, code_hash)
values ('abcdabcd-0000-0000-0000-000000000004', '+237670000004', 'hash-ok');
:as_svc
do $$
begin
  assert public.verify_phone_otp('abcdabcd-0000-0000-0000-000000000004', '+237670000004', 'hash-ok') ->> 'status' = 'phone_already_used',
    'Un numéro déjà vérifié ailleurs n''est pas réattribué';
end $$;

-- =============================================================================
-- 9. Rétention
-- =============================================================================
:as_pg
delete from public.phone_verification_codes;
insert into public.phone_verification_codes (user_id, phone, code_hash, created_at) values
  ('abcdabcd-0000-0000-0000-000000000003', '+237670000010', 'a', now() - interval '2 days'),
  ('abcdabcd-0000-0000-0000-000000000003', '+237670000011', 'b', now());
insert into public.provider_events (provider, external_event_id, signature_valid, raw_payload, processing_status, received_at) values
  ('mtn_momo', 'old-processed', true, '{}', 'processed', now() - interval '200 days'),
  ('mtn_momo', 'old-error', true, '{}', 'error', now() - interval '200 days'),
  ('mtn_momo', 'recent-processed', true, '{}', 'processed', now() - interval '1 day');
do $$
declare
  v jsonb;
begin
  v := public.purge_expired_security_data();
  assert (v ->> 'phone_codes')::int = 1, 'Un code de plus d''un jour est purgé';
  assert (select count(*) from public.phone_verification_codes) = 1, 'Le code récent est conservé';
  assert (v ->> 'provider_events')::int = 1, 'Seul l''événement traité depuis plus de 180 jours est purgé';
  assert exists (select 1 from public.provider_events where external_event_id = 'old-error'),
    'Un événement en erreur est conservé pour enquête';
end $$;

-- =============================================================================
-- Nettoyage de l'aide de test
-- =============================================================================
:as_pg
drop function public.t_exec(text);
select 'Test durcissement (0021) terminé : OK si aucun assert n''a échoué ci-dessus.' as resultat;
