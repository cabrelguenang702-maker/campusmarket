-- =============================================================================
-- 0016 — Planification de l'envoi des e-mails de notification. Même mécanique
-- que 0009_payments_cron.sql : secrets lus dans Vault à chaque exécution,
-- rien à éditer dans ce fichier.
--
-- Avant mise en route (aucune étape ne touche à ce fichier) : dans Project
-- Settings > Vault, remplacer la valeur temporaire "REMPLACER_MOI" du secret
-- "notifications_dispatch_secret" par la même valeur que
-- NOTIFICATIONS_DISPATCH_SECRET (functions/.env.example). Le secret
-- "project_url" est déjà créé par 0009 et réutilisé ici tel quel.
--
-- Sans prestataire e-mail branché (_shared/email.ts), les envois passent en
-- 'failed' avec un last_error explicite après 5 tentatives : rien n'est perdu
-- silencieusement, mais rien ne part non plus.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'notifications_dispatch_secret') then
    perform vault.create_secret('REMPLACER_MOI', 'notifications_dispatch_secret', 'Doit correspondre à NOTIFICATIONS_DISPATCH_SECRET (functions/.env.example)');
  end if;
end $$;

select cron.schedule(
  'notifications-dispatch-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := private.cron_secret('project_url') || '/functions/v1/notifications-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || private.cron_secret('notifications_dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Purge des notifications lues de plus de 90 jours (évite une table qui grossit
-- sans limite ; les non lues ne sont jamais purgées). Pur SQL, pas de secret.
select cron.schedule(
  'notifications-purge-read',
  '0 3 * * *',
  $$ delete from public.notifications where read_at is not null and read_at < now() - interval '90 days'; $$
);
