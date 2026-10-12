-- =============================================================================
-- 0009 — Planification du job de réconciliation des paiements (section 47,
-- "réconciliation périodique"). pg_cron (planification) + pg_net (appel HTTP
-- sortant vers l'Edge Function payments-reconcile).
--
-- Les secrets (URL du projet, jeton du job) sont lus dans Supabase Vault à
-- CHAQUE exécution du cron, jamais codés en dur dans cette migration : aucune
-- valeur réelle ne transite donc jamais par le dépôt Git, et il n'y a rien à
-- éditer dans ce fichier avant de l'exécuter.
--
-- Étapes avant mise en route (aucune ne touche à ce fichier) :
-- 1. Activer les extensions pg_cron et pg_net depuis le Dashboard Supabase
--    (Database > Extensions) si `create extension` ci-dessous échoue par
--    manque de droits — certains plans exigent cette activation manuelle.
-- 2. Dans Project Settings > Vault, ce fichier crée deux secrets avec une
--    valeur temporaire "REMPLACER_MOI" : "project_url" (l'URL Functions du
--    projet, ex. https://abcdefgh.supabase.co) et "payments_reconcile_secret"
--    (même valeur que PAYMENTS_RECONCILE_SECRET dans functions/.env.example).
--    Remplacer leur valeur directement dans l'UI du Dashboard.
-- Tant que ces deux valeurs restent "REMPLACER_MOI", le job échoue proprement
-- (401/domaine invalide chez le prestataire), sans jamais rien casser.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;

-- Enveloppe de lecture de Vault : schéma "private" (jamais exposé par
-- l'API REST/PostgREST, contrairement à "public"), EXECUTE révoqué pour
-- authenticated/anon en plus de ça — double verrou sur des secrets.
create or replace function private.cron_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

revoke all on function private.cron_secret(text) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    perform vault.create_secret('REMPLACER_MOI', 'project_url', 'URL Functions du projet, ex. https://abcdefgh.supabase.co (Project Settings > Vault pour la modifier)');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'payments_reconcile_secret') then
    perform vault.create_secret('REMPLACER_MOI', 'payments_reconcile_secret', 'Doit correspondre à PAYMENTS_RECONCILE_SECRET (functions/.env.example)');
  end if;
end $$;

select cron.schedule(
  'payments-reconcile-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := private.cron_secret('project_url') || '/functions/v1/payments-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || private.cron_secret('payments_reconcile_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

comment on extension pg_cron is
  'Planifie payments-reconcile (voir cron.job "payments-reconcile-every-5-minutes") et, depuis 0016, notifications-dispatch. Pour changer la fréquence : select cron.alter_job(...) ou re-schedule après unschedule.';

-- Pour désactiver temporairement (ex. maintenance CamPay) :
-- select cron.unschedule('payments-reconcile-every-5-minutes');
