-- 0023 — Restaure les droits par défaut de Supabase sur le schéma public, perdus quand l'ancien schéma a été
-- effacé (DROP SCHEMA public CASCADE) : à ce moment-là les ACL par défaut du schéma disparaissent, et les
-- migrations 0001–0021 (qui supposent « toute table de public reçoit tous les droits pour anon et authenticated »,
-- cf. 0021 §3) se sont appliquées sans eux. Symptôme : « permission denied for table products » pour le rôle
-- authenticated, et « permission denied for function is_staff » dans les policies.
--
-- Idempotent : sur un projet Supabase neuf (droits par défaut présents) cette migration ne change rien, elle
-- réapplique le même état final que 0021 (droits minimaux) par-dessus les droits par défaut.

-- 1. Tables : DML pour authenticated (la RLS décide), tous les droits pour service_role (comme le défaut Supabase).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- 2. On rejoue exactement les retraits de 0021 §3, des migrations 0007/0011/0014 (journaux append-only).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on public.provider_events from anon, authenticated;
revoke all on public.phone_verification_codes from anon, authenticated;
revoke all on public.notification_email_queue from anon, authenticated;
revoke insert on public.audit_logs from authenticated;
revoke insert on public.security_logs from authenticated;
revoke insert, update, delete on public.cities_overview from authenticated;
revoke update, delete on public.payment_ledger from authenticated, anon, service_role;
revoke update, delete on public.provider_events from authenticated, anon, service_role;
revoke update, delete on public.audit_logs from authenticated, anon, service_role;
revoke update, delete on public.security_logs from authenticated, anon, service_role;
revoke update, delete on public.ticket_scans from authenticated, anon, service_role;

-- 3. Futures tables : même modèle que Supabase (la prochaine migration n'a pas à y penser).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;

-- 4. Fonctions : service_role peut tout exécuter (défaut Supabase) ; authenticated uniquement les fonctions
--    d'aide évaluées par les policies et les gardes (is_staff, is_active_account, …). Les fonctions que
--    0015/0020/0021 ont volontairement retirées aux clients (log_audit, create_notification, create_phone_otp,
--    expire_stale_*, internal_admin_fail, purge_expired_security_data…) restent inaccessibles.
grant execute on all functions in schema public to service_role;
grant execute on function
  public.has_role(public.app_role, uuid),
  public.is_staff(uuid),
  public.is_admin(uuid),
  public.is_active_account(uuid),
  public.is_blocked(uuid, uuid),
  public.is_space_admin(uuid, uuid),
  public.is_space_member(uuid, uuid),
  public.is_space_moderator(uuid, uuid),
  public.has_back_office_access(uuid),
  public.staff_rank(uuid),
  public.has_mfa_session(),
  public.session_aal(),
  public.act_as_staff(),
  public.act_as_admin(),
  public.act_as_moderator(),
  public.act_as_support()
to authenticated;
-- Les fonctions de trigger n'ont besoin d'aucun EXECUTE (cf. 0021 §4) : service_role compris.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from service_role', r.sig);
  end loop;
end $$;

-- 5. Réapplication des restrictions de 0022 (le « grant ... on all tables » ci-dessus a rouvert UPDATE).
revoke update on public.wanted_requests from authenticated;
grant update (title, description, budget, category_slug, status) on public.wanted_requests to authenticated;
-- Compteurs et statistiques : écrits uniquement par triggers SECURITY DEFINER.
revoke insert, update, delete on public.product_stats from authenticated;
revoke insert, update, delete on public.seller_stats from authenticated;
-- Avis immuables ; réponses non modifiables (suppression seule).
revoke update, delete on public.seller_reviews from authenticated;
revoke update on public.wanted_responses from authenticated;
-- Lecture publique explicite (0021 : anon ne lit que ce qu'on lui accorde nommément).
grant select on public.product_stats, public.seller_reviews, public.seller_stats to anon;
