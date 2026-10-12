-- 0039 — Double authentification (TOTP) imposée par la base pour TOUS les comptes qui l'ont activée
--
-- Pourquoi côté base : une étape « code » dans l'interface seule se contourne avec le jeton obtenu par mot de passe
-- (appel direct à l'API). Ici, un compte ayant un facteur TOTP vérifié n'a accès à rien tant que son jeton n'est pas
-- aal2 (c.-à-d. tant que le code n'a pas été saisi dans cette session).
--
-- * mfa_ok() : vrai si le jeton est aal2, ou si le compte n'a aucun facteur TOTP vérifié
-- * assert_mfa() : même contrôle pour les fonctions SECURITY DEFINER (qui contournent la RLS)
-- * policy RESTRICTIVE « mfa_required » sur toutes les tables à RLS (sauf catalogues publics) et sur storage.objects
-- * admin_reset_user_mfa() : un admin (aal2) retire les facteurs d'un utilisateur qui a perdu son téléphone
--   (Supabase n'a pas de codes de secours).

create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.session_aal() = 'aal2'
      or auth.uid() is null
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.factor_type = 'totp' and f.status = 'verified'
      );
$$;

revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

create or replace function public.assert_mfa()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.mfa_ok() then
    raise exception 'Double authentification requise' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_mfa() from public, anon;
grant execute on function public.assert_mfa() to authenticated;

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname not in ('countries', 'universities', 'categories', 'course_categories', 'event_categories',
                            'faq_categories', 'faq_items', 'space_categories')
  loop
    execute format('drop policy if exists mfa_required on public.%I', t.relname);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))',
      t.relname);
  end loop;
end $$;

drop policy if exists mfa_required on storage.objects;
create policy mfa_required on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Fonctions du compte (SECURITY DEFINER) : même exigence.
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
  perform public.assert_mfa();

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

create or replace function public.my_login_history(p_limit integer default 30)
returns table (id uuid, event_type text, device text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_mfa();
  return query
    select s.id, s.event_type, s.metadata ->> 'device', s.created_at
    from public.security_logs s
    where s.user_id = auth.uid()
      and s.event_type in ('login_success', 'new_device_detected', 'password_changed', 'mfa_enabled', 'mfa_disabled')
      and s.created_at > now() - interval '30 days'
    order by s.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

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
  perform public.assert_mfa();
  if p_event not in ('password_changed', 'mfa_enabled', 'mfa_disabled') then
    raise exception 'Événement non autorisé' using errcode = '42501';
  end if;
  perform public.log_security_event(auth.uid(), p_event, '{}'::jsonb);
end;
$$;

-- Appareil perdu : un admin (session aal2) retire les facteurs TOTP d'un utilisateur ; il se reconnecte alors avec son
-- seul mot de passe et peut réactiver la 2FA. Journalisé (audit + journal de sécurité de l'intéressé).
create or replace function public.admin_reset_user_mfa(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_count integer;
begin
  if not public.act_as_admin() then
    return public.internal_admin_fail('reset_user_mfa', 'profile', p_user_id, 'forbidden');
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    return public.internal_admin_fail('reset_user_mfa', 'profile', p_user_id, 'reason_required');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return public.internal_admin_fail('reset_user_mfa', 'profile', p_user_id, 'not_found');
  end if;

  delete from auth.mfa_factors where user_id = p_user_id and factor_type = 'totp';
  get diagnostics v_count = row_count;

  perform public.log_security_event(p_user_id, 'mfa_disabled', jsonb_build_object('reset_by_admin', true));
  perform public.log_audit('reset_user_mfa', 'profile', p_user_id, 'success',
    jsonb_build_object('factors_removed', v_count, 'reason', left(trim(p_reason), 300)));
  return jsonb_build_object('success', true, 'factors_removed', v_count);
end;
$$;

revoke all on function public.admin_reset_user_mfa(uuid, text) from public, anon;
grant execute on function public.admin_reset_user_mfa(uuid, text) to authenticated;
