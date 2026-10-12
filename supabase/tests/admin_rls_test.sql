-- =============================================================================
-- Test — back-office admin (0020) : contrôle de rôle, hiérarchie, MFA, effet réel
-- des sanctions, protection des colonnes de modération, signalements, annonces,
-- vérification de compte, invitations, audit non falsifiable.
-- À exécuter en LOCAL uniquement, après migrations + seed (il crée de faux comptes).
--
-- Acteurs (suffixe de l'UUID adadadad-0000-0000-0000-0000000000NN) :
--   01 super_admin · 02 admin · 03 moderator · 04 support · 05 financial_manager
--   06 alice (étudiante, vendeuse) · 07 bob · 08 carol (signaleuse)
--   09/10 comptes créés en cours de test (invitations)
-- Les cas attendus en échec passent par t_exec() : aucune erreur n'est affichée,
-- un vrai échec = une assertion qui tombe dans un bloc DO.
-- =============================================================================
\set ON_ERROR_STOP on

\set as_pg      'reset role;'
\set as_super2  'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000001''; set request.jwt.claims = ''{"aal":"aal2"}'';'
\set as_admin1  'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000002''; set request.jwt.claims = ''{"aal":"aal1"}'';'
\set as_admin2  'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000002''; set request.jwt.claims = ''{"aal":"aal2"}'';'
\set as_mod     'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000003''; set request.jwt.claims = ''{}'';'
\set as_support 'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000004''; set request.jwt.claims = ''{}'';'
\set as_fin     'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000005''; set request.jwt.claims = ''{}'';'
\set as_alice   'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000006''; set request.jwt.claims = ''{}'';'
\set as_bob     'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000007''; set request.jwt.claims = ''{}'';'
\set as_carol   'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000008''; set request.jwt.claims = ''{}'';'
\set as_u9      'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000009''; set request.jwt.claims = ''{}'';'
\set as_u10     'reset role; set role authenticated; set request.jwt.uid = ''adadadad-0000-0000-0000-000000000010''; set request.jwt.claims = ''{}'';'

-- Aide de test : exécute une instruction avec les droits du rôle courant et
-- renvoie 'ok:<lignes affectées>' ou 'err:<sqlstate>' (jamais d'exception).
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
-- Depuis 0021, les nouvelles fonctions ne sont plus exécutables par anon par défaut.
grant execute on function public.t_exec(text) to anon, authenticated;

insert into auth.users (id, email) values
  ('adadadad-0000-0000-0000-000000000001', 'super.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000002', 'admin.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000003', 'mod.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000004', 'support.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000005', 'fin.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000006', 'alice.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000007', 'bob.adm@example.com'),
  ('adadadad-0000-0000-0000-000000000008', 'carol.adm@example.com');

insert into public.user_roles (user_id, role) values
  ('adadadad-0000-0000-0000-000000000001', 'super_admin'),
  ('adadadad-0000-0000-0000-000000000002', 'admin'),
  ('adadadad-0000-0000-0000-000000000003', 'moderator'),
  ('adadadad-0000-0000-0000-000000000004', 'support'),
  ('adadadad-0000-0000-0000-000000000005', 'financial_manager');

insert into public.faq_categories (slug, name) values ('adm-test', 'Admin (test)');

-- =============================================================================
-- 0. CATALOGUE : droits d'exécution et policies restrictives
-- =============================================================================
do $$
declare
  t text;
begin
  -- Les fonctions qui permettaient de FORGER l'audit ou de déclencher le cron à
  -- la demande ne sont plus appelables ni par anon ni par authenticated.
  assert not has_function_privilege('authenticated', 'public.log_audit(text,text,uuid,text,jsonb)', 'execute')
     and not has_function_privilege('anon', 'public.log_audit(text,text,uuid,text,jsonb)', 'execute'),
    'log_audit ne doit plus être appelable par un client (forge de lignes d''audit)';
  assert not has_function_privilege('authenticated', 'public.log_security_event(uuid,text,jsonb,inet,text)', 'execute')
     and not has_function_privilege('anon', 'public.log_security_event(uuid,text,jsonb,inet,text)', 'execute'),
    'log_security_event ne doit plus être appelable par un client';
  assert not has_function_privilege('anon', 'public.expire_stale_offers()', 'execute')
     and not has_function_privilege('authenticated', 'public.expire_stale_tickets()', 'execute')
     and not has_function_privilege('authenticated', 'public.send_event_reminders()', 'execute'),
    'Les tâches de cron ne doivent pas être déclenchables par un client';
  assert not has_function_privilege('anon', 'public.admin_dashboard_stats()', 'execute')
     and has_function_privilege('authenticated', 'public.admin_dashboard_stats()', 'execute'),
    'admin_* : jamais anon, authenticated seulement (le contrôle de rôle est dans la fonction)';
  assert not has_function_privilege('authenticated', 'public.internal_admin_fail(text,text,uuid,text,jsonb)', 'execute'),
    'internal_admin_fail est interne';

  -- Chaque table à contenu utilisateur a sa policy RESTRICTIVE d'insertion.
  foreach t in array array[
    'products', 'orders', 'group_purchase_participants', 'offers', 'reservations',
    'exchanges', 'conversations', 'messages', 'courses', 'course_enrollments',
    'module_progress', 'course_reviews', 'spaces', 'space_members',
    'space_membership_requests', 'space_posts', 'space_post_comments', 'events',
    'event_tickets', 'university_suggestions'
  ] loop
    assert exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = t || '_active_account_insert'
        and permissive = 'RESTRICTIVE' and cmd = 'INSERT'),
      'Policy restrictive d''insertion manquante sur ' || t;
  end loop;

  -- Support et signalements restent ouverts à un compte suspendu (contester).
  assert not exists (select 1 from pg_policies where tablename in ('support_tickets', 'support_ticket_messages', 'reports')
                       and policyname like '%active_account%'),
    'Un compte suspendu doit pouvoir contacter le support';
end $$;

-- =============================================================================
-- 1. Un simple étudiant n'a accès à rien d'admin
-- =============================================================================
:as_alice
do $$
declare
  v jsonb;
begin
  assert public.t_exec('select public.admin_dashboard_stats()') = 'err:42501', 'Étudiant : dashboard refusé';
  assert public.t_exec('select * from public.admin_list_users()') = 'err:42501', 'Étudiant : liste des utilisateurs refusée';
  assert public.t_exec('select * from public.admin_alerts()') = 'err:42501', 'Étudiant : alertes refusées';
  assert public.t_exec('select * from public.admin_audit_feed()') = 'err:42501', 'Étudiant : journal d''audit refusé';
  assert public.t_exec('select * from public.admin_list_reports()') = 'err:42501', 'Étudiant : file de signalements refusée';
  assert public.t_exec('select * from public.admin_list_verifications()') = 'err:42501', 'Étudiant : file de vérifications refusée';

  v := public.admin_suspend_user('adadadad-0000-0000-0000-000000000007', 'tentative');
  assert v ->> 'error' = 'forbidden', 'Étudiant : suspension refusée';
  v := public.admin_ban_user('adadadad-0000-0000-0000-000000000007', 'tentative');
  assert v ->> 'error' = 'forbidden', 'Étudiant : bannissement refusé';
  v := public.admin_verify_user('adadadad-0000-0000-0000-000000000006', true);
  assert v ->> 'error' = 'forbidden', 'Étudiant : ne peut pas se vérifier lui-même via admin_verify_user';
  v := public.admin_set_listing_status(gen_random_uuid(), 'published');
  assert v ->> 'error' = 'forbidden', 'Étudiant : modération d''annonce refusée';
  v := public.admin_handle_report(gen_random_uuid(), 'dismissed');
  assert v ->> 'error' = 'forbidden', 'Étudiant : traitement de signalement refusé';
  v := public.admin_assign_ticket(gen_random_uuid(), null);
  assert v ->> 'error' = 'forbidden', 'Étudiant : assignation de ticket refusée';
  v := public.admin_invite_staff('x@example.com', 'moderator');
  assert v ->> 'error' = 'forbidden', 'Étudiant : invitation staff refusée';
end $$;

-- Les refus sont journalisés (le log survit : pas de RAISE après log_audit).
:as_pg
do $$
begin
  assert (select count(*) from public.audit_logs
          where actor_id = 'adadadad-0000-0000-0000-000000000006' and result = 'failure'
            and action in ('suspend_user', 'ban_user', 'verify_user', 'set_listing_status',
                           'handle_report', 'assign_ticket', 'invite_staff')) = 7,
    'Chaque tentative refusée doit laisser une trace failure dans audit_logs';
end $$;

-- =============================================================================
-- 2. Finance : le volume Mobile Money n'est visible que d'admin/financial_manager
-- =============================================================================
:as_fin
do $$
declare
  v jsonb;
begin
  v := public.admin_dashboard_stats();
  assert jsonb_typeof(v -> 'mobile_money_volume_30d') = 'number', 'financial_manager voit le volume financier';
  assert public.t_exec('select * from public.admin_list_users()') = 'err:42501',
    'financial_manager n''est pas staff : aucune donnée utilisateur';
  assert (select count(*) from public.admin_weekly_activity()) = 7, 'La série hebdomadaire couvre 7 jours';
end $$;

:as_mod
do $$
begin
  assert jsonb_typeof(public.admin_dashboard_stats() -> 'mobile_money_volume_30d') = 'null',
    'Un modérateur ne voit jamais le volume financier';
end $$;

-- =============================================================================
-- 3. Suspension : hiérarchie, effet réel, aucune auto-levée
-- =============================================================================
:as_mod
do $$
declare
  v jsonb;
begin
  assert public.admin_suspend_user('adadadad-0000-0000-0000-000000000006', 'ab') ->> 'error' = 'reason_required',
    'Un motif d''au moins 3 caractères est obligatoire';
  assert public.admin_suspend_user('adadadad-0000-0000-0000-000000000002', 'Motif valable') ->> 'error' = 'insufficient_rank',
    'Un modérateur ne suspend pas un admin';
  assert public.admin_suspend_user('adadadad-0000-0000-0000-000000000004', 'Motif valable') ->> 'error' = 'insufficient_rank',
    'Un modérateur ne suspend pas un autre membre du staff de même rang';
  assert public.admin_suspend_user('adadadad-0000-0000-0000-000000000003', 'Motif valable') ->> 'error' = 'cannot_target_self',
    'On ne se suspend pas soi-même';
  assert public.admin_ban_user('adadadad-0000-0000-0000-000000000007', 'Motif valable') ->> 'error' = 'forbidden',
    'Le bannissement est réservé aux admins';
  assert public.admin_suspend_user(gen_random_uuid(), 'Motif valable') ->> 'error' = 'not_found', 'Utilisateur inconnu';

  v := public.admin_suspend_user('adadadad-0000-0000-0000-000000000006', 'Spam répété (test)');
  assert (v ->> 'success')::boolean, 'Un modérateur peut suspendre un étudiant';
end $$;

:as_alice
do $$
begin
  -- Suspendue : plus aucune création de contenu...
  assert public.t_exec($q$insert into public.products (seller_id, category_slug, name, description, price, condition, campus, city)
    values ('adadadad-0000-0000-0000-000000000006', 'telephones', 'Annonce suspendue', 'Description suffisamment longue pour la contrainte de longueur.', 1000, 'bon_etat', 'UY1', 'Yaoundé')$q$) = 'err:42501',
    'Un compte suspendu ne doit plus pouvoir publier d''annonce';
  -- ... mais le support reste joignable pour contester.
  assert public.t_exec($q$insert into public.support_tickets (user_id, subject, category_slug)
    values ('adadadad-0000-0000-0000-000000000006', 'Contestation de suspension', 'adm-test')$q$) = 'ok:1',
    'Un compte suspendu doit pouvoir ouvrir un ticket de support';
  -- Elle voit sa sanction et son motif, ne peut ni la lever ni la modifier.
  assert (select reason from public.account_restrictions where user_id = auth.uid()) = 'Spam répété (test)',
    'L''intéressé doit pouvoir lire sa propre sanction';
  assert public.t_exec('delete from public.account_restrictions') = 'ok:0', 'Aucune auto-levée de sanction (delete)';
  assert public.t_exec($q$update public.account_restrictions set status = 'suspended', reason = 'ok ok'$q$) = 'ok:0',
    'Aucune modification de sanction côté client (update)';
  assert public.t_exec($q$insert into public.account_restrictions (user_id, status, reason)
    values ('adadadad-0000-0000-0000-000000000007', 'banned', 'faux')$q$) = 'err:42501',
    'Aucune création de sanction côté client (insert)';
end $$;

:as_bob
do $$
begin
  assert (select count(*) from public.account_restrictions where user_id = 'adadadad-0000-0000-0000-000000000006') = 0,
    'Le motif de sanction d''autrui n''est lisible que par lui-même et le staff';
end $$;

:as_pg
do $$
begin
  assert (select count(*) from public.account_restrictions where user_id = 'adadadad-0000-0000-0000-000000000006') = 1,
    'La sanction doit toujours être en place après les tentatives de contournement';
  assert (select count(*) from public.notifications
          where user_id = 'adadadad-0000-0000-0000-000000000006' and type = 'account_suspended') = 1,
    'La personne suspendue est notifiée';
end $$;

-- =============================================================================
-- 4. Bannissement : admin + MFA + rang ; effet sur l'authentification
-- =============================================================================
:as_admin1
do $$
begin
  assert public.admin_ban_user('adadadad-0000-0000-0000-000000000007', 'Fraude confirmée') ->> 'error' = 'mfa_required',
    'Bannir sans session MFA (aal2) est refusé';
end $$;

:as_admin2
do $$
declare
  v jsonb;
begin
  assert public.admin_ban_user('adadadad-0000-0000-0000-000000000001', 'Motif valable') ->> 'error' = 'insufficient_rank',
    'Un admin ne bannit pas un super_admin';
  assert public.admin_ban_user('adadadad-0000-0000-0000-000000000002', 'Motif valable') ->> 'error' = 'cannot_target_self',
    'Un admin ne se bannit pas lui-même';
  v := public.admin_ban_user('adadadad-0000-0000-0000-000000000007', 'Fraude confirmée');
  assert (v ->> 'success')::boolean, 'Admin + MFA peut bannir un étudiant';
  assert public.admin_ban_user('adadadad-0000-0000-0000-000000000007', 'Fraude confirmée') ->> 'error' = 'already_banned',
    'Double bannissement refusé';
  assert public.admin_suspend_user('adadadad-0000-0000-0000-000000000007', 'Motif valable') ->> 'error' = 'already_banned',
    'Un banni ne repasse pas en "suspendu" par la petite porte';
end $$;

:as_pg
do $$
begin
  assert (select banned_until from auth.users where id = 'adadadad-0000-0000-0000-000000000007') = 'infinity',
    'Le bannissement doit poser auth.users.banned_until (refus de connexion)';
end $$;

:as_bob
do $$
begin
  assert public.t_exec($q$insert into public.products (seller_id, category_slug, name, description, price, condition, campus, city)
    values ('adadadad-0000-0000-0000-000000000007', 'telephones', 'Annonce bannie', 'Description suffisamment longue pour la contrainte de longueur.', 1000, 'bon_etat', 'UY1', 'Yaoundé')$q$) = 'err:42501',
    'Un compte banni (même avec un JWT encore valide) ne peut plus écrire';
end $$;

-- Lever les sanctions : suspension = staff ; bannissement = admin + MFA.
:as_mod
do $$
begin
  assert public.admin_reactivate_user('adadadad-0000-0000-0000-000000000007') ->> 'error' = 'forbidden',
    'Un modérateur ne lève pas un bannissement';
  assert public.admin_reactivate_user('adadadad-0000-0000-0000-000000000005') ->> 'error' = 'not_restricted',
    'Réactiver un compte non sanctionné est une erreur explicite';
  assert (public.admin_reactivate_user('adadadad-0000-0000-0000-000000000006') ->> 'success')::boolean,
    'Un modérateur peut lever une suspension';
end $$;

:as_admin1
do $$
begin
  assert public.admin_reactivate_user('adadadad-0000-0000-0000-000000000007') ->> 'error' = 'mfa_required',
    'Lever un bannissement exige aussi le MFA';
end $$;

:as_admin2
do $$
begin
  assert (public.admin_reactivate_user('adadadad-0000-0000-0000-000000000007') ->> 'success')::boolean,
    'Admin + MFA lève un bannissement';
end $$;

:as_pg
do $$
begin
  assert (select banned_until from auth.users where id = 'adadadad-0000-0000-0000-000000000007') is null,
    'La levée du bannissement doit effacer banned_until';
end $$;

-- Un membre du staff suspendu perd ses pouvoirs immédiatement.
:as_admin2
do $$
begin
  assert (public.admin_suspend_user('adadadad-0000-0000-0000-000000000003', 'Compte compromis (test)') ->> 'success')::boolean,
    'Un admin peut suspendre un modérateur';
end $$;

:as_mod
do $$
begin
  assert public.admin_suspend_user('adadadad-0000-0000-0000-000000000006', 'Motif valable') ->> 'error' = 'forbidden',
    'Un modérateur suspendu ne modère plus';
  assert public.t_exec('select public.admin_dashboard_stats()') = 'err:42501',
    'Un modérateur suspendu n''accède plus au tableau de bord';
end $$;

:as_admin1
do $$
begin
  assert (public.admin_reactivate_user('adadadad-0000-0000-0000-000000000003') ->> 'success')::boolean,
    'Le modérateur est réactivé pour la suite des tests';
end $$;

-- =============================================================================
-- 5. Vérification de compte : colonnes de confiance protégées
-- =============================================================================
:as_alice
do $$
begin
  assert public.t_exec($q$update public.profiles set verified = true where id = 'adadadad-0000-0000-0000-000000000006'$q$) like 'err:%',
    'Un utilisateur ne peut pas se vérifier lui-même';
end $$;

:as_mod
do $$
begin
  -- profiles_admin_update (0003) l'autorisait : désormais bloqué par trigger.
  assert public.t_exec($q$update public.profiles set verified = true where id = 'adadadad-0000-0000-0000-000000000006'$q$) like 'err:%',
    'Même le staff ne vérifie plus par UPDATE direct (hors audit)';
  assert public.admin_verify_user('adadadad-0000-0000-0000-000000000006', true) ->> 'error' = 'forbidden',
    'La vérification manuelle est réservée aux admins';
end $$;

:as_admin1
do $$
begin
  assert (public.admin_verify_user('adadadad-0000-0000-0000-000000000006', true) ->> 'success')::boolean, 'Admin : vérification manuelle';
end $$;

:as_pg
do $$
begin
  assert (select verified and verified_at is not null from public.profiles where id = 'adadadad-0000-0000-0000-000000000006'),
    'La vérification manuelle positionne verified et verified_at';
  assert exists (select 1 from public.audit_logs where action = 'verify_user' and result = 'success'
                   and resource_id = 'adadadad-0000-0000-0000-000000000006'), 'La vérification manuelle est tracée';
end $$;

:as_admin1
do $$
begin
  assert (public.admin_verify_user('adadadad-0000-0000-0000-000000000006', false) ->> 'success')::boolean, 'Retrait de vérification';
end $$;

-- Parcours utilisateur : dépôt de document -> examen par le staff.
:as_alice
do $$
begin
  assert public.t_exec($q$insert into public.verification_requests (user_id, document_type, document_paths)
    values ('adadadad-0000-0000-0000-000000000006', 'student_card',
            array['adadadad-0000-0000-0000-000000000006/recto.jpg', 'adadadad-0000-0000-0000-000000000006/verso.jpg'])$q$) = 'ok:1',
    'Dépôt d''une demande de vérification';
  assert public.t_exec($q$insert into public.verification_requests (user_id, document_type, document_paths)
    values ('adadadad-0000-0000-0000-000000000006', 'other_document', array['adadadad-0000-0000-0000-000000000006/autre.pdf'])$q$) = 'err:23505',
    'Une seule demande en cours par utilisateur';
  assert public.t_exec($q$insert into public.verification_requests (user_id, document_type, document_paths)
    values ('adadadad-0000-0000-0000-000000000008', 'student_card', array['adadadad-0000-0000-0000-000000000008/x.jpg'])$q$) = 'err:42501',
    'Pas de demande au nom d''un autre';
  assert public.t_exec($q$insert into storage.objects (bucket_id, name)
    values ('verification-documents', 'adadadad-0000-0000-0000-000000000006/recto.jpg')$q$) = 'ok:1',
    'Dépôt du fichier dans son propre dossier';
  assert public.t_exec($q$insert into storage.objects (bucket_id, name)
    values ('verification-documents', 'adadadad-0000-0000-0000-000000000008/usurpe.jpg')$q$) = 'err:42501',
    'Pas de dépôt dans le dossier d''un autre';
  assert public.admin_review_verification(gen_random_uuid(), true) ->> 'error' = 'forbidden', 'Alice n''examine rien';
end $$;

:as_carol
do $$
begin
  assert public.t_exec($q$insert into public.verification_requests (user_id, document_type, document_paths)
    values ('adadadad-0000-0000-0000-000000000008', 'student_card', array['adadadad-0000-0000-0000-000000000006/recto.jpg'])$q$) = 'err:42501',
    'Une demande ne peut pas référencer le fichier d''un autre';
  assert (select count(*) from storage.objects where bucket_id = 'verification-documents') = 0,
    'Carol ne voit pas les documents d''identité d''Alice';
  assert (select count(*) from public.verification_requests) = 0, 'Carol ne voit pas la demande d''Alice';
end $$;

:as_mod
do $$
declare
  v_id uuid;
  v jsonb;
begin
  assert (select count(*) from storage.objects where bucket_id = 'verification-documents') = 1,
    'Le staff voit les documents à examiner';
  select id into v_id from public.verification_requests where status = 'pending';
  assert (select count(*) from public.admin_list_verifications('pending')) = 1, 'File de vérification : 1 demande';
  assert public.admin_review_verification(v_id, false) ->> 'error' = 'reason_required', 'Un refus exige un motif';
  v := public.admin_review_verification(v_id, false, 'Photo illisible');
  assert (v ->> 'success')::boolean, 'Refus motivé';
  assert public.admin_review_verification(v_id, true) ->> 'error' = 'already_reviewed', 'Une demande traitée est définitive';
end $$;

:as_alice
do $$
begin
  assert (select rejection_reason from public.verification_requests where status = 'rejected') = 'Photo illisible',
    'L''utilisatrice lit le motif du refus';
  assert public.t_exec($q$insert into public.verification_requests (user_id, document_type, document_paths)
    values ('adadadad-0000-0000-0000-000000000006', 'student_card', array['adadadad-0000-0000-0000-000000000006/recto2.jpg'])$q$) = 'ok:1',
    'Nouvelle vérification possible après un refus';
  assert public.t_exec($q$update public.verification_requests set status = 'approved' where user_id = auth.uid()$q$) = 'ok:0',
    'Aucune auto-approbation';
end $$;

:as_mod
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.verification_requests where status = 'pending';
  assert (public.admin_review_verification(v_id, true) ->> 'success')::boolean, 'Approbation';
end $$;

:as_pg
do $$
begin
  assert (select verified from public.profiles where id = 'adadadad-0000-0000-0000-000000000006'),
    'Approuver une demande vérifie le profil';
  assert (select count(*) from public.notifications
          where user_id = 'adadadad-0000-0000-0000-000000000006' and type in ('verification_rejected', 'verification_approved')) = 2,
    'L''utilisatrice est notifiée du refus puis de l''approbation';
end $$;

:as_alice
do $$
begin
  assert public.t_exec($q$insert into public.verification_requests (user_id, document_type, document_paths)
    values ('adadadad-0000-0000-0000-000000000006', 'student_card', array['adadadad-0000-0000-0000-000000000006/encore.jpg'])$q$) = 'err:42501',
    'Un compte déjà vérifié ne redépose pas de document';
end $$;

-- =============================================================================
-- 6. Modération des annonces
-- =============================================================================
:as_alice
insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city)
values ('adadadad-0000-0000-0000-0000000000a1', 'adadadad-0000-0000-0000-000000000006', 'telephones',
        'Annonce admin test', 'Description suffisamment longue pour la contrainte de longueur minimale.', 50000, 'bon_etat', 'UY1', 'Yaoundé');

:as_mod
insert into public.products (id, seller_id, category_slug, name, description, price, condition, campus, city)
values ('adadadad-0000-0000-0000-0000000000a2', 'adadadad-0000-0000-0000-000000000003', 'telephones',
        'Annonce du modérateur', 'Description suffisamment longue pour la contrainte de longueur minimale.', 20000, 'bon_etat', 'UY1', 'Yaoundé');

:as_support
do $$
begin
  assert public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'published') ->> 'error' = 'forbidden',
    'Le support ne modère pas les annonces';
end $$;

:as_mod
do $$
declare
  v jsonb;
begin
  assert public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a2', 'published') ->> 'error' = 'conflict_of_interest',
    'Un modérateur n''approuve pas sa propre annonce';
  assert public.admin_set_listing_status(gen_random_uuid(), 'published') ->> 'error' = 'not_found', 'Annonce inconnue';
  assert public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'sold') ->> 'error' = 'invalid_status',
    'Seuls published / pending_review / removed sont des décisions de modération';
  assert (public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'published') ->> 'success')::boolean, 'Approbation';
end $$;

:as_pg
do $$
begin
  assert (select status from public.products where id = 'adadadad-0000-0000-0000-0000000000a1') = 'published', 'Annonce publiée';
end $$;

:as_mod
do $$
begin
  -- UPDATE direct par un membre du staff : refusé (trigger), il doit passer par la fonction.
  assert public.t_exec($q$update public.products set status = 'removed' where id = 'adadadad-0000-0000-0000-0000000000a1'$q$) like 'err:%',
    'Le staff ne retire plus une annonce par UPDATE direct (hors audit)';
  assert public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'removed') ->> 'error' = 'reason_required',
    'Un retrait exige un motif';
  assert (public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'removed', 'Annonce frauduleuse') ->> 'success')::boolean,
    'Retrait motivé';
end $$;

:as_pg
do $$
begin
  assert (select moderation_reason from public.products where id = 'adadadad-0000-0000-0000-0000000000a1') = 'Annonce frauduleuse',
    'Le motif de retrait est enregistré';
end $$;

:as_alice
do $$
begin
  -- Le vendeur dont l'annonce est retirée ne peut ni la remettre en ligne ni effacer le motif.
  assert public.t_exec($q$update public.products set status = 'pending_review' where id = 'adadadad-0000-0000-0000-0000000000a1'$q$) like 'err:%',
    'Un vendeur ne peut pas sortir son annonce de l''état "retiré"';
  assert public.t_exec($q$update public.products set status = 'draft' where id = 'adadadad-0000-0000-0000-0000000000a1'$q$) like 'err:%',
    'Un vendeur ne peut pas non plus la repasser en brouillon';
  assert public.t_exec($q$update public.products set moderation_reason = null where id = 'adadadad-0000-0000-0000-0000000000a1'$q$) like 'err:%',
    'Un vendeur ne peut pas effacer le motif de modération';
end $$;

:as_mod
do $$
begin
  assert public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'published') ->> 'error' = 'invalid_transition',
    'Une annonce retirée ne repasse jamais directement publiée';
  assert (public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'pending_review') ->> 'success')::boolean,
    'Rétablissement vers la file de modération';
end $$;

:as_pg
do $$
begin
  assert (select moderation_reason from public.products where id = 'adadadad-0000-0000-0000-0000000000a1') is null,
    'Le motif est effacé au rétablissement';
end $$;

:as_admin1
do $$
begin
  assert (public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'published') ->> 'success')::boolean, 'Admin : approbation';
  assert public.admin_set_listing_status('adadadad-0000-0000-0000-0000000000a1', 'pending_review') ->> 'error' = 'reason_required',
    'Mettre en attente une annonce publiée exige un motif';
end $$;

-- =============================================================================
-- 7. Signalements : immuables côté client, traités par fonction
-- =============================================================================
:as_carol
insert into public.reports (id, reporter_id, target_type, target_id, reason) values
  ('adadadad-0000-0000-0000-0000000000b1', 'adadadad-0000-0000-0000-000000000008', 'profile', 'adadadad-0000-0000-0000-000000000006', 'Comportement suspect'),
  ('adadadad-0000-0000-0000-0000000000b2', 'adadadad-0000-0000-0000-000000000008', 'product', 'adadadad-0000-0000-0000-0000000000a1', 'Prix anormal'),
  ('adadadad-0000-0000-0000-0000000000b3', 'adadadad-0000-0000-0000-000000000008', 'message', 'adadadad-0000-0000-0000-0000000000ee', 'Propos déplacés'),
  ('adadadad-0000-0000-0000-0000000000b4', 'adadadad-0000-0000-0000-000000000008', 'product', 'adadadad-0000-0000-0000-0000000000ef', 'Annonce disparue');

do $$
begin
  assert public.t_exec($q$update public.reports set status = 'dismissed' where id = 'adadadad-0000-0000-0000-0000000000b1'$q$) = 'ok:0',
    'Le signaleur ne peut pas clore son propre signalement';
  assert public.admin_handle_report('adadadad-0000-0000-0000-0000000000b1', 'reviewing') ->> 'error' = 'forbidden',
    'Le signaleur ne traite pas';
end $$;

:as_mod
do $$
declare
  v jsonb;
begin
  -- reports_staff_update supprimée : plus aucun UPDATE direct, donc pas de falsification.
  assert public.t_exec($q$update public.reports set reason = 'falsifié', reporter_id = auth.uid() where id = 'adadadad-0000-0000-0000-0000000000b1'$q$) = 'ok:0',
    'Le staff ne peut pas réécrire un signalement';
  assert public.admin_handle_report('adadadad-0000-0000-0000-0000000000b1', 'pending') ->> 'error' = 'invalid_status', 'Statut cible invalide';
  assert (public.admin_handle_report('adadadad-0000-0000-0000-0000000000b1', 'reviewing') ->> 'success')::boolean, 'Prise en charge';
  assert public.admin_handle_report('adadadad-0000-0000-0000-0000000000b1', 'reviewing') ->> 'error' = 'invalid_transition',
    'On ne "prend en charge" pas deux fois';
  assert (public.admin_handle_report('adadadad-0000-0000-0000-0000000000b1', 'actioned', 'Compte averti') ->> 'success')::boolean, 'Clôture';
  assert public.admin_handle_report('adadadad-0000-0000-0000-0000000000b1', 'dismissed') ->> 'error' = 'already_closed',
    'Un signalement clos est définitif';
end $$;

:as_pg
do $$
begin
  assert (select reason from public.reports where id = 'adadadad-0000-0000-0000-0000000000b1') = 'Comportement suspect',
    'Le contenu du signalement est intact';
  assert (select handled_by from public.reports where id = 'adadadad-0000-0000-0000-0000000000b1') = 'adadadad-0000-0000-0000-000000000003'
     and (select resolution_note from public.reports where id = 'adadadad-0000-0000-0000-0000000000b1') = 'Compte averti',
    'Traitant et note de résolution enregistrés';
  -- Ni juge ni partie
  insert into public.reports (id, reporter_id, target_type, target_id, reason) values
    ('adadadad-0000-0000-0000-0000000000b5', 'adadadad-0000-0000-0000-000000000003', 'product', 'adadadad-0000-0000-0000-0000000000a1', 'Signalé par le modérateur'),
    ('adadadad-0000-0000-0000-0000000000b6', 'adadadad-0000-0000-0000-000000000008', 'profile', 'adadadad-0000-0000-0000-000000000003', 'Contre le modérateur');
end $$;

:as_mod
do $$
declare
  r record;
begin
  assert public.admin_handle_report('adadadad-0000-0000-0000-0000000000b5', 'dismissed') ->> 'error' = 'conflict_of_interest',
    'On ne traite pas son propre signalement';
  assert public.admin_handle_report('adadadad-0000-0000-0000-0000000000b6', 'dismissed') ->> 'error' = 'conflict_of_interest',
    'On ne traite pas un signalement dirigé contre soi';

  -- Libellés : le contenu d'un message n'est jamais exposé.
  assert (select target_label from public.admin_list_reports(null, 100, 0) x where x.id = 'adadadad-0000-0000-0000-0000000000b1') = 'alice.adm', 'Libellé profil';
  assert (select target_label from public.admin_list_reports(null, 100, 0) x where x.id = 'adadadad-0000-0000-0000-0000000000b2') = 'Annonce admin test', 'Libellé annonce';
  assert (select target_label from public.admin_list_reports(null, 100, 0) x where x.id = 'adadadad-0000-0000-0000-0000000000b3') = 'Message signalé', 'Libellé message générique';
  assert (select target_label from public.admin_list_reports(null, 100, 0) x where x.id = 'adadadad-0000-0000-0000-0000000000b4') = 'Contenu supprimé', 'Cible disparue';
  assert (select count(*) from public.admin_list_reports('pending', 100, 0) x where x.status <> 'pending') = 0, 'Filtre par statut';
end $$;

:as_admin1
do $$
begin
  assert (public.admin_handle_report('adadadad-0000-0000-0000-0000000000b6', 'dismissed', 'Infondé') ->> 'success')::boolean,
    'Un admin tiers peut traiter le signalement visant le modérateur';
end $$;

-- =============================================================================
-- 8. Liste des utilisateurs : recherche sûre, e-mail masqué selon le rôle
-- =============================================================================
:as_mod
do $$
begin
  assert (select email from public.admin_list_users('alice')) = 'a***@example.com', 'Modérateur : e-mail masqué';
end $$;

:as_support
do $$
begin
  assert (select email from public.admin_list_users('alice')) = 'alice.adm@example.com', 'Support : e-mail complet';
end $$;

:as_admin1
do $$
declare
  v_total bigint;
begin
  assert (select count(*) from public.admin_list_users('%')) = 0, 'Le "%" de la recherche est littéral, pas un joker';
  assert (select count(*) from public.admin_list_users('_')) = 0, 'Le "_" de la recherche est littéral, pas un joker';
  assert (select count(*) from public.admin_list_users('ALICE')) = 1, 'Recherche insensible à la casse';
  assert (select listings_count from public.admin_list_users('alice')) = 1, 'Compteur d''annonces';
  assert (select reports_count from public.admin_list_users('alice')) = 1, 'Compteur de signalements (non rejetés)';
  assert public.t_exec($q$select * from public.admin_list_users(null, 'foo')$q$) = 'err:22023', 'Statut inconnu refusé';
  select max(total_count) into v_total from public.admin_list_users(null, null, 1000, 0);
  assert v_total = (select count(*) from public.profiles), 'total_count = nombre de profils';
  assert (select count(*) from public.admin_list_users(null, null, 3, 0)) = 3, 'Pagination';
end $$;

-- =============================================================================
-- 9. Référentiels géographiques : audit automatique, pas de suppression en usage
-- =============================================================================
:as_alice
do $$
begin
  assert public.t_exec('update public.universities set student_count = 1') = 'ok:0', 'Un étudiant ne modifie pas les universités';
end $$;

:as_mod
do $$
begin
  assert public.t_exec($q$update public.countries set region = 'piraté' where code = 'CM'$q$) = 'ok:0', 'Un modérateur ne modifie pas les pays';
end $$;

:as_pg
update public.profiles set university_id = (select id from public.universities limit 1)
where id = 'adadadad-0000-0000-0000-000000000006';

:as_admin1
do $$
declare
  v_uni uuid := (select university_id from public.profiles where id = 'adadadad-0000-0000-0000-000000000006');
  v_new uuid;
begin
  assert public.t_exec(format('update public.universities set student_count = 777 where id = %L', v_uni)) = 'ok:1', 'Admin modifie une université';
  assert public.t_exec(format('update public.universities set student_count = 777 where id = %L', v_uni)) = 'ok:1', 'Mise à jour sans changement';
  assert public.t_exec(format('delete from public.universities where id = %L', v_uni)) = 'err:P0001',
    'Une université avec des étudiants rattachés ne se supprime pas (on la désactive)';
  assert public.t_exec(format('update public.universities set active = false where id = %L', v_uni)) = 'ok:1', 'Désactivation';

  insert into public.universities (name, short_name, city, country_code)
  values ('Université Test Admin', 'UTA', 'Yaoundé', 'CM') returning id into v_new;
  assert public.t_exec(format('delete from public.universities where id = %L', v_new)) = 'ok:1', 'Une université sans étudiant se supprime';

  assert public.t_exec($q$update public.countries set region = 'Afrique centrale (test)' where code = 'CM'$q$) = 'ok:1', 'Admin modifie un pays';
end $$;

:as_pg
do $$
declare
  v_uni uuid := (select university_id from public.profiles where id = 'adadadad-0000-0000-0000-000000000006');
begin
  assert (select count(*) from public.audit_logs where action = 'universities.update' and resource_id = v_uni) = 2,
    'Deux vraies modifications tracées (valeur, puis désactivation) ; la mise à jour sans changement ne l''est pas';
  assert (select metadata -> 'changes' ? 'student_count' from public.audit_logs
          where action = 'universities.update' and resource_id = v_uni order by created_at limit 1),
    'Le journal garde les colonnes modifiées avec ancienne/nouvelle valeur';
  assert exists (select 1 from public.audit_logs where action = 'universities.insert' and actor_id = 'adadadad-0000-0000-0000-000000000002'),
    'Création tracée';
  assert exists (select 1 from public.audit_logs where action = 'universities.delete' and actor_id = 'adadadad-0000-0000-0000-000000000002'),
    'Suppression tracée';
  assert exists (select 1 from public.audit_logs where action = 'countries.update' and metadata ->> 'key' = 'CM'),
    'Modification de pays tracée (clé ISO dans metadata)';
  assert (select count(*) from public.audit_logs where action like 'universities.%' and actor_id is null) = 0,
    'Le seed n''a pas pollué le journal d''audit';
  assert (select sum(universities_count) from public.cities_overview) = (select count(*) from public.universities where active),
    'cities_overview ne compte que les universités actives';
end $$;

-- =============================================================================
-- 10. Support : assignation contrôlée et historique
-- =============================================================================
:as_alice
do $$
begin
  assert public.t_exec($q$insert into public.support_tickets (id, user_id, subject, category_slug)
    values ('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000006', 'Problème de test', 'adm-test')$q$) = 'ok:1',
    'Création du ticket de test';
end $$;

:as_mod
do $$
begin
  assert public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000004') ->> 'error' = 'forbidden',
    'Un modérateur n''assigne pas les tickets (rôle support ou admin)';
  assert (select array_agg(full_name order by full_name) from public.admin_list_support_agents())
         = array['admin.adm', 'super.adm', 'support.adm'],
    'Seuls support/admin/super_admin actifs sont assignables';
end $$;

:as_support
do $$
begin
  assert public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000006') ->> 'error' = 'not_an_agent',
    'On n''assigne pas un ticket à un simple étudiant';
  assert (public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000004') ->> 'success')::boolean, 'Assignation';
  assert public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000004') ->> 'error' = 'no_change',
    'Réassigner au même agent est signalé';
  assert (public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', null) ->> 'success')::boolean, 'Désassignation';
  assert (public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000001') ->> 'success')::boolean, 'Réassignation';
  assert (select count(*) from public.admin_ticket_history('adadadad-0000-0000-0000-0000000000c1')) = 3, 'Historique : 3 événements';
  assert (select to_agent_name from public.admin_ticket_history('adadadad-0000-0000-0000-0000000000c1') order by at limit 1) = 'support.adm',
    'Historique : noms résolus';
end $$;

:as_alice
do $$
begin
  assert public.t_exec($q$select * from public.admin_ticket_history('adadadad-0000-0000-0000-0000000000c1')$q$) = 'err:42501',
    'L''historique interne n''est pas visible du demandeur';
end $$;

:as_pg
update public.support_tickets set status = 'ferme' where id = 'adadadad-0000-0000-0000-0000000000c1';

:as_support
do $$
begin
  assert public.admin_assign_ticket('adadadad-0000-0000-0000-0000000000c1', 'adadadad-0000-0000-0000-000000000004') ->> 'error' = 'ticket_closed',
    'Un ticket fermé ne s''assigne plus';
end $$;

-- =============================================================================
-- 11. Invitations d'équipe
-- =============================================================================
:as_admin1
do $$
begin
  assert public.admin_invite_staff('newmod.adm@example.com', 'moderator') ->> 'error' = 'mfa_required', 'Inviter exige le MFA';
end $$;

:as_admin2
do $$
begin
  assert public.admin_invite_staff('newmod.adm@example.com', 'student') ->> 'error' = 'invalid_role', 'Rôle student non invitable';
  assert public.admin_invite_staff('newmod.adm@example.com', 'super_admin') ->> 'error' = 'invalid_role', 'super_admin non invitable';
  assert public.admin_invite_staff('pas-un-email', 'moderator') ->> 'error' = 'invalid_email', 'E-mail invalide';
  assert public.admin_invite_staff('newadmin.adm@example.com', 'admin') ->> 'error' = 'requires_super_admin',
    'Seul un super_admin invite un admin';
  assert (public.admin_invite_staff('  NewMod.ADM@Example.com ', 'moderator') ->> 'success')::boolean, 'Invitation (e-mail normalisé)';
  assert public.admin_invite_staff('newmod.adm@example.com', 'moderator') ->> 'error' = 'already_invited', 'Doublon refusé';
end $$;

:as_super2
do $$
begin
  assert (public.admin_invite_staff('newadmin.adm@example.com', 'admin') ->> 'success')::boolean, 'Un super_admin invite un admin';
end $$;

:as_alice
do $$
begin
  assert public.t_exec('select * from public.admin_list_invitations()') = 'err:42501', 'Un étudiant ne liste pas les invitations';
  assert public.t_exec('select * from public.staff_invitations') = 'ok:0', 'RLS : aucune invitation visible d''un étudiant';
end $$;

:as_mod
do $$
begin
  assert public.t_exec('select * from public.admin_list_team()') = 'err:42501', 'La liste d''équipe est réservée aux admins';
end $$;

:as_admin1
do $$
begin
  assert (select count(*) from public.admin_list_invitations() where state = 'pending') = 2, 'Deux invitations en attente';
  assert (select count(*) from public.admin_list_team()) = 5, 'Équipe : 5 membres du staff';
  assert (select roles from public.admin_list_team() where full_name = 'mod.adm') = array['moderator']::public.app_role[], 'Rôles agrégés';
end $$;

-- Acceptation : e-mail CONFIRMÉ et identique.
:as_pg
insert into auth.users (id, email, email_confirmed_at) values
  ('adadadad-0000-0000-0000-000000000009', 'newmod.adm@example.com', null),
  ('adadadad-0000-0000-0000-000000000010', 'newadmin.adm@example.com', now());

:as_pg
create temp table t_ids as
  select (select id from public.staff_invitations where email = 'newmod.adm@example.com') as mod_inv,
         (select id from public.staff_invitations where email = 'newadmin.adm@example.com') as admin_inv;
grant select on t_ids to authenticated;

:as_u9
do $$
begin
  assert public.accept_staff_invitation((select mod_inv from t_ids)) ->> 'error' = 'email_mismatch',
    'E-mail non confirmé : l''invitation ne s''accepte pas (sinon quiconque s''inscrit avec l''adresse hérite du rôle)';
end $$;

:as_pg
update auth.users set email_confirmed_at = now() where id = 'adadadad-0000-0000-0000-000000000009';

:as_carol
do $$
begin
  assert public.accept_staff_invitation((select admin_inv from t_ids)) ->> 'error' = 'email_mismatch',
    'Une invitation adressée à quelqu''un d''autre ne s''accepte pas';
end $$;

:as_u9
do $$
begin
  assert (public.accept_staff_invitation((select mod_inv from t_ids)) ->> 'success')::boolean, 'Acceptation avec e-mail confirmé';
  assert public.accept_staff_invitation((select mod_inv from t_ids)) ->> 'error' = 'not_pending_or_expired', 'Usage unique';
end $$;

:as_pg
do $$
begin
  assert exists (select 1 from public.user_roles where user_id = 'adadadad-0000-0000-0000-000000000009' and role = 'moderator'),
    'Le rôle est attribué à l''acceptation';
end $$;

-- Invitation expirée
:as_pg
update public.staff_invitations set expires_at = now() - interval '1 day' where email = 'newadmin.adm@example.com';

:as_u10
do $$
begin
  assert public.accept_staff_invitation((select admin_inv from t_ids)) ->> 'error' = 'not_pending_or_expired', 'Invitation expirée';
end $$;

:as_admin1
do $$
begin
  assert (select state from public.admin_list_invitations() where email = 'newadmin.adm@example.com') = 'expired', 'État "expired" calculé';
end $$;

-- Révocation
:as_admin2
do $$
declare
  v_id uuid;
begin
  v_id := (public.admin_invite_staff('revoked.adm@example.com', 'support') ->> 'invitation_id')::uuid;
  assert (public.admin_revoke_invitation(v_id) ->> 'success')::boolean, 'Révocation';
  assert public.admin_revoke_invitation(v_id) ->> 'error' = 'not_pending', 'Révoquer deux fois est refusé';
  assert public.admin_revoke_invitation((select admin_inv from t_ids)) ->> 'error' = 'requires_super_admin',
    'Révoquer une invitation admin exige le super_admin';
end $$;

:as_super2
do $$
begin
  assert (public.admin_revoke_invitation((select admin_inv from t_ids)) ->> 'success')::boolean, 'Le super_admin révoque l''invitation admin';
end $$;

-- =============================================================================
-- 12. Journal d'audit : lecture admin, jamais falsifiable côté client
-- =============================================================================
:as_mod
do $$
begin
  assert public.t_exec('select * from public.admin_audit_feed()') = 'err:42501', 'Le journal est réservé aux admins';
end $$;

:as_admin1
do $$
declare
  v_oldest timestamptz;
begin
  assert (select count(*) from public.admin_audit_feed(5)) = 5, 'Pagination du journal';
  select min(created_at) into v_oldest from public.admin_audit_feed(5);
  assert (select count(*) from public.admin_audit_feed(100, v_oldest)) > 0 and
         (select max(created_at) from public.admin_audit_feed(100, v_oldest)) < v_oldest, 'Curseur created_at';
  assert (select count(*) from public.admin_audit_feed(100, null, 'suspend_user') x where x.action <> 'suspend_user') = 0, 'Filtre par action';
  assert (select actor_name from public.admin_audit_feed(100, null, 'ban_user') where result = 'success' limit 1) = 'admin.adm', 'Nom de l''acteur';
end $$;

:as_alice
do $$
begin
  assert public.t_exec($q$select public.log_audit('faux', 'profile', null, 'success')$q$) = 'err:42501', 'Pas de forge d''audit';
  assert public.t_exec($q$select public.log_security_event('adadadad-0000-0000-0000-000000000002', 'role_granted')$q$) = 'err:42501',
    'Pas de forge de journal de sécurité';
  assert public.t_exec($q$select public.internal_admin_fail('x', 'y', null, 'z')$q$) = 'err:42501', 'Aide interne non appelable';
  assert public.t_exec('select public.expire_stale_offers()') = 'err:42501', 'Cron non déclenchable par un client';
  assert public.t_exec('delete from public.audit_logs') like 'err:%', 'audit_logs reste append-only';
end $$;

reset role;
set role anon;
do $$
begin
  assert public.t_exec('select public.admin_dashboard_stats()') = 'err:42501', 'anon : aucune fonction admin';
  assert public.t_exec('select * from public.admin_list_users()') = 'err:42501', 'anon : aucune liste d''utilisateurs';
  assert public.t_exec('select public.accept_staff_invitation(gen_random_uuid())') = 'err:42501', 'anon : pas d''acceptation d''invitation';
end $$;

-- =============================================================================
-- 13. Tableau de bord et statistiques
-- =============================================================================
:as_pg
insert into public.reports (reporter_id, target_type, target_id, reason)
select 'adadadad-0000-0000-0000-000000000008', 'profile', 'adadadad-0000-0000-0000-000000000007', 'Spam ' || g
from generate_series(1, 5) g;

:as_admin1
do $$
declare
  v jsonb;
  v_days bigint;
begin
  v := public.admin_dashboard_stats();
  assert (v ->> 'users')::int = (select count(*) from public.profiles), 'Stat : utilisateurs';
  assert (v ->> 'listings')::int >= 1, 'Stat : annonces publiées';
  assert (v ->> 'pending_reports')::int >= 5, 'Stat : signalements en attente';
  assert (select count(*) from public.admin_weekly_activity()) = 7, 'Activité : 7 jours';
  assert (select sum(signups) from public.admin_weekly_activity()) >= 8, 'Activité : inscriptions du jour';
  assert (select count(*) from public.admin_signup_growth(6)) = 6, 'Croissance : 6 mois';
  assert (select count(*) from public.admin_signup_growth(100)) = 24, 'Croissance : plafonnée à 24 mois';
  assert (select count(*) from public.admin_signup_growth(0)) = 1, 'Croissance : au moins 1 mois';
  assert (select cumulative from public.admin_signup_growth(6) order by month desc limit 1) = (select count(*) from public.profiles),
    'Croissance : le cumul final = nombre de profils';
  assert (select listings from public.admin_listings_by_category() where slug = 'telephones') >= 1, 'Annonces par catégorie';
  assert (select listings from public.admin_top_campuses(5) where campus = 'UY1') >= 1, 'Top campus';
  assert (select count(*) from public.admin_alerts() where id = 'report_spike:adadadad-0000-0000-0000-000000000007' and tone = 'danger') = 1,
    'Alerte : pic de signalements sur un utilisateur';
end $$;

-- =============================================================================
-- Nettoyage de l'aide de test
-- =============================================================================
:as_pg
drop function public.t_exec(text);

select 'Test admin (0020) terminé : OK si aucun assert n''a échoué ci-dessus.' as resultat;
