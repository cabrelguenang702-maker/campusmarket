-- =============================================================================
-- 0017 — Câblage des notifications restantes (retrait d'annonce par la
-- modération, inscription à une formation, achats groupés, publications dans
-- les espaces, rappels d'événement) + infrastructure Vault pour les cron
-- (0009/0016 réécrits pour ne plus contenir de placeholder à éditer).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Retrait d'une annonce par la modération (status -> 'removed', staff only
-- via products_staff_update, 0004). Le vendeur doit le savoir.
-- -----------------------------------------------------------------------------
create or replace function public.notify_product_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'removed' and old.status is distinct from 'removed' then
    perform public.create_notification(new.seller_id, 'produit', 'product_removed', null, 'product', new.id, '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger products_notify_removed
  after update of status on public.products
  for each row execute function public.notify_product_removed();

-- -----------------------------------------------------------------------------
-- Inscription à une formation confirmée (gratuite immédiate, ou payante après
-- règlement — finalize_enrollment_activation, 0013, se déclenche dans les deux cas).
-- -----------------------------------------------------------------------------
create or replace function public.notify_enrollment_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public.create_notification(new.user_id, 'formation', 'enrollment_confirmed', null, 'course', new.course_id,
      jsonb_build_object('enrollment_id', new.id));
  end if;
  return new;
end;
$$;

create trigger course_enrollments_notify_active
  after insert or update of status on public.course_enrollments
  for each row execute function public.notify_enrollment_active();

-- -----------------------------------------------------------------------------
-- Achats groupés : palier atteint ou annulé -> tous les participants. La
-- transition elle-même reste décidée par la couche service (voir 0006, le
-- remboursement de différence est une logique multi-lignes hors trigger) ;
-- ce trigger ne fait que réagir au changement de statut, quel qu'en soit
-- l'auteur (service_role via un job planifié, en pratique).
-- -----------------------------------------------------------------------------
create or replace function public.notify_group_purchase_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant record;
  v_type text;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'reached' then
    v_type := 'group_purchase_reached';
  elsif new.status = 'cancelled' then
    v_type := 'group_purchase_cancelled';
  else
    return new; -- 'expired' sans avoir atteint l'objectif : le remboursement
                -- intégral (service layer) porte sa propre notification, pas
                -- de doublon générique ici.
  end if;

  for v_participant in
    select buyer_id from public.group_purchase_participants where group_purchase_id = new.id
  loop
    perform public.create_notification(v_participant.buyer_id, 'produit', v_type, null, 'group_purchase', new.id,
      jsonb_build_object('product_id', new.product_id));
  end loop;

  return new;
end;
$$;

create trigger group_purchases_notify_status
  after update of status on public.group_purchases
  for each row execute function public.notify_group_purchase_status();

-- -----------------------------------------------------------------------------
-- Publications dans un espace : notifier TOUS les membres à chaque post créerait
-- un fan-out incontrôlé (un espace de 5 000 membres = 5 000 lignes par post).
-- Compromis choisi : notifier uniquement les membres qui ont interagi avec le
-- fil (auteurs des commentaires précédents) à un NOUVEAU commentaire — portée
-- naturellement bornée par la taille de la conversation, pas par celle de
-- l'espace. Pas de notification sur la simple création d'un post.
-- -----------------------------------------------------------------------------
create or replace function public.notify_new_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.space_posts;
  v_recipient uuid;
begin
  select * into v_post from public.space_posts where id = new.post_id;

  -- L'auteur du post, s'il n'est pas lui-même le commentateur.
  if v_post.author_id <> new.author_id then
    perform public.create_notification(v_post.author_id, 'groupe', 'new_comment', new.author_id, 'space_post', new.post_id,
      '{}'::jsonb, 'comment:' || new.post_id::text);
  end if;

  -- Les autres commentateurs précédents du même fil (hors auteur du post déjà
  -- notifié ci-dessus, et hors le commentateur actuel), sans doublon par appel
  -- grâce à la déduplication (une seule notification non lue par clé).
  for v_recipient in
    select distinct author_id from public.space_post_comments
    where post_id = new.post_id and author_id not in (new.author_id, v_post.author_id)
  loop
    perform public.create_notification(v_recipient, 'groupe', 'new_comment', new.author_id, 'space_post', new.post_id,
      '{}'::jsonb, 'comment:' || new.post_id::text);
  end loop;

  return new;
end;
$$;

create trigger space_post_comments_notify
  after insert on public.space_post_comments
  for each row execute function public.notify_new_comment();

comment on function public.notify_new_comment is
  'Choix assumé : pas de notification sur la création d''un post (fan-out non borné par la taille de l''espace) ; seuls les fils de discussion (commentaires) notifient, leur portée étant bornée par le nombre de participants au fil, pas par la taille de l''espace.';

-- -----------------------------------------------------------------------------
-- Rappel d'événement : la veille, aux détenteurs de billet valide/utilisé,
-- planifié via pg_cron (dépend de vault/private.cron_secret, mis en place par
-- 0009). Pur SQL, pas d'appel externe : pas besoin de net.http_post.
-- -----------------------------------------------------------------------------
create or replace function public.send_event_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_ticket record;
begin
  for v_ticket in
    select t.id, t.attendee_id, t.event_id
    from public.event_tickets t
    join public.events e on e.id = t.event_id
    where t.status in ('valid', 'used')
      and e.status = 'published'
      and e.starts_at between now() + interval '23 hours' and now() + interval '25 hours'
  loop
    perform public.create_notification(v_ticket.attendee_id, 'evenement', 'event_reminder', null, 'event', v_ticket.event_id,
      jsonb_build_object('ticket_id', v_ticket.id), 'reminder:' || v_ticket.event_id::text);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.send_event_reminders is
  'Planifié via pg_cron, une fois par heure : select public.send_event_reminders(); — la fenêtre de 2h (23-25h avant) couvre un cron horaire sans doublon grâce à la déduplication par clé.';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('event-reminders-hourly', '0 * * * *', 'select public.send_event_reminders();');
  else
    raise notice 'pg_cron absent : planifier manuellement select public.send_event_reminders() (voir 0010).';
  end if;
end $$;
