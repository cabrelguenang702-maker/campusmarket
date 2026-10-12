-- =============================================================================
-- 0010 — Planification du nettoyage périodique des offres et réservations
-- expirées (section 53 : une réservation ou une négociation jamais tranchée
-- ne doit pas bloquer indéfiniment le produit). Même mécanique que
-- 0009_payments_cron.sql (pg_cron + pg_net), même avertissement :
-- 1. Activer pg_cron/pg_net depuis Dashboard > Database > Extensions si
--    nécessaire (généralement déjà fait après 0009).
-- 2. Ces deux fonctions sont du SQL pur (pas d'appel externe) : contrairement
--    à payments-reconcile, pas besoin de net.http_post ni de secret — on
--    planifie directement l'appel SQL.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'expire-stale-offers-and-reservations',
  '*/5 * * * *',
  $$
  select public.expire_stale_offers();
  select public.expire_stale_reservations();
  $$
);

-- Pour désactiver temporairement :
-- select cron.unschedule('expire-stale-offers-and-reservations');
