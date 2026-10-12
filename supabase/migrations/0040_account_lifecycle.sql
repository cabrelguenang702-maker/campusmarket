-- 0040 — Réglages de visibilité, désactivation du compte, export des données
--
-- Visibilité (seuls réglages que la base peut réellement appliquer) :
--   * profiles.discoverable            : apparaître dans la recherche de personnes (la recherche filtre dessus)
--   * profile_private.allow_stranger_messages : si faux, seuls les abonnés peuvent ouvrir une conversation SANS annonce.
--     Les messages à propos d'une annonce du destinataire restent possibles (sinon aucun achat n'est plus possible).
--
-- Désactivation (réversible, à tout moment, en se reconnectant) :
--   * profiles.deactivated_at ; profil, annonces et demandes disparaissent pour les autres ; plus d'action possible
--     (is_active_account() devient faux) ; commandes en cours inchangées ; personne ne peut ouvrir de conversation.
--   * deactivate_my_account() / reactivate_my_account() journalisent dans security_logs.
--
-- Export : export_my_data() renvoie TOUTES les données personnelles de l'appelant en JSON (3 exports / heure maximum).

alter table public.security_logs drop constraint if exists security_logs_event_type_check;
alter table public.security_logs add constraint security_logs_event_type_check check (event_type = any (array[
  'login_success', 'login_failure', 'new_device_detected', 'otp_requested', 'otp_verified', 'otp_failed', 'otp_expired',
  'mfa_enabled', 'mfa_disabled', 'mfa_challenge_success', 'mfa_challenge_failure', 'password_changed', 'role_granted',
  'role_revoked', 'reauth_required', 'financial_export', 'account_banned', 'account_unbanned',
  'account_deactivated', 'account_reactivated', 'data_exported'
]));

alter table public.profiles
  add column if not exists discoverable boolean not null default true,
  add column if not exists deactivated_at timestamptz;

alter table public.profile_private
  add column if not exists allow_stranger_messages boolean not null default true;

create or replace function public.is_account_hidden(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = uid and deactivated_at is not null);
$$;

revoke all on function public.is_account_hidden(uuid) from public;
grant execute on function public.is_account_hidden(uuid) to anon, authenticated;

-- Un compte désactivé ne peut plus rien publier, proposer, écrire, etc. (déjà branché sur les politiques d'insertion).
create or replace function public.is_active_account(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
     and (uid is not distinct from auth.uid() or private.can_inspect_others())
     and not exists (select 1 from public.account_restrictions where user_id = uid)
     and not exists (select 1 from public.profiles where id = uid and deactivated_at is not null);
$$;

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles for select to anon, authenticated
  using (deactivated_at is null or id = (select auth.uid()) or (select public.is_staff()));

drop policy if exists products_hide_deactivated on public.products;
create policy products_hide_deactivated on public.products as restrictive for select to anon, authenticated
  using (seller_id = (select auth.uid()) or (select public.is_staff()) or not public.is_account_hidden(seller_id));

drop policy if exists wanted_requests_hide_deactivated on public.wanted_requests;
create policy wanted_requests_hide_deactivated on public.wanted_requests as restrictive for select to anon, authenticated
  using (author_id = (select auth.uid()) or (select public.is_staff()) or not public.is_account_hidden(author_id));

-- Messages d'inconnus (conversation sans annonce du destinataire) : respect du réglage du destinataire.
create or replace function public.accepts_conversation(p_recipient uuid, p_sender uuid, p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_account_hidden(p_recipient)
     and (
       coalesce((select pp.allow_stranger_messages from public.profile_private pp where pp.id = p_recipient), true)
       or exists (select 1 from public.products pr where pr.id = p_product and pr.seller_id = p_recipient)
       or exists (select 1 from public.profile_follows f where f.follower_id = p_sender and f.followee_id = p_recipient)
     );
$$;

revoke all on function public.accepts_conversation(uuid, uuid, uuid) from public;
grant execute on function public.accepts_conversation(uuid, uuid, uuid) to authenticated;

drop policy if exists conversations_respect_privacy on public.conversations;
create policy conversations_respect_privacy on public.conversations as restrictive for insert to authenticated
  with check (public.accepts_conversation(
    case when participant_one = (select auth.uid()) then participant_two else participant_one end,
    (select auth.uid()),
    product_id));

create or replace function public.deactivate_my_account(p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  perform public.assert_mfa();
  update public.profiles set deactivated_at = coalesce(deactivated_at, now()) where id = auth.uid();
  perform public.log_security_event(auth.uid(), 'account_deactivated',
    jsonb_build_object('reason', nullif(left(trim(coalesce(p_reason, '')), 300), '')));
end;
$$;

create or replace function public.reactivate_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  perform public.assert_mfa();
  update public.profiles set deactivated_at = null where id = auth.uid() and deactivated_at is not null;
  if found then
    perform public.log_security_event(auth.uid(), 'account_reactivated', '{}'::jsonb);
  end if;
end;
$$;

revoke all on function public.deactivate_my_account(text) from public, anon;
revoke all on function public.reactivate_my_account() from public, anon;
grant execute on function public.deactivate_my_account(text) to authenticated;
grant execute on function public.reactivate_my_account() to authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent integer;
begin
  if uid is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  perform public.assert_mfa();

  select count(*) into recent from public.security_logs
   where user_id = uid and event_type = 'data_exported' and created_at > now() - interval '1 hour';
  if recent >= 3 then
    raise exception 'Trop d''exports récents, réessayez dans une heure' using errcode = '54000';
  end if;
  perform public.log_security_event(uid, 'data_exported', '{}'::jsonb);

  return jsonb_build_object(
    'exported_at', now(),
    'note', 'Vos données personnelles sur CampusMarket. Les messages reçus d''autres personnes ne sont pas inclus.',
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'private', (select to_jsonb(pp) - 'id' from public.profile_private pp where pp.id = uid),
    'notification_preferences', (select coalesce(jsonb_agg(to_jsonb(x) - 'user_id'), '[]') from public.notification_preferences x where x.user_id = uid),
    'verification_requests', (select coalesce(jsonb_agg(to_jsonb(x) - 'document_paths'), '[]') from public.verification_requests x where x.user_id = uid),
    'devices', (select coalesce(jsonb_agg(to_jsonb(x) - 'device_fingerprint' - 'user_id'), '[]') from public.known_devices x where x.user_id = uid),
    'login_history', (select coalesce(jsonb_agg(jsonb_build_object('event', s.event_type, 'at', s.created_at, 'device', s.metadata ->> 'device')), '[]')
                        from public.security_logs s where s.user_id = uid and s.event_type in ('login_success','new_device_detected','password_changed','mfa_enabled','mfa_disabled','account_deactivated','account_reactivated','data_exported')),
    'listings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.products x where x.seller_id = uid),
    'favorites', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.product_favorites x where x.user_id = uid),
    'alerts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.product_alerts x where x.user_id = uid),
    'orders_as_buyer', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.orders x where x.buyer_id = uid),
    'orders_as_seller', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.orders x where x.seller_id = uid),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) - 'id'), '[]') from public.payments p join public.orders o on o.id = p.order_id where o.buyer_id = uid or o.seller_id = uid),
    'offers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.offers x where x.buyer_id = uid or x.seller_id = uid),
    'reservations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.reservations x where x.buyer_id = uid),
    'wanted_requests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.wanted_requests x where x.author_id = uid),
    'wanted_responses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.wanted_responses x where x.responder_id = uid),
    'reviews_given', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.seller_reviews x where x.reviewer_id = uid),
    'reviews_received', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.seller_reviews x where x.seller_id = uid),
    'following', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.profile_follows x where x.follower_id = uid),
    'followers_count', (select count(*) from public.profile_follows x where x.followee_id = uid),
    'blocked_users', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.blocked_users x where x.blocker_id = uid),
    'conversations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.conversations x where x.participant_one = uid or x.participant_two = uid),
    'messages_sent', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]')
                        from (select * from public.messages where sender_id = uid order by created_at desc limit 5000) m),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]')
                        from (select * from public.notifications where user_id = uid order by created_at desc limit 500) n),
    'support_tickets', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.support_tickets x where x.user_id = uid),
    'support_messages', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.support_ticket_messages x where x.sender_id = uid),
    'reports_made', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.reports x where x.reporter_id = uid),
    'event_tickets', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.event_tickets x where x.attendee_id = uid),
    'course_enrollments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.course_enrollments x where x.user_id = uid),
    'certificates', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.certificates x where x.user_id = uid),
    'communities', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.space_members x where x.user_id = uid),
    'community_posts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.space_posts x where x.author_id = uid),
    'community_comments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.space_post_comments x where x.author_id = uid),
    'exchanges', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.exchanges x where x.owner_id = uid or x.requester_id = uid),
    'group_purchases', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.group_purchase_participants x where x.buyer_id = uid)
  );
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
