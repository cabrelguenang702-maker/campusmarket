-- 0038 — Profil, vérification, sécurité du compte
-- * profiles : filière et niveau (affichés sur le profil, absents jusqu'ici)
-- * avatars : bucket PUBLIC. Un avatar est déjà public (profiles est lisible par anon) et son URL est copiée dans
--   les annonces, la messagerie, etc. : une URL signée expirerait. Écriture toujours limitée au dossier <uid>/.
-- * known_devices.label : nom lisible de l'appareil (navigateur / système) pour l'écran « Appareils »
-- * record_login(fingerprint, ip, user_agent, label) : remplace la version à 3 arguments
-- * my_login_history() : l'utilisateur lit SES événements de connexion (security_logs reste réservé au super_admin)
-- * log_my_security_event() : journalise changement de mot de passe / activation ou retrait de la 2FA

alter table public.profiles
  add column if not exists filiere text check (filiere is null or char_length(filiere) <= 80),
  add column if not exists niveau text check (niveau is null or char_length(niveau) <= 40);

update storage.buckets set public = true where id = 'avatars';

alter table public.known_devices
  add column if not exists label text check (label is null or char_length(label) <= 120);

drop function if exists public.record_login(text, inet, text);

create or replace function public.record_login(
  p_device_fingerprint text, p_ip inet default null, p_user_agent text default null, p_label text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_known boolean;
  v_label text := nullif(left(trim(coalesce(p_label, '')), 120), '');
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.known_devices
    where user_id = auth.uid() and device_fingerprint = p_device_fingerprint
  ) into v_known;

  insert into public.known_devices (user_id, device_fingerprint, label)
  values (auth.uid(), p_device_fingerprint, v_label)
  on conflict (user_id, device_fingerprint)
  do update set last_seen_at = now(), label = coalesce(excluded.label, public.known_devices.label);

  perform public.log_security_event(auth.uid(), 'login_success',
    jsonb_build_object('new_device', not v_known, 'device', v_label), p_ip, p_user_agent);

  if not v_known then
    perform public.log_security_event(auth.uid(), 'new_device_detected', '{}'::jsonb, p_ip, p_user_agent);
  end if;

  return jsonb_build_object('new_device', not v_known);
end;
$$;

revoke all on function public.record_login(text, inet, text, text) from public, anon;
grant execute on function public.record_login(text, inet, text, text) to authenticated;

create or replace function public.my_login_history(p_limit integer default 30)
returns table (id uuid, event_type text, device text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.event_type, s.metadata ->> 'device', s.created_at
  from public.security_logs s
  where s.user_id = auth.uid()
    and s.event_type in ('login_success', 'new_device_detected', 'password_changed', 'mfa_enabled', 'mfa_disabled')
    and s.created_at > now() - interval '30 days'
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function public.my_login_history(integer) from public, anon;
grant execute on function public.my_login_history(integer) to authenticated;

create or replace function public.log_my_security_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  if p_event not in ('password_changed', 'mfa_enabled', 'mfa_disabled') then
    raise exception 'Événement non autorisé' using errcode = '42501';
  end if;
  perform public.log_security_event(auth.uid(), p_event, '{}'::jsonb);
end;
$$;

revoke all on function public.log_my_security_event(text) from public, anon;
grant execute on function public.log_my_security_event(text) to authenticated;
