-- =============================================================================
-- 0015 — Notifications (section 18) : table avec type/acteur/cible/payload
-- minimal/read_at/created_at, canaux in-app + realtime + e-mail selon les
-- préférences, file d'attente pour l'asynchrone, déduplication des
-- notifications répétitives, préférences par catégorie, notifications de
-- sécurité non désactivables.
--
-- Principe : personne côté client n'écrit une notification (ni pour soi, ni
-- pour un autre — sinon n'importe qui pourrait en fabriquer une "de la part
-- du système"). Seules les fonctions SECURITY DEFINER de cette migration,
-- appelées par des triggers ou par d'autres fonctions serveur, en créent.
-- =============================================================================

create type public.notification_category as enum (
  'produit', 'message', 'achat', 'groupe', 'evenement', 'formation', 'systeme', 'securite'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category public.notification_category not null,
  -- Identifiant applicatif du type (ex. 'new_message', 'offer_received') : le
  -- front en déduit titre, icône et lien ; aucun texte rédigé n'est stocké.
  type text not null check (char_length(type) between 2 and 60),
  actor_id uuid references public.profiles (id) on delete set null,
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id uuid,
  -- "Payload minimal" (section 18) : jamais le contenu d'un message, jamais de
  -- donnée sensible — des identifiants et un compteur, au plus ~1 Ko.
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 1000),
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Déduplication : au plus UNE notification non lue par (destinataire, clé).
-- Une répétition (ex. 5 messages d'affilée dans la même conversation) met à
-- jour l'existante au lieu d'en empiler cinq.
create unique index notifications_dedup_uidx
  on public.notifications (user_id, dedup_key)
  where dedup_key is not null and read_at is null;

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

-- Le destinataire marque lu / non lu ; le trigger ci-dessous limite ce qui
-- peut réellement changer à read_at.
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications_delete_own"
  on public.notifications for delete
  to authenticated
  using (user_id = auth.uid());

-- Aucune policy INSERT : voir en-tête.

create or replace function public.protect_notification_content()
returns trigger
language plpgsql
as $$
begin
  -- current_user = authenticated/anon : UPDATE direct d'un client. Les mises à
  -- jour serveur (déduplication) passent par une fonction SECURITY DEFINER,
  -- donc current_user = propriétaire de la fonction.
  if current_user in ('authenticated', 'anon') and (
       new.user_id is distinct from old.user_id
    or new.category is distinct from old.category
    or new.type is distinct from old.type
    or new.actor_id is distinct from old.actor_id
    or new.target_type is distinct from old.target_type
    or new.target_id is distinct from old.target_id
    or new.payload is distinct from old.payload
    or new.dedup_key is distinct from old.dedup_key
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Une notification ne peut être modifiée que sur read_at';
  end if;
  return new;
end;
$$;

create trigger notifications_protect_content
  before update on public.notifications
  for each row execute function public.protect_notification_content();

-- -----------------------------------------------------------------------------
-- PRÉFÉRENCES par catégorie et par canal. Pas de ligne = valeurs par défaut
-- (in-app activé partout ; e-mail désactivé sauf sécurité).
-- -----------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category public.notification_category not null,
  in_app boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, category),
  -- Section 18 : les notifications de sécurité ne sont pas désactivables.
  check (category <> 'securite' or (in_app and email))
);

create trigger set_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

-- Une seule policy FOR ALL, symétrique : with check réaffirme user_id (cf. le
-- piège des WITH CHECK combinés par OR entre policies, documenté en 0014).
create policy "notification_preferences_own"
  on public.notification_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- FILE D'ATTENTE E-MAIL — envoi asynchrone par l'Edge Function
-- notifications-dispatch (cron). Verrouillée : service_role uniquement.
-- -----------------------------------------------------------------------------
create table public.notification_email_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id)
);

create index notification_email_queue_pending_idx
  on public.notification_email_queue (created_at) where status = 'pending';

alter table public.notification_email_queue enable row level security;
-- Aucune policy : deny-all pour authenticated/anon.

-- -----------------------------------------------------------------------------
-- CRÉATION — seule porte d'entrée. Respecte les préférences, déduplique,
-- alimente la file e-mail, et n'échoue JAMAIS vers l'appelant : perdre une
-- notification est acceptable, faire échouer l'envoi d'un message ou la
-- création d'une commande parce qu'une notification a planté ne l'est pas.
-- -----------------------------------------------------------------------------
create or replace function public.create_notification(
  p_user_id uuid,
  p_category public.notification_category,
  p_type text,
  p_actor_id uuid default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_dedup_key text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in_app boolean;
  v_email boolean;
  v_id uuid;
  v_inserted boolean;
begin
  if p_user_id is null or p_user_id is not distinct from p_actor_id then
    return; -- jamais de notification à soi-même pour sa propre action
  end if;

  select
    coalesce(np.in_app, true),
    coalesce(np.email, p_category = 'securite')
  into v_in_app, v_email
  from (select 1) _
  left join public.notification_preferences np
    on np.user_id = p_user_id and np.category = p_category;

  if p_category = 'securite' then
    v_in_app := true;
    v_email := true;
  end if;

  if not v_in_app and not v_email then
    return;
  end if;

  -- Une notification e-mail-seulement reste stockée (source de vérité pour la
  -- file), mais est créée déjà lue pour ne pas polluer la boîte in-app.
  insert into public.notifications (user_id, category, type, actor_id, target_type, target_id, payload, dedup_key, read_at)
  values (p_user_id, p_category, p_type, p_actor_id, p_target_type, p_target_id, p_payload, p_dedup_key,
          case when v_in_app then null else now() end)
  on conflict (user_id, dedup_key) where dedup_key is not null and read_at is null
  do update set
    created_at = now(),
    payload = notifications.payload
              || jsonb_build_object('count', coalesce((notifications.payload ->> 'count')::int, 1) + 1)
  returning id, (xmax = 0) into v_id, v_inserted;

  -- E-mail seulement à la PREMIÈRE création : une répétition dédupliquée ne
  -- doit pas renvoyer un e-mail à chaque message.
  if v_email and v_inserted then
    insert into public.notification_email_queue (notification_id, user_id)
    values (v_id, p_user_id)
    on conflict (notification_id) do nothing;
  end if;
exception when others then
  raise warning 'create_notification a échoué (%): %', p_type, sqlerrm;
end;
$$;

revoke execute on function public.create_notification(uuid, public.notification_category, text, uuid, text, uuid, jsonb, text)
  from public, anon, authenticated;

comment on function public.create_notification is
  'Interne : appelée par des triggers/fonctions SECURITY DEFINER uniquement (EXECUTE révoqué pour les clients). Avale ses propres erreurs.';

-- =============================================================================
-- CÂBLAGE sur les modules existants. Chaque trigger est SECURITY DEFINER et
-- ne transporte que des identifiants (payload minimal).
-- =============================================================================

-- Messagerie : notifie l'autre participant, dédupliqué par conversation
-- (payload.count = nombre de messages non lus regroupés). Pas de notification
-- si l'un a bloqué l'autre.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations;
  v_recipient uuid;
begin
  select * into v_conv from public.conversations where id = new.conversation_id;
  v_recipient := case when v_conv.participant_one = new.sender_id then v_conv.participant_two else v_conv.participant_one end;

  if public.is_blocked(v_conv.participant_one, v_conv.participant_two) then
    return new;
  end if;

  perform public.create_notification(
    v_recipient, 'message', 'new_message', new.sender_id,
    'conversation', new.conversation_id, '{}'::jsonb, 'msg:' || new.conversation_id::text
  );
  return new;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_new_message();

-- Offres : nouvelle offre -> vendeur ; réponse -> l'autre partie.
create or replace function public.notify_offer_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.seller_id, 'achat', 'offer_received', new.buyer_id, 'offer', new.id,
    jsonb_build_object('product_id', new.product_id)
  );
  return new;
end;
$$;

create trigger offers_notify_created
  after insert on public.offers
  for each row execute function public.notify_offer_created();

create or replace function public.notify_offer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_to uuid;
  v_from uuid;
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending' and new.status = 'countered' then
    v_type := 'offer_countered'; v_to := new.buyer_id; v_from := new.seller_id;
  elsif old.status = 'pending' and new.status = 'accepted' then
    v_type := 'offer_accepted'; v_to := new.buyer_id; v_from := new.seller_id;
  elsif old.status = 'pending' and new.status = 'rejected' then
    v_type := 'offer_rejected'; v_to := new.buyer_id; v_from := new.seller_id;
  elsif old.status = 'countered' and new.status = 'accepted' then
    v_type := 'offer_accepted'; v_to := new.seller_id; v_from := new.buyer_id;
  elsif old.status = 'pending' and new.status = 'withdrawn' then
    v_type := 'offer_withdrawn'; v_to := new.seller_id; v_from := new.buyer_id;
  else
    return new; -- expirations et cas rares : pas de notification
  end if;

  perform public.create_notification(v_to, 'achat', v_type, v_from, 'offer', new.id,
    jsonb_build_object('product_id', new.product_id));
  return new;
end;
$$;

create trigger offers_notify_status
  after update of status on public.offers
  for each row execute function public.notify_offer_status();

-- Commandes : nouvelle commande -> vendeur ; paiement confirmé -> les deux.
create or replace function public.notify_order_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(
    new.seller_id, 'achat', 'order_received', new.buyer_id, 'order', new.id,
    jsonb_build_object('product_id', new.product_id)
  );
  return new;
end;
$$;

create trigger orders_notify_created
  after insert on public.orders
  for each row execute function public.notify_order_created();

create or replace function public.notify_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.create_notification(new.seller_id, 'achat', 'order_paid', new.buyer_id, 'order', new.id, '{}'::jsonb);
    perform public.create_notification(new.buyer_id, 'achat', 'payment_confirmed', null, 'order', new.id, '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger orders_notify_paid
  after update of status on public.orders
  for each row execute function public.notify_order_paid();

-- Academy : certificat émis.
create or replace function public.notify_certificate_issued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_notification(new.user_id, 'formation', 'certificate_issued', null, 'course', new.course_id,
    jsonb_build_object('certificate_id', new.id));
  return new;
end;
$$;

create trigger certificates_notify
  after insert on public.certificates
  for each row execute function public.notify_certificate_issued();

-- Espaces : demande d'adhésion -> owners/admins ; invitation -> l'invité ;
-- décision sur une demande spontanée -> le demandeur.
create or replace function public.notify_membership_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  if new.invited_by is not null then
    perform public.create_notification(new.user_id, 'groupe', 'space_invitation', new.invited_by, 'space', new.space_id, '{}'::jsonb);
  else
    for v_admin in
      select user_id from public.space_members where space_id = new.space_id and role in ('owner', 'admin')
    loop
      perform public.create_notification(v_admin.user_id, 'groupe', 'membership_requested', new.user_id, 'space', new.space_id,
        '{}'::jsonb, 'req:' || new.space_id::text);
    end loop;
  end if;
  return new;
end;
$$;

create trigger space_membership_requests_notify_created
  after insert on public.space_membership_requests
  for each row execute function public.notify_membership_request();

create or replace function public.notify_membership_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.invited_by is null and old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform public.create_notification(
      new.user_id, 'groupe',
      case when new.status = 'approved' then 'membership_approved' else 'membership_rejected' end,
      null, 'space', new.space_id, '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

create trigger space_membership_requests_notify_decision
  after update of status on public.space_membership_requests
  for each row execute function public.notify_membership_decision();

-- Événements : billet validé (gratuit direct, ou payant après règlement).
create or replace function public.notify_ticket_valid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'valid' and (tg_op = 'INSERT' or old.status is distinct from 'valid') then
    perform public.create_notification(new.attendee_id, 'evenement', 'ticket_confirmed', null, 'event', new.event_id,
      jsonb_build_object('ticket_id', new.id));
  end if;
  return new;
end;
$$;

create trigger event_tickets_notify
  after insert or update of status on public.event_tickets
  for each row execute function public.notify_ticket_valid();

-- Sécurité (0011) : nouvel appareil, changement de rôle, MFA, mot de passe.
-- log_security_event est déjà le point de passage unique de ces événements ;
-- on l'étend plutôt que de dupliquer un trigger sur security_logs.
create or replace function public.log_security_event(
  p_user_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb,
  p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  insert into public.security_logs (user_id, event_type, ip, user_agent, metadata)
  values (p_user_id, p_event_type, p_ip, p_user_agent, p_metadata);

  if p_event_type in ('role_granted', 'role_revoked') then
    -- Ici p_user_id est l'ADMIN qui agit ; c'est la personne CONCERNÉE qu'on prévient.
    v_target := nullif(p_metadata ->> 'target_user', '')::uuid;
    perform public.create_notification(v_target, 'securite', p_event_type, null, null, null,
      jsonb_build_object('role', p_metadata ->> 'role'));
  elsif p_event_type in ('new_device_detected', 'password_changed', 'mfa_enabled', 'mfa_disabled') then
    perform public.create_notification(p_user_id, 'securite', p_event_type, null, null, null, '{}'::jsonb);
  end if;
end;
$$;

-- Avertissement de modération (0014) : jusqu'ici journalisé seulement, l'utilisateur
-- concerné n'en voyait rien. Il reçoit maintenant une notification 'systeme'.
create or replace function public.moderate_warn_user(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Permission refusée : avertissement réservé au staff';
  end if;

  perform public.log_audit('warn_user', 'profile', p_user_id, 'success', jsonb_build_object('reason', p_reason));
  -- Le motif reste dans audit_logs (staff) : la notification ne transporte que le fait.
  perform public.create_notification(p_user_id, 'systeme', 'moderation_warning', null, null, null, '{}'::jsonb);
end;
$$;

comment on function public.moderate_warn_user is
  'Journalise dans audit_logs et notifie l''utilisateur (catégorie systeme, sans le motif).';

-- Realtime : le front s'abonne aux nouvelles notifications de l'utilisateur.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  raise notice 'Publication supabase_realtime absente (normal en local hors Supabase).';
end $$;
