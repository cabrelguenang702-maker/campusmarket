-- =============================================================================
-- Contrôle de pré-production — À EXÉCUTER SUR LE VRAI PROJET (SQL Editor), en LECTURE SEULE.
-- Il ne modifie rien : il ne fait que SELECT. Il renvoie une ligne par contrôle avec un
-- statut : OK, ECHEC (bloquant avant production) ou AVERT (à examiner).
--
--   (coller le fichier entier : une seule requête, le verdict est la première ligne)
--
-- Ce que ce script NE PEUT PAS vérifier (réglages du tableau de bord, hors base) est dans
-- supabase/PRODUCTION.md, section "Réglages hors base".
-- =============================================================================

with checks as (

  -- ---- Schéma : RLS et fonctions ------------------------------------------------------
  select 'rls_partout' as controle,
         case when count(*) = 0 then 'OK' else 'ECHEC' end as statut,
         coalesce('tables sans RLS : ' || string_agg(c.relname, ', '), 'toutes les tables de public ont la RLS') as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all
  select 'definer_search_path',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('SECURITY DEFINER sans search_path : ' || string_agg(p.oid::regprocedure::text, ', '),
                  'toutes les fonctions SECURITY DEFINER figent leur search_path')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')

  union all
  select 'vues_security_invoker',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('vues sans security_invoker (contournent la RLS) : ' || string_agg(c.relname, ', '),
                  'toutes les vues respectent la RLS de l''appelant')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), false)

  -- ---- Droits : le point d'entrée réel est l'API REST, donc les droits de anon/authenticated ----
  union all
  select 'pas_de_truncate_client',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce(count(*) || ' droits TRUNCATE/REFERENCES/TRIGGER accordés à un client (TRUNCATE ignore la RLS)',
                  'aucun')
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')

  union all
  select 'anon_lecture_seule',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('droits d''écriture pour anon sur : ' || string_agg(distinct table_name, ', '), 'anon ne peut rien écrire')
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'

  union all
  select 'tables_de_service_fermees',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('droits client sur : ' || string_agg(distinct table_name, ', '), 'provider_events, codes OTP, file e-mail : aucun droit client')
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('provider_events', 'phone_verification_codes', 'notification_email_queue')
    and grantee in ('anon', 'authenticated')

  union all
  select 'journaux_non_ecrivables',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('un client peut écrire dans : ' || string_agg(distinct table_name, ', '), 'audit_logs et security_logs : aucun droit d''écriture client')
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('audit_logs', 'security_logs')
    and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')

  union all
  select 'fonctions_internes_non_exposees',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('exécutables par un client : ' || string_agg(proname, ', '),
                  'log_audit, log_security_event, tâches de cron, OTP, rétention : réservées au serveur')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('log_audit', 'log_security_event', 'expire_stale_offers', 'expire_stale_reservations',
                      'expire_stale_tickets', 'send_event_reminders', 'create_phone_otp', 'verify_phone_otp',
                      'purge_expired_security_data', 'internal_admin_fail')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))

  union all
  select 'fonctions_trigger_non_exposees',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce(count(*) || ' fonctions de trigger exécutables par un client', 'aucune')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))

  union all
  select 'anon_fonctions_minimales',
         case when count(*) = 0 then 'OK' else 'AVERT' end,
         coalesce('anon peut exécuter : ' || string_agg(proname, ', ' order by proname),
                  'anon n''exécute que les helpers de policy')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('is_staff', 'is_admin', 'has_role', 'is_space_member', 'is_space_admin', 'is_space_moderator')

  -- ---- Stockage -------------------------------------------------------------------------
  union all
  select 'buckets_prives',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('buckets publics : ' || string_agg(id, ', '), 'aucun bucket public')
  from storage.buckets where public

  union all
  select 'buckets_limites',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('sans limite de taille ou de types : ' || string_agg(id, ', '), 'tous les buckets ont une taille max et des types autorisés')
  from storage.buckets where file_size_limit is null or allowed_mime_types is null

  -- ---- Comptes et rôles -------------------------------------------------------------------
  union all
  select 'super_admin_present',
         case when count(*) >= 1 then 'OK' else 'ECHEC' end,
         count(*) || ' super_admin (il en faut au moins 1 ; 2 est plus sûr pour ne pas se verrouiller dehors)'
  from public.user_roles where role = 'super_admin'

  union all
  select 'super_admin_unique_risque',
         case when count(*) >= 2 then 'OK' else 'AVERT' end,
         count(*) || ' super_admin : en cas de perte de son MFA, plus personne ne peut gérer les rôles'
  from public.user_roles where role = 'super_admin'

  union all
  select 'admins_sans_mfa',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('admins/super_admins sans facteur MFA vérifié : ' || count(*), 'tous les admins ont un facteur MFA vérifié')
  from public.user_roles ur
  where ur.role in ('admin', 'super_admin')
    and not exists (select 1 from auth.mfa_factors f where f.user_id = ur.user_id and f.status = 'verified')

  union all
  select 'comptes_de_test',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce(count(*) || ' comptes @example.com / @test (à supprimer avant l''ouverture)', 'aucun compte de test')
  from auth.users
  where email ~* '@(example\.(com|org|net)|test|local)$' or email ~* '^(test|demo)[._+-]'

  union all
  select 'donnees_de_demo',
         case when count(*) = 0 then 'OK' else 'AVERT' end,
         coalesce(count(*) || ' annonces publiées dont le vendeur est un compte de test', 'aucune annonce de démonstration')
  from public.products p join auth.users u on u.id = p.seller_id
  where u.email ~* '@(example\.(com|org|net)|test|local)$'

  -- ---- Paiements ----------------------------------------------------------------------------
  union all
  select 'webhooks_signature_valide',
         case when count(*) = 0 then 'OK' else 'AVERT' end,
         coalesce(count(*) || ' événements de paiement reçus avec signature NON vérifiée (30 derniers jours)', 'aucun')
  from public.provider_events
  where not signature_valid and received_at > now() - interval '30 days'

  union all
  select 'paiements_bloques',
         case when count(*) = 0 then 'OK' else 'AVERT' end,
         coalesce(count(*) || ' tentatives de paiement "pending" depuis plus de 2 h (la réconciliation tourne-t-elle ?)', 'aucune')
  from public.payment_attempts
  where status = 'pending' and created_at < now() - interval '2 hours'

  -- ---- Tâches planifiées -----------------------------------------------------------------
  union all
  select 'pg_cron_installe',
         case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'OK' else 'ECHEC' end,
         'extension pg_cron (sans elle, rien n''expire : offres, réservations, billets, tickets, purge)'

  union all
  select 'jobs_cron_attendus',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('jobs planifiés manquants : ' || string_agg(e.name, ', ' order by e.name),
                  'les 7 jobs attendus sont planifiés')
  from unnest(array[
         'payments-reconcile-every-5-minutes', 'expire-stale-offers-and-reservations',
         'expire-stale-tickets', 'event-reminders-hourly', 'notifications-dispatch-every-minute',
         'notifications-purge-read', 'purge-security-data-daily']) as e(name)
  where not exists (select 1 from cron.job j where j.jobname = e.name)

  union all
  select 'pg_net_installe',
         case when exists (select 1 from pg_extension where extname = 'pg_net') then 'OK' else 'ECHEC' end,
         'extension pg_net (appels des Edge Functions depuis les jobs cron)'

  union all
  select 'secrets_vault_remplis',
         case when count(*) = 0 then 'OK' else 'ECHEC' end,
         coalesce('secrets Vault encore vides ou à l''état de modèle : ' || string_agg(name, ', '), 'aucun secret Vault vide ou factice')
  from vault.decrypted_secrets
  where decrypted_secret is null or length(decrypted_secret) < 16
     or decrypted_secret ~* '(REMPLACER|CHANGE.?ME|TODO|xxx|example)'

  -- ---- Rétention : croissance silencieuse -----------------------------------------------------
  union all
  select 'otp_expires_purges',
         case when count(*) = 0 then 'OK' else 'AVERT' end,
         coalesce(count(*) || ' codes OTP de plus de 2 jours (la purge quotidienne tourne-t-elle ?)', 'aucun')
  from public.phone_verification_codes where created_at < now() - interval '2 days'

  union all
  select 'file_email_en_echec',
         case when count(*) = 0 then 'OK' else 'AVERT' end,
         coalesce(count(*) || ' e-mails en échec définitif (domaine d''expédition vérifié ? SPF/DKIM ?)', 'aucun')
  from public.notification_email_queue where status = 'failed'
)
-- Une seule requête, un seul résultat (le SQL Editor n'affiche que le dernier) :
-- la première ligne est le verdict, les suivantes les contrôles, ECHEC puis AVERT puis OK.
select severite, controle, statut, detail from (
  select 0 as severite, 'VERDICT' as controle,
         case when count(*) filter (where statut = 'ECHEC') > 0 then 'ECHEC'
              when count(*) filter (where statut = 'AVERT') > 0 then 'AVERT' else 'OK' end as statut,
         case
           when count(*) filter (where statut = 'ECHEC') > 0
             then 'NE PAS METTRE EN PRODUCTION : ' || count(*) filter (where statut = 'ECHEC') || ' contrôle(s) en ECHEC'
           when count(*) filter (where statut = 'AVERT') > 0
             then 'Prêt côté base, ' || count(*) filter (where statut = 'AVERT') || ' avertissement(s) à examiner'
           else 'Tous les contrôles de base sont OK' end as detail
  from checks
  union all
  select case statut when 'ECHEC' then 1 when 'AVERT' then 2 else 3 end, controle, statut, detail from checks
) r
order by severite, controle;
