-- =============================================================================
-- 0071 — Notifications push (OneSignal ou Web Push natif).
--
-- Principe : le push prolonge la notification dans l'application. Un déclencheur sur
-- `notifications` place un message dans `notification_push_queue` quand (1) la
-- notification n'a pas été créée déjà lue (donc la catégorie est active dans l'app pour
-- cet utilisateur : le réglage « Dans l'app » fait foi) et (2) l'utilisateur a au moins un
-- appareil abonné. L'Edge Function `push-dispatch` vide ensuite la file.
-- `create_notification` n'est PAS modifiée. Le déclencheur avale ses erreurs : un
-- problème de push ne doit jamais empêcher la création d'une notification.
--
-- Un seul fournisseur actif à la fois (variable PUSH_PROVIDER côté fonction, VITE_PUSH_PROVIDER
-- côté application) : 'onesignal' (l'appareil est rattaché à l'utilisateur par external_id,
-- aucune clé stockée ici) ou 'webpush' (endpoint + clés de l'abonnement stockés ici).
-- =============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('onesignal', 'webpush')),
  endpoint text,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (
    (provider = 'webpush' and endpoint is not null and p256dh is not null and auth is not null)
    or (provider = 'onesignal' and endpoint is null and p256dh is null and auth is null)
  )
);

create unique index push_subscriptions_webpush_endpoint_key on public.push_subscriptions (endpoint) where provider = 'webpush';
create unique index push_subscriptions_onesignal_user_key on public.push_subscriptions (user_id) where provider = 'onesignal';
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Lecture et suppression de ses propres appareils ; l'ajout passe uniquement par la fonction ci-dessous.
create policy "push_subscriptions_select_own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "push_subscriptions_delete_own" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

create table public.notification_push_queue (
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

create index notification_push_queue_pending_idx on public.notification_push_queue (created_at) where status = 'pending';

alter table public.notification_push_queue enable row level security;
-- Aucune policy : deny-all pour authenticated/anon (service_role uniquement, comme la file e-mail).

-- -----------------------------------------------------------------------------
-- Abonner / désabonner l'appareil courant.
-- -----------------------------------------------------------------------------
create or replace function public.register_push_subscription(
  p_provider text,
  p_endpoint text default null,
  p_p256dh text default null,
  p_auth text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_ua text := left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300);
begin
  if v_uid is null or not public.is_active_account() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_provider not in ('onesignal', 'webpush') then
    return jsonb_build_object('success', false, 'error', 'invalid_provider');
  end if;

  if p_provider = 'webpush' then
    if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000
       or p_p256dh is null or char_length(p_p256dh) not between 20 and 200
       or p_auth is null or char_length(p_auth) not between 8 and 100 then
      return jsonb_build_object('success', false, 'error', 'invalid_subscription');
    end if;
    select count(*) into v_count from public.push_subscriptions
      where user_id = v_uid and not (provider = 'webpush' and endpoint = p_endpoint);
    if v_count >= 10 then
      return jsonb_build_object('success', false, 'error', 'too_many_devices');
    end if;
    -- Un appareil partagé passe d'un compte à l'autre : l'abonnement suit le dernier compte connecté.
    insert into public.push_subscriptions (user_id, provider, endpoint, p256dh, auth, user_agent)
    values (v_uid, 'webpush', p_endpoint, p_p256dh, p_auth, v_ua)
    on conflict (endpoint) where provider = 'webpush'
    do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
                  user_agent = excluded.user_agent, last_seen_at = now();
  else
    insert into public.push_subscriptions (user_id, provider, user_agent)
    values (v_uid, 'onesignal', v_ua)
    on conflict (user_id) where provider = 'onesignal'
    do update set user_agent = excluded.user_agent, last_seen_at = now();
  end if;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.remove_push_subscription(p_provider text, p_endpoint text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_provider = 'webpush' then
    delete from public.push_subscriptions where user_id = v_uid and provider = 'webpush' and endpoint = p_endpoint;
  elsif p_provider = 'onesignal' then
    delete from public.push_subscriptions where user_id = v_uid and provider = 'onesignal';
  else
    return jsonb_build_object('success', false, 'error', 'invalid_provider');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Déclencheur : notification créée non lue + au moins un appareil abonné => file d'envoi.
-- (Une notification dédupliquée — mise à jour d'une ligne existante — ne renvoie pas de push.)
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.read_at is null and exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    insert into public.notification_push_queue (notification_id, user_id)
    values (new.id, new.user_id)
    on conflict (notification_id) do nothing;
  end if;
  return new;
exception when others then
  raise warning 'enqueue_push_notification a échoué: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_push_notification() from public, anon, authenticated;

create trigger notifications_enqueue_push
  after insert on public.notifications
  for each row execute function public.enqueue_push_notification();
