-- =============================================================================
-- 0011 — Auth avancée : vérification téléphone par OTP, audit_logs et
-- security_logs (append-only), gestion contrôlée des rôles (RBAC), garde-fou
-- MFA pour les actions sensibles, détection de nouvel appareil à la connexion.
-- Réf. Backend_Hardened sections 9 (auth/sessions), 10 (MFA/2FA),
-- 11 (RBAC), 24 (audit/traçabilité).
--
-- Ce que cette migration NE refait PAS, volontairement : l'authentification
-- elle-même (email/mot de passe, magic link, rotation des refresh tokens,
-- récupération de compte) est nativement gérée par Supabase Auth (GoTrue) —
-- la réinventer en SQL serait moins sûr que ce que la plateforme fournit déjà.
-- Ce qui reste réellement à construire ici : la vérification d'un numéro
-- camerounais par OTP (aucun équivalent natif pour ce cas d'usage précis —
-- profile_private.phone_verified existe depuis 0003 mais rien ne le fait
-- passer à true), la traçabilité (sections 24), le contrôle serveur des
-- changements de rôle (actuellement impossible autrement que via service_role
-- à la main, cf. 0001 : "aucune policy insert/update/delete" sur user_roles),
-- et le renforcement MFA pour ces changements.
-- =============================================================================

-- RBAC complet : le cahier des charges (section 11) prévoit un gestionnaire
-- financier distinct de l'admin générique.
alter type public.app_role add value if not exists 'financial_manager';

-- -----------------------------------------------------------------------------
-- Aide de session : lit le niveau d'authentification (AAL) du JWT courant.
-- auth.jwt() est fourni nativement par Supabase (lit request.jwt.claims).
-- aal2 = l'utilisateur vient de repasser par son second facteur (TOTP) dans
-- cette session, pas seulement au moment de la connexion initiale.
-- -----------------------------------------------------------------------------
create or replace function public.session_aal()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

create or replace function public.has_mfa_session()
returns boolean
language sql
stable
as $$
  select public.session_aal() = 'aal2';
$$;

comment on function public.has_mfa_session is
  'Vrai seulement si la session courante a effectivement validé un second facteur (TOTP). Utilisé pour gater les actions sensibles (section 10 : changement de rôle, export financier, changement de sécurité).';

-- =============================================================================
-- AUDIT_LOGS et SECURITY_LOGS — deux journaux distincts et append-only
-- (section 24 : "security logs séparés" du reste). SECURITY_LOGS est plus
-- restreint (super_admin seulement) car il concerne login/OTP/MFA/rôles —
-- des événements dont la simple liste (qui s'est connecté, quand) est déjà
-- sensible, contrairement à l'audit général (qui a modifié quelle annonce).
-- =============================================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  result text not null check (result in ('success', 'failure')),
  request_id uuid,
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_resource_idx on public.audit_logs (resource_type, resource_id);

alter table public.audit_logs enable row level security;

create policy "audit_logs_select_admin"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

revoke update, delete on public.audit_logs from authenticated, anon, service_role;

create table public.security_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  event_type text not null check (event_type in (
    'login_success', 'login_failure', 'new_device_detected',
    'otp_requested', 'otp_verified', 'otp_failed', 'otp_expired',
    'mfa_enabled', 'mfa_disabled', 'mfa_challenge_success', 'mfa_challenge_failure',
    'password_changed', 'role_granted', 'role_revoked',
    'reauth_required', 'financial_export'
  )),
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index security_logs_user_idx on public.security_logs (user_id, created_at desc);

alter table public.security_logs enable row level security;

-- Plus restreint que audit_logs : super_admin uniquement (section 24, "accès
-- aux logs strictement restreint" — appliqué ici au niveau le plus strict
-- disponible puisqu'il s'agit des événements de sécurité eux-mêmes).
create policy "security_logs_select_super_admin"
  on public.security_logs for select
  to authenticated
  using (public.has_role('super_admin'));

revoke update, delete on public.security_logs from authenticated, anon, service_role;

comment on table public.security_logs is
  'Jamais de mot de passe, code OTP en clair, ou token dans metadata (section 24). Écriture uniquement via les fonctions SECURITY DEFINER de cette migration, jamais de policy insert authenticated.';

-- Helper interne réutilisé par plusieurs fonctions ci-dessous.
create or replace function public.log_audit(
  p_action text, p_resource_type text, p_resource_id uuid,
  p_result text, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, result, metadata)
  values (auth.uid(), p_action, p_resource_type, p_resource_id, p_result, p_metadata);
end;
$$;

create or replace function public.log_security_event(
  p_user_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb,
  p_ip inet default null, p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.security_logs (user_id, event_type, ip, user_agent, metadata)
  values (p_user_id, p_event_type, p_ip, p_user_agent, p_metadata);
end;
$$;

-- =============================================================================
-- GESTION CONTRÔLÉE DES RÔLES — jusqu'ici user_roles n'a AUCUNE policy
-- insert/update/delete (deny-all, cf. 0001) : aucune façon d'attribuer un
-- rôle sans passer par service_role à la main. On ferme ce trou avec deux
-- fonctions SECURITY DEFINER, seules portes d'entrée, avec :
-- - vérification du rôle appelant (admin, et super_admin pour les rôles les
--   plus élevés — pas d'auto-promotion latérale) ;
-- - exigence MFA (section 10 : "ré-authentification avant... modification de
--   rôle") ;
-- - garde-fou anti-auto-verrouillage sur le retrait de son propre rôle admin ;
-- - journalisation systématique (audit_logs + security_logs).
-- =============================================================================
create or replace function public.grant_role(p_user_id uuid, p_role public.app_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- IMPORTANT : ces cas sont retournés (jsonb success:false), jamais levés en
  -- RAISE EXCEPTION. Une exception annulerait tout l'effet de la fonction, y
  -- compris le log_audit qui vient d'être inséré juste avant (une exception
  -- annule TOUT ce qu'a fait l'appel, logs compris) — ce qui viderait
  -- silencieusement audit_logs de ses entrées "failure", l'inverse du but.
  if not public.is_admin() then
    perform public.log_audit('grant_role', 'user_roles', p_user_id, 'failure',
      jsonb_build_object('role', p_role, 'reason', 'not_admin'));
    return jsonb_build_object('success', false, 'error', 'not_admin');
  end if;

  if p_role in ('admin', 'super_admin') and not public.has_role('super_admin') then
    perform public.log_audit('grant_role', 'user_roles', p_user_id, 'failure',
      jsonb_build_object('role', p_role, 'reason', 'requires_super_admin'));
    return jsonb_build_object('success', false, 'error', 'requires_super_admin');
  end if;

  if not public.has_mfa_session() then
    perform public.log_audit('grant_role', 'user_roles', p_user_id, 'failure',
      jsonb_build_object('role', p_role, 'reason', 'mfa_required'));
    return jsonb_build_object('success', false, 'error', 'mfa_required');
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (p_user_id, p_role, auth.uid())
  on conflict (user_id, role) do nothing;

  perform public.log_security_event(auth.uid(), 'role_granted',
    jsonb_build_object('target_user', p_user_id, 'role', p_role));
  perform public.log_audit('grant_role', 'user_roles', p_user_id, 'success',
    jsonb_build_object('role', p_role));

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.revoke_role(p_user_id uuid, p_role public.app_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Même remarque que grant_role : jamais de RAISE EXCEPTION après un log,
  -- sous peine d'annuler ce log lui-même. Seul l'anti-auto-verrouillage reste
  -- en RAISE EXCEPTION plus bas, volontairement : c'est une erreur de
  -- programmation/usage (jamais un cas "normal" à auditer comme tentative
  -- refusée), donc pas besoin qu'elle survive à l'annulation.
  if not public.is_admin() then
    perform public.log_audit('revoke_role', 'user_roles', p_user_id, 'failure',
      jsonb_build_object('role', p_role, 'reason', 'not_admin'));
    return jsonb_build_object('success', false, 'error', 'not_admin');
  end if;

  if p_role in ('admin', 'super_admin') and not public.has_role('super_admin') then
    perform public.log_audit('revoke_role', 'user_roles', p_user_id, 'failure',
      jsonb_build_object('role', p_role, 'reason', 'requires_super_admin'));
    return jsonb_build_object('success', false, 'error', 'requires_super_admin');
  end if;

  if not public.has_mfa_session() then
    perform public.log_audit('revoke_role', 'user_roles', p_user_id, 'failure',
      jsonb_build_object('role', p_role, 'reason', 'mfa_required'));
    return jsonb_build_object('success', false, 'error', 'mfa_required');
  end if;

  if p_user_id = auth.uid() and p_role in ('admin', 'super_admin') then
    raise exception 'Impossible de retirer soi-même son propre rôle % (risque d''auto-verrouillage) : fais-le retirer par un autre super-administrateur', p_role;
  end if;

  delete from public.user_roles where user_id = p_user_id and role = p_role;

  perform public.log_security_event(auth.uid(), 'role_revoked',
    jsonb_build_object('target_user', p_user_id, 'role', p_role));
  perform public.log_audit('revoke_role', 'user_roles', p_user_id, 'success',
    jsonb_build_object('role', p_role));

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.grant_role(uuid, public.app_role) to authenticated;
grant execute on function public.revoke_role(uuid, public.app_role) to authenticated;

-- =============================================================================
-- DÉTECTION DE NOUVEL APPAREIL — section 9 : "détection des connexions
-- inhabituelles... nouveaux appareils". Le frontend appelle record_login()
-- juste après une connexion réussie (Supabase Auth ne notifie pas nativement
-- la base d'un login) avec une empreinte d'appareil qu'il génère lui-même
-- (ex. fingerprintjs ou un identifiant stocké en local storage).
-- =============================================================================
create table public.known_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_fingerprint text not null check (char_length(device_fingerprint) between 8 and 200),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_fingerprint)
);

alter table public.known_devices enable row level security;

create policy "known_devices_select_own"
  on public.known_devices for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Pas de policy insert/update : seule record_login() (SECURITY DEFINER)
-- écrit ici, pour que la détection "nouveau" vs "connu" ne dépende jamais
-- d'un état que le client pourrait falsifier lui-même.

create or replace function public.record_login(
  p_device_fingerprint text, p_ip inet default null, p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_known boolean;
begin
  select exists(
    select 1 from public.known_devices
    where user_id = auth.uid() and device_fingerprint = p_device_fingerprint
  ) into v_known;

  insert into public.known_devices (user_id, device_fingerprint)
  values (auth.uid(), p_device_fingerprint)
  on conflict (user_id, device_fingerprint) do update set last_seen_at = now();

  perform public.log_security_event(auth.uid(), 'login_success',
    jsonb_build_object('new_device', not v_known), p_ip, p_user_agent);

  if not v_known then
    perform public.log_security_event(auth.uid(), 'new_device_detected', '{}'::jsonb, p_ip, p_user_agent);
  end if;

  return jsonb_build_object('new_device', not v_known);
end;
$$;

grant execute on function public.record_login(text, inet, text) to authenticated;

comment on function public.record_login is
  'À appeler côté frontend juste après une connexion réussie. Le "nouveau device" retourné est une donnée à afficher/notifier, pas un blocage automatique : section 9 parle de détection par règles, pas d''un verrouillage strict qui bloquerait un utilisateur légitime avec un nouveau téléphone.';

-- =============================================================================
-- VÉRIFICATION DE TÉLÉPHONE PAR OTP — fait passer profile_private.phone
-- /phone_verified de 0003_identity.sql à un état réellement vérifié. Jamais
-- le code en clair nulle part (colonne, log, metadata) : seul son hash.
-- =============================================================================
create table public.phone_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  phone text not null check (phone ~ '^\+237[26]\d{8}$'),
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index phone_verification_active_idx on public.phone_verification_codes (user_id, phone)
  where consumed_at is null;

alter table public.phone_verification_codes enable row level security;
-- Aucune policy : verrouillé même pour son propre propriétaire (il ne connaît
-- que le code reçu par SMS, jamais besoin de relire le hash). Écriture et
-- lecture réservées à service_role, depuis phone-otp-request/phone-otp-verify.

comment on table public.phone_verification_codes is
  'code_hash uniquement (jamais le code en clair). Écrit/lu exclusivement par les Edge Functions phone-otp-request / phone-otp-verify via service_role.';
