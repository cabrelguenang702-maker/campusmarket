-- =============================================================================
-- 0020 — Back-office admin
-- Réf. Backend_Hardened sections 10 (MFA sur actions sensibles), 20 (modération),
-- 24 (audit), 36 (ne jamais faire confiance au front), 43 (RLS) ; front : /admin/*
--
-- Principe directeur (leçon de 0008/0014/0011) : les TRIGGERS et les fonctions
-- SECURITY DEFINER sont l'autorité sur qui peut faire quoi ; les policies RLS ne
-- sont qu'un filtre grossier. Toute action admin passe donc par une fonction
-- `admin_*` qui (1) vérifie le rôle ET que le compte appelant n'est pas lui-même
-- restreint, (2) journalise dans audit_logs, y compris les REFUS, en renvoyant
-- {success:false,error} plutôt qu'en levant une exception (une exception annule
-- le log — bug déjà rencontré en 0011).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FERMETURE DE TROUS EXISTANTS (trouvés en listant les fonctions SECURITY
--    DEFINER exécutables par `anon`/`authenticated` : sur Supabase, les droits par
--    défaut donnent EXECUTE à tout le monde sur toute nouvelle fonction de `public`,
--    donc chacune est appelable via /rpc/<nom> — même sans connexion).
--    - log_audit / log_security_event : n'importe qui pouvait FORGER des lignes
--      d'audit ou de sécurité (acteur = soi, action et métadonnées au choix,
--      user_id de journal de sécurité = n'importe quel utilisateur).
--    - expire_stale_* / send_event_reminders : tâches de cron déclenchables à la
--      demande par n'importe quel client.
--    Aucun appelant légitime côté client : le front n'appelle aucun .rpc() sur
--    ces fonctions ; pg_cron s'exécute en `postgres` et les fonctions DEFINER
--    s'exécutent sous leur propriétaire (qui garde le droit).
-- -----------------------------------------------------------------------------
revoke execute on function public.log_audit(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.log_security_event(uuid, text, jsonb, inet, text) from public, anon, authenticated;
revoke execute on function public.expire_stale_offers() from public, anon, authenticated;
revoke execute on function public.expire_stale_reservations() from public, anon, authenticated;
revoke execute on function public.expire_stale_tickets() from public, anon, authenticated;
revoke execute on function public.send_event_reminders() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. AIDES D'AUTORISATION
-- -----------------------------------------------------------------------------
-- financial_manager (0011) n'est PAS couvert par is_staff() : il accède au
-- back-office uniquement pour la partie financière du tableau de bord.
create or replace function public.has_back_office_access(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid
      and role in ('moderator', 'support', 'admin', 'super_admin', 'financial_manager')
  );
$$;

-- Hiérarchie : on n'agit jamais sur un compte de rang égal ou supérieur au sien
-- (un modérateur ne suspend pas un autre modérateur ni un admin ; un admin ne
-- bannit pas un super_admin).
create or replace function public.staff_rank(uid uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(case role
    when 'super_admin' then 4
    when 'admin' then 3
    when 'moderator' then 2
    when 'support' then 2
    when 'financial_manager' then 2
    else 0
  end), 0)
  from public.user_roles
  where user_id = uid;
$$;

-- Un compte suspendu/banni n'a plus aucun pouvoir, staff compris.
create table public.account_restrictions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null check (status in ('suspended', 'banned')),
  reason text not null check (char_length(reason) between 3 and 500),
  restricted_by uuid references public.profiles (id) on delete set null,
  restricted_at timestamptz not null default now()
);

alter table public.account_restrictions enable row level security;

-- Table séparée de `profiles` (publique) : RLS filtre des lignes, jamais des
-- colonnes, donc un motif de sanction posé sur profiles aurait été lisible par
-- tout le monde. Ici : l'intéressé voit sa propre sanction (il doit pouvoir la
-- comprendre et la contester via le support), le staff voit tout, personne n'écrit
-- côté client (aucune policy insert/update/delete — seules les fonctions admin_*).
create policy "account_restrictions_select_own_or_staff"
  on public.account_restrictions for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

comment on table public.account_restrictions is
  'Absence de ligne = compte actif. Écriture exclusivement par admin_suspend_user / admin_ban_user / admin_reactivate_user.';

create or replace function public.is_active_account(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
     and not exists (select 1 from public.account_restrictions where user_id = uid);
$$;

create or replace function public.act_as_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and public.is_active_account();
$$;

create or replace function public.act_as_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and public.is_active_account();
$$;

create or replace function public.act_as_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select (public.has_role('moderator') or public.is_admin()) and public.is_active_account();
$$;

create or replace function public.act_as_support() returns boolean
language sql stable security definer set search_path = public as $$
  select (public.has_role('support') or public.is_admin()) and public.is_active_account();
$$;

-- Journalise un refus et renvoie le résultat structuré (jamais d'exception ici).
create or replace function public.internal_admin_fail(
  p_action text, p_resource_type text, p_resource_id uuid, p_error text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_audit(p_action, p_resource_type, p_resource_id, 'failure',
    p_metadata || jsonb_build_object('reason', p_error));
  return jsonb_build_object('success', false, 'error', p_error);
end;
$$;

-- Le CHECK de security_logs (0011) liste les types d'événements autorisés ; les
-- bannissements/levées en sont absents. On le recrée avec ces deux types.
alter table public.security_logs drop constraint security_logs_event_type_check;
alter table public.security_logs add constraint security_logs_event_type_check check (event_type in (
  'login_success', 'login_failure', 'new_device_detected',
  'otp_requested', 'otp_verified', 'otp_failed', 'otp_expired',
  'mfa_enabled', 'mfa_disabled', 'mfa_challenge_success', 'mfa_challenge_failure',
  'password_changed', 'role_granted', 'role_revoked',
  'reauth_required', 'financial_export',
  'account_banned', 'account_unbanned'
));

-- -----------------------------------------------------------------------------
-- 3. SUSPENSION / BANNISSEMENT : EFFET RÉEL
--    "Suspendu" = lecture seule + accès au support (pour contester). Appliqué par
--    des policies RESTRICTIVE (combinées en ET avec les policies existantes, donc
--    sans réécrire aucune des 25 policies d'insertion déjà validées). Exclus
--    volontairement : support_* (contester une sanction), reports, blocked_users.
--    Un bannissement ajoute auth.users.banned_until (refus de connexion et de
--    rafraîchissement de jeton) ; le JWT déjà émis reste valide jusqu'à son
--    expiration, mais ces policies bloquent déjà ses écritures immédiatement.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'orders', 'group_purchase_participants', 'offers', 'reservations',
    'exchanges', 'conversations', 'messages', 'courses', 'course_enrollments',
    'module_progress', 'course_reviews', 'spaces', 'space_members',
    'space_membership_requests', 'space_posts', 'space_post_comments', 'events',
    'event_tickets', 'university_suggestions'
  ] loop
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (public.is_active_account())',
      t || '_active_account_insert', t);
  end loop;
end $$;

create policy "products_active_account_update"
  on public.products as restrictive for update
  to authenticated
  using (public.is_active_account())
  with check (public.is_active_account());

-- -----------------------------------------------------------------------------
-- 4. PROTECTION DES COLONNES DE CONFIANCE / MODÉRATION
--    Même mécanisme que protect_space_moderation_columns (0014) : un trigger
--    BEFORE UPDATE qui voit OLD/NEW ; current_user vaut le propriétaire de la
--    fonction à l'intérieur d'un SECURITY DEFINER, 'authenticated'/'anon' sinon.
-- -----------------------------------------------------------------------------

-- profiles.verified : jusqu'ici protégé seulement contre l'utilisateur lui-même
-- (profiles_update_own) ; profiles_admin_update laissait n'importe quel membre du
-- staff — support compris — le changer par un UPDATE direct, sans trace.
create or replace function public.protect_profile_trust_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at)
     and current_user in ('authenticated', 'anon') then
    raise exception 'La vérification d''un compte ne se modifie que via admin_review_verification / admin_verify_user';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_trust
  before update on public.profiles
  for each row execute function public.protect_profile_trust_columns();

-- products : un vendeur dont l'annonce a été RETIRÉE pouvait (a) la repasser lui-même
-- en pending_review/draft (policy products_update_own : status <> 'published'
-- seulement) et (b) réécrire moderation_reason. Et tout staff pouvait publier/
-- retirer par UPDATE direct, hors audit. Désormais published/removed et le motif
-- ne bougent que via admin_set_listing_status.
create or replace function public.protect_product_moderation()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.moderation_reason is distinct from old.moderation_reason then
      raise exception 'Le motif de modération ne se modifie que via admin_set_listing_status';
    end if;
    if new.status is distinct from old.status
       and (old.status = 'removed' or new.status in ('removed', 'published')) then
      raise exception 'Les statuts published/removed d''une annonce ne se modifient que via admin_set_listing_status';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_protect_moderation
  before update on public.products
  for each row execute function public.protect_product_moderation();

-- reports : reports_staff_update laissait le staff réécrire n'importe quelle
-- colonne (reporter_id, reason, target_id...) — donc falsifier un signalement.
-- Plus aucune policy UPDATE : seul admin_handle_report modifie status/handled_by/
-- resolution_note.
drop policy "reports_staff_update" on public.reports;

-- -----------------------------------------------------------------------------
-- 5. AUDIT AUTOMATIQUE DES TABLES DE RÉFÉRENTIEL (pays, universités)
--    Ces tables s'écrivent par policy `is_admin()` (0002) — donc sans fonction pour
--    journaliser. Un trigger AFTER s'en charge, sans rien changer au chemin d'écriture.
-- -----------------------------------------------------------------------------
create or replace function public.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_id uuid;
  v_meta jsonb;
begin
  -- Opérations de maintenance (seed, migrations) : pas de bruit dans le journal.
  -- session_user et non current_user : à l'intérieur d'un SECURITY DEFINER,
  -- current_user vaut toujours le propriétaire de la fonction. session_user est
  -- la connexion réelle (postgres en direct ; 'authenticator' via l'API, où
  -- service_role reste donc journalisé).
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then
    return null;
  end if;

  begin
    v_id := (v_row ->> 'id')::uuid;
  exception when others then
    v_id := null;   -- ex. countries : clé = code ISO, pas un uuid
  end;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_meta
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_meta = '{}'::jsonb then
      return null;
    end if;
    v_meta := jsonb_build_object('table', tg_table_name, 'changes', v_meta, 'key', v_row ->> 'code');
  else
    v_meta := jsonb_build_object('table', tg_table_name, 'row', v_row);
  end if;

  perform public.log_audit(tg_table_name || '.' || lower(tg_op), tg_table_name, v_id, 'success', v_meta);
  return null;
end;
$$;

create trigger audit_countries
  after insert or update or delete on public.countries
  for each row execute function public.audit_table_change();

create trigger audit_universities
  after insert or update or delete on public.universities
  for each row execute function public.audit_table_change();

-- profiles.university_id est "on delete set null" : supprimer une université
-- détacherait silencieusement tous ses étudiants. On force la désactivation
-- (universities.active = false), qui est d'ailleurs le "retrait" du front.
create or replace function public.prevent_university_delete_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where university_id = old.id) then
    raise exception 'Cette université a des étudiants rattachés : désactive-la (active = false) au lieu de la supprimer';
  end if;
  return old;
end;
$$;

create trigger universities_prevent_delete_in_use
  before delete on public.universities
  for each row execute function public.prevent_university_delete_in_use();

create view public.cities_overview with (security_invoker = true) as
select u.city, u.country_code, count(*) filter (where u.active) as universities_count
from public.universities u
group by u.city, u.country_code;

comment on view public.cities_overview is
  'Onglet Villes de /admin/geographie (lecture seule). security_invoker : la RLS de universities s''applique.';

-- -----------------------------------------------------------------------------
-- 6. GESTION DES UTILISATEURS
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_search text default null,
  p_status text default null,        -- 'active' | 'suspended' | 'banned'
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, full_name text, email text, campus text, account_status text,
  verified boolean, joined_at timestamptz, listings_count bigint, reports_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_pattern text;
  v_full_email boolean;
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'banned') then
    raise exception 'Statut inconnu' using errcode = '22023';
  end if;

  -- Les modérateurs n'ont pas besoin de l'adresse complète : masquée (g***@domaine).
  v_full_email := public.is_admin() or public.has_role('support');
  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(left(v_search, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    p.id,
    p.full_name,
    case when v_full_email then pp.email::text
         else regexp_replace(pp.email::text, '^(.).*(@.*)$', '\1***\2') end,
    p.campus,
    coalesce(r.status, 'active'),
    p.verified,
    p.created_at,
    (select count(*) from public.products x where x.seller_id = p.id and x.deleted_at is null),
    (select count(*) from public.reports rp
       where rp.target_type = 'profile' and rp.target_id = p.id and rp.status <> 'dismissed'),
    count(*) over ()
  from public.profiles p
  join public.profile_private pp on pp.id = p.id
  left join public.account_restrictions r on r.user_id = p.id
  where (p_status is null or coalesce(r.status, 'active') = p_status)
    and (v_pattern is null or p.full_name ilike v_pattern or pp.email::text ilike v_pattern)
  order by p.created_at desc, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_suspend_user(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.act_as_staff() then
    return public.internal_admin_fail('suspend_user', 'profile', p_user_id, 'forbidden');
  end if;
  if p_user_id = auth.uid() then
    return public.internal_admin_fail('suspend_user', 'profile', p_user_id, 'cannot_target_self');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return public.internal_admin_fail('suspend_user', 'profile', p_user_id, 'not_found');
  end if;
  if public.staff_rank() <= public.staff_rank(p_user_id) then
    return public.internal_admin_fail('suspend_user', 'profile', p_user_id, 'insufficient_rank');
  end if;
  if char_length(v_reason) < 3 then
    return public.internal_admin_fail('suspend_user', 'profile', p_user_id, 'reason_required');
  end if;
  if exists (select 1 from public.account_restrictions where user_id = p_user_id and status = 'banned') then
    return public.internal_admin_fail('suspend_user', 'profile', p_user_id, 'already_banned');
  end if;

  insert into public.account_restrictions (user_id, status, reason, restricted_by)
  values (p_user_id, 'suspended', left(v_reason, 500), auth.uid())
  on conflict (user_id) do update
    set status = 'suspended', reason = excluded.reason,
        restricted_by = excluded.restricted_by, restricted_at = now();

  perform public.create_notification(p_user_id, 'securite', 'account_suspended', auth.uid(), 'profile', p_user_id);
  perform public.log_audit('suspend_user', 'profile', p_user_id, 'success', jsonb_build_object('reason', v_reason));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_ban_user(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.act_as_admin() then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'forbidden');
  end if;
  if not public.has_mfa_session() then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'mfa_required');
  end if;
  if p_user_id = auth.uid() then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'cannot_target_self');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'not_found');
  end if;
  if public.staff_rank() <= public.staff_rank(p_user_id) then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'insufficient_rank');
  end if;
  if char_length(v_reason) < 3 then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'reason_required');
  end if;
  if exists (select 1 from public.account_restrictions where user_id = p_user_id and status = 'banned') then
    return public.internal_admin_fail('ban_user', 'profile', p_user_id, 'already_banned');
  end if;

  insert into public.account_restrictions (user_id, status, reason, restricted_by)
  values (p_user_id, 'banned', left(v_reason, 500), auth.uid())
  on conflict (user_id) do update
    set status = 'banned', reason = excluded.reason,
        restricted_by = excluded.restricted_by, restricted_at = now();

  -- Refus de connexion/rafraîchissement côté Supabase Auth (GoTrue lit banned_until).
  update auth.users set banned_until = 'infinity' where id = p_user_id;
  -- Révocation des sessions ouvertes : best-effort (la table peut être absente en
  -- local, ou inaccessible selon le rôle) — les policies bloquent déjà les écritures.
  begin
    delete from auth.sessions where user_id = p_user_id;
  exception when undefined_table or insufficient_privilege then
    raise notice 'auth.sessions inaccessible : sessions non révoquées (banned_until posé)';
  end;

  perform public.log_security_event(p_user_id, 'account_banned', jsonb_build_object('by', auth.uid()));
  perform public.log_audit('ban_user', 'profile', p_user_id, 'success', jsonb_build_object('reason', v_reason));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_reactivate_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.act_as_staff() then
    return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'forbidden');
  end if;
  if p_user_id = auth.uid() then
    return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'cannot_target_self');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'not_found');
  end if;
  select status into v_status from public.account_restrictions where user_id = p_user_id;
  if v_status is null then
    return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'not_restricted');
  end if;
  if public.staff_rank() <= public.staff_rank(p_user_id) then
    return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'insufficient_rank');
  end if;
  -- Lever un bannissement est aussi lourd que le poser : admin + MFA.
  if v_status = 'banned' then
    if not public.act_as_admin() then
      return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'forbidden', jsonb_build_object('was', v_status));
    end if;
    if not public.has_mfa_session() then
      return public.internal_admin_fail('reactivate_user', 'profile', p_user_id, 'mfa_required', jsonb_build_object('was', v_status));
    end if;
    update auth.users set banned_until = null where id = p_user_id;
    perform public.log_security_event(p_user_id, 'account_unbanned', jsonb_build_object('by', auth.uid()));
  end if;

  delete from public.account_restrictions where user_id = p_user_id;
  perform public.create_notification(p_user_id, 'securite', 'account_reactivated', auth.uid(), 'profile', p_user_id);
  perform public.log_audit('reactivate_user', 'profile', p_user_id, 'success', jsonb_build_object('was', v_status));
  return jsonb_build_object('success', true);
end;
$$;

-- Vérification manuelle (hors demande de document) : admin seulement.
create or replace function public.admin_verify_user(p_user_id uuid, p_verified boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.act_as_admin() then
    return public.internal_admin_fail('verify_user', 'profile', p_user_id, 'forbidden');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return public.internal_admin_fail('verify_user', 'profile', p_user_id, 'not_found');
  end if;

  update public.profiles
     set verified = coalesce(p_verified, false),
         verified_at = case when coalesce(p_verified, false) then now() else null end
   where id = p_user_id;

  perform public.log_audit('verify_user', 'profile', p_user_id, 'success', jsonb_build_object('verified', coalesce(p_verified, false)));
  return jsonb_build_object('success', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. VÉRIFICATION DE COMPTE (workflow utilisateur -> staff)
--    Le front (écrans 151-160 : choix du document, recto/verso, en cours,
--    réussie, refusée, nouvelle vérification) n'avait AUCUN backend : seule
--    échappatoire, un UPDATE direct de profiles.verified par le staff.
-- -----------------------------------------------------------------------------
create type public.verification_document as enum ('student_card', 'other_document');
create type public.verification_status as enum ('pending', 'approved', 'rejected');

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_type public.verification_document not null,
  document_paths text[] not null check (cardinality(document_paths) between 1 and 2),
  status public.verification_status not null default 'pending',
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) between 3 and 500),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'rejected') = (rejection_reason is not null))
);

-- Une seule demande en cours par utilisateur ; une nouvelle demande reste
-- possible après un refus ("nouvelle vérification").
create unique index verification_requests_one_pending
  on public.verification_requests (user_id) where status = 'pending';
create index verification_requests_status_idx on public.verification_requests (status, created_at);

alter table public.verification_requests enable row level security;

create policy "verification_requests_select_own_or_staff"
  on public.verification_requests for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Les fichiers doivent être dans le dossier de l'utilisateur (<user_id>/<fichier>),
-- sinon la policy Storage ne retrouverait pas le propriétaire ; un compte déjà
-- vérifié n'a pas à redéposer de document. Aucune policy update/delete : le
-- traitement passe par admin_review_verification.
create policy "verification_requests_insert_own"
  on public.verification_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and reviewed_by is null and reviewed_at is null and rejection_reason is null
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.verified)
    and not exists (
      select 1 from unnest(document_paths) as path
      where path not like auth.uid()::text || '/%'
    )
  );

insert into storage.buckets (id, name, public)
values ('verification-documents', 'verification-documents', false)
on conflict (id) do nothing;

create policy "verification_documents_select_own_or_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'verification-documents'
    and (public.is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy "verification_documents_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_account()
  );

create or replace function public.admin_list_verifications(
  p_status public.verification_status default 'pending',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, user_id uuid, full_name text, document_type public.verification_document,
  document_paths text[], status public.verification_status, rejection_reason text,
  created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select v.id, v.user_id, p.full_name, v.document_type, v.document_paths, v.status,
         v.rejection_reason, v.created_at, count(*) over ()
  from public.verification_requests v
  join public.profiles p on p.id = v.user_id
  where (p_status is null or v.status = p_status)
  order by v.created_at
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_review_verification(
  p_request_id uuid, p_approve boolean, p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.verification_requests;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.act_as_staff() then
    return public.internal_admin_fail('review_verification', 'verification_request', p_request_id, 'forbidden');
  end if;
  select * into v_req from public.verification_requests where id = p_request_id for update;
  if not found then
    return public.internal_admin_fail('review_verification', 'verification_request', p_request_id, 'not_found');
  end if;
  if v_req.user_id = auth.uid() then
    return public.internal_admin_fail('review_verification', 'verification_request', p_request_id, 'cannot_review_own');
  end if;
  if v_req.status <> 'pending' then
    return public.internal_admin_fail('review_verification', 'verification_request', p_request_id, 'already_reviewed');
  end if;

  if coalesce(p_approve, false) then
    update public.verification_requests
       set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_request_id;
    update public.profiles set verified = true, verified_at = now() where id = v_req.user_id;
    perform public.create_notification(v_req.user_id, 'systeme', 'verification_approved', auth.uid(), 'verification_request', p_request_id);
  else
    if v_reason is null or char_length(v_reason) < 3 then
      return public.internal_admin_fail('review_verification', 'verification_request', p_request_id, 'reason_required');
    end if;
    update public.verification_requests
       set status = 'rejected', rejection_reason = left(v_reason, 500), reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_request_id;
    perform public.create_notification(v_req.user_id, 'systeme', 'verification_rejected', auth.uid(), 'verification_request', p_request_id);
  end if;

  perform public.log_audit('review_verification', 'verification_request', p_request_id, 'success',
    jsonb_build_object('approved', coalesce(p_approve, false), 'user', v_req.user_id));
  return jsonb_build_object('success', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. MODÉRATION DES ANNONCES
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_listing_status(
  p_product_id uuid, p_status public.listing_status, p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.products;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_needs_reason boolean;
begin
  if not public.act_as_moderator() then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'forbidden');
  end if;
  if p_status not in ('published', 'pending_review', 'removed') then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'invalid_status');
  end if;
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'not_found');
  end if;
  -- Un modérateur qui est aussi vendeur n'approuve pas ses propres annonces.
  if v_prod.seller_id = auth.uid() then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'conflict_of_interest');
  end if;
  if v_prod.deleted_at is not null then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'listing_deleted');
  end if;

  -- Transitions permises : approuver (pending_review -> published), mettre en
  -- attente (published -> pending_review), retirer (tout sauf déjà retiré),
  -- rétablir (removed -> pending_review, jamais directement published).
  if (p_status = 'published' and v_prod.status <> 'pending_review')
     or (p_status = 'pending_review' and v_prod.status not in ('published', 'removed'))
     or (p_status = 'removed' and v_prod.status = 'removed') then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'invalid_transition',
      jsonb_build_object('from', v_prod.status, 'to', p_status));
  end if;

  v_needs_reason := p_status = 'removed' or (p_status = 'pending_review' and v_prod.status = 'published');
  if v_needs_reason and (v_reason is null or char_length(v_reason) < 3) then
    return public.internal_admin_fail('set_listing_status', 'product', p_product_id, 'reason_required');
  end if;

  update public.products
     set status = p_status,
         moderation_reason = case when v_needs_reason then left(v_reason, 500) else null end
   where id = p_product_id;

  perform public.log_audit('set_listing_status', 'product', p_product_id, 'success',
    jsonb_build_object('from', v_prod.status, 'to', p_status, 'reason', v_reason));
  return jsonb_build_object('success', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. SIGNALEMENTS
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_reports(
  p_status public.report_status default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, target_type public.report_target_type, target_id uuid, target_label text,
  reason text, details text, reporter_name text, status public.report_status,
  handled_by_name text, resolution_note text, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select
    rp.id, rp.target_type, rp.target_id,
    -- Jamais le contenu d'un message : un libellé générique suffit à la file de modération.
    coalesce(case rp.target_type
      when 'profile' then (select p.full_name from public.profiles p where p.id = rp.target_id)
      when 'product' then (select x.name from public.products x where x.id = rp.target_id)
      when 'space' then (select s.name from public.spaces s where s.id = rp.target_id)
      when 'course' then (select c.title from public.courses c where c.id = rp.target_id)
      when 'message' then 'Message signalé'
      when 'comment' then 'Commentaire signalé'
    end, 'Contenu supprimé'),
    rp.reason, rp.details, rep.full_name, rp.status, hb.full_name, rp.resolution_note,
    rp.created_at, count(*) over ()
  from public.reports rp
  join public.profiles rep on rep.id = rp.reporter_id
  left join public.profiles hb on hb.id = rp.handled_by
  where (p_status is null or rp.status = p_status)
  order by (rp.status in ('pending', 'reviewing')) desc, rp.created_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_handle_report(
  p_report_id uuid, p_status public.report_status, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rep public.reports;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.act_as_staff() then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'forbidden');
  end if;
  if p_status not in ('reviewing', 'actioned', 'dismissed') then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'invalid_status');
  end if;
  select * into v_rep from public.reports where id = p_report_id for update;
  if not found then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'not_found');
  end if;
  -- Ni juge ni partie : on ne traite ni son propre signalement ni un signalement contre soi.
  if v_rep.reporter_id = auth.uid() or (v_rep.target_type = 'profile' and v_rep.target_id = auth.uid()) then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'conflict_of_interest');
  end if;
  if v_rep.status in ('actioned', 'dismissed') then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'already_closed');
  end if;
  if v_rep.status = 'reviewing' and p_status = 'reviewing' then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'invalid_transition');
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    return public.internal_admin_fail('handle_report', 'report', p_report_id, 'note_too_long');
  end if;

  update public.reports
     set status = p_status, handled_by = auth.uid(), resolution_note = coalesce(v_note, resolution_note)
   where id = p_report_id;

  perform public.log_audit('handle_report', 'report', p_report_id, 'success',
    jsonb_build_object('from', v_rep.status, 'to', p_status));
  return jsonb_build_object('success', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. SUPPORT : ASSIGNATION ET HISTORIQUE
--     support_tickets_staff_manage (0019) laisse déjà le staff écrire assigned_to,
--     mais sans contrôle (n'importe quel profil, même non-agent) ni trace.
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_support_agents()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name
  from public.profiles p
  where exists (select 1 from public.user_roles ur
                where ur.user_id = p.id and ur.role in ('support', 'admin', 'super_admin'))
    and public.is_active_account(p.id)
  order by p.full_name;
end;
$$;

create or replace function public.admin_assign_ticket(p_ticket_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.support_tickets;
begin
  if not public.act_as_support() then
    return public.internal_admin_fail('assign_ticket', 'support_ticket', p_ticket_id, 'forbidden');
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    return public.internal_admin_fail('assign_ticket', 'support_ticket', p_ticket_id, 'not_found');
  end if;
  if v_ticket.status = 'ferme' then
    return public.internal_admin_fail('assign_ticket', 'support_ticket', p_ticket_id, 'ticket_closed');
  end if;
  if p_agent_id is not null and not (
       exists (select 1 from public.user_roles
               where user_id = p_agent_id and role in ('support', 'admin', 'super_admin'))
       and public.is_active_account(p_agent_id)) then
    return public.internal_admin_fail('assign_ticket', 'support_ticket', p_ticket_id, 'not_an_agent',
      jsonb_build_object('agent', p_agent_id));
  end if;
  if v_ticket.assigned_to is not distinct from p_agent_id then
    return public.internal_admin_fail('assign_ticket', 'support_ticket', p_ticket_id, 'no_change');
  end if;

  update public.support_tickets set assigned_to = p_agent_id where id = p_ticket_id;

  perform public.log_audit('assign_ticket', 'support_ticket', p_ticket_id, 'success',
    jsonb_build_object('from', v_ticket.assigned_to, 'to', p_agent_id));
  return jsonb_build_object('success', true);
end;
$$;

-- "Historique interne" d'un ticket : relu depuis audit_logs (déjà append-only),
-- sans table supplémentaire. Les auto-assignations (0019) n'y figurent pas.
create or replace function public.admin_ticket_history(p_ticket_id uuid)
returns table (at timestamptz, actor_name text, from_agent_name text, to_agent_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select a.created_at, actor.full_name, f.full_name, t.full_name
  from public.audit_logs a
  left join public.profiles actor on actor.id = a.actor_id
  left join public.profiles f on f.id = nullif(a.metadata ->> 'from', '')::uuid
  left join public.profiles t on t.id = nullif(a.metadata ->> 'to', '')::uuid
  where a.resource_type = 'support_ticket' and a.resource_id = p_ticket_id
    and a.action = 'assign_ticket' and a.result = 'success'
  order by a.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. TABLEAU DE BORD ET STATISTIQUES
-- -----------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_back_office_access() and public.is_active_account()) then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'universities', (select count(*) from public.universities where active),
    'listings', (select count(*) from public.products where status = 'published' and deleted_at is null),
    'events', (select count(*) from public.events where status = 'published'),
    'open_tickets', (select count(*) from public.support_tickets where status in ('ouvert', 'en_attente')),
    'pending_reports', (select count(*) from public.reports where status = 'pending'),
    -- Volume financier : admin et financial_manager seulement (null pour les autres).
    'mobile_money_volume_30d', case
      when public.is_admin() or public.has_role('financial_manager') then
        (select coalesce(sum(amount), 0) from public.payments
          where status = 'success' and created_at >= now() - interval '30 days')
      else null end
  );
end;
$$;

create or replace function public.admin_weekly_activity()
returns table (day date, signups bigint, listings bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_back_office_access() and public.is_active_account()) then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select d::date,
    (select count(*) from public.profiles p
       where (p.created_at at time zone 'Africa/Douala')::date = d::date),
    (select count(*) from public.products x
       where x.deleted_at is null and (x.created_at at time zone 'Africa/Douala')::date = d::date)
  from generate_series(
         ((now() at time zone 'Africa/Douala')::date - 6)::timestamp,
         (now() at time zone 'Africa/Douala')::date::timestamp,
         interval '1 day') d
  order by 1;
end;
$$;

create or replace function public.admin_signup_growth(p_months integer default 6)
returns table (month date, signups bigint, cumulative bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 6), 1), 24);
begin
  if not (public.has_back_office_access() and public.is_active_account()) then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select m::date,
    (select count(*) from public.profiles p
       where date_trunc('month', p.created_at at time zone 'Africa/Douala') = m),
    (select count(*) from public.profiles p
       where (p.created_at at time zone 'Africa/Douala') < m + interval '1 month')
  from generate_series(
         date_trunc('month', now() at time zone 'Africa/Douala') - ((v_n - 1) * interval '1 month'),
         date_trunc('month', now() at time zone 'Africa/Douala'),
         interval '1 month') m
  order by 1;
end;
$$;

create or replace function public.admin_listings_by_category()
returns table (slug text, name text, listings bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_back_office_access() and public.is_active_account()) then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select c.slug, c.name, count(p.id)
  from public.categories c
  left join public.products p
    on p.category_slug = c.slug and p.status = 'published' and p.deleted_at is null
  group by c.slug, c.name, c.sort_order
  order by 3 desc, c.sort_order;
end;
$$;

create or replace function public.admin_top_campuses(p_limit integer default 5)
returns table (campus text, listings bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_back_office_access() and public.is_active_account()) then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select p.campus, count(*)
  from public.products p
  where p.status = 'published' and p.deleted_at is null
  group by p.campus
  order by 2 desc, p.campus
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
end;
$$;

-- Alertes calculées à la demande (rien à stocker, rien à purger) :
-- pic de signalements sur un utilisateur, taux d'échec de paiement, suggestions
-- d'université en attente.
create or replace function public.admin_alerts()
returns table (id text, tone text, title text, description text, detected_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select 'report_spike:' || r.target_id::text, 'danger', 'Pic de signalements sur un utilisateur',
         pr.full_name || ' a reçu ' || r.n || ' signalements en 24 heures.', r.last_at
  from (select rp.target_id, count(*) as n, max(rp.created_at) as last_at
          from public.reports rp
         where rp.target_type = 'profile' and rp.status <> 'dismissed'
           and rp.created_at >= now() - interval '24 hours'
         group by rp.target_id
        having count(*) >= 5) r
  join public.profiles pr on pr.id = r.target_id
  union all
  select 'payment_failures', 'warning', 'Taux d''échec de paiement élevé',
         round(100.0 * f.failed / f.total)::int || ' % des paiements Mobile Money ont échoué ces 12 dernières heures.',
         now()
  from (select count(*) as total, count(*) filter (where pay.status = 'failed') as failed
          from public.payments pay
         where pay.created_at >= now() - interval '12 hours') f
  where f.total >= 10 and f.failed * 10 >= f.total
  union all
  select 'university_suggestions', 'info', 'Universités suggérées en attente de validation',
         s.n || ' suggestion(s) d''université à examiner.', s.last_at
  from (select count(*) as n, max(us.created_at) as last_at
          from public.university_suggestions us where us.status = 'pending') s
  where s.n > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. ÉQUIPE, INVITATIONS ET JOURNAL D'AUDIT
--     grant_role/revoke_role (0011) restent la seule porte pour ATTRIBUER/RETIRER
--     un rôle à un compte existant. Les invitations couvrent la personne qui n'a
--     pas encore de compte. L'acceptation exige un e-mail CONFIRMÉ identique :
--     sinon quiconque s'inscrirait avec l'adresse invitée avant son titulaire
--     hériterait du rôle.
-- -----------------------------------------------------------------------------
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email citext not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null check (role in ('moderator', 'support', 'financial_manager', 'admin')),
  invited_by uuid references public.profiles (id) on delete set null,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index staff_invitations_one_pending
  on public.staff_invitations (email, role) where status = 'pending';

alter table public.staff_invitations enable row level security;

create policy "staff_invitations_select_admin"
  on public.staff_invitations for select
  to authenticated
  using (public.is_admin());

comment on table public.staff_invitations is
  'Aucune policy d''écriture : admin_invite_staff / admin_revoke_invitation / accept_staff_invitation uniquement. L''e-mail d''invitation n''est pas encore envoyé (à brancher sur la file de notifications) : l''administrateur prévient la personne.';

create or replace function public.admin_invite_staff(p_email text, p_role public.app_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  v_existing uuid;
begin
  if not public.act_as_admin() then
    return public.internal_admin_fail('invite_staff', 'staff_invitation', null, 'forbidden');
  end if;
  if p_role not in ('moderator', 'support', 'financial_manager', 'admin') then
    return public.internal_admin_fail('invite_staff', 'staff_invitation', null, 'invalid_role');
  end if;
  if p_role = 'admin' and not public.has_role('super_admin') then
    return public.internal_admin_fail('invite_staff', 'staff_invitation', null, 'requires_super_admin');
  end if;
  if not public.has_mfa_session() then
    return public.internal_admin_fail('invite_staff', 'staff_invitation', null, 'mfa_required');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return public.internal_admin_fail('invite_staff', 'staff_invitation', null, 'invalid_email');
  end if;

  insert into public.staff_invitations (email, role, invited_by)
  values (v_email, p_role, auth.uid())
  on conflict (email, role) where status = 'pending' do nothing
  returning id into v_id;

  if v_id is null then
    return public.internal_admin_fail('invite_staff', 'staff_invitation', null, 'already_invited');
  end if;

  select pp.id into v_existing from public.profile_private pp where pp.email = v_email::citext;
  if v_existing is not null then
    perform public.create_notification(v_existing, 'securite', 'staff_invitation', auth.uid(), 'staff_invitation', v_id);
  end if;

  perform public.log_audit('invite_staff', 'staff_invitation', v_id, 'success',
    jsonb_build_object('role', p_role, 'email', v_email));
  return jsonb_build_object('success', true, 'invitation_id', v_id);
end;
$$;

create or replace function public.admin_revoke_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.staff_invitations;
begin
  if not public.act_as_admin() then
    return public.internal_admin_fail('revoke_invitation', 'staff_invitation', p_invitation_id, 'forbidden');
  end if;
  if not public.has_mfa_session() then
    return public.internal_admin_fail('revoke_invitation', 'staff_invitation', p_invitation_id, 'mfa_required');
  end if;
  select * into v_inv from public.staff_invitations where id = p_invitation_id for update;
  if not found then
    return public.internal_admin_fail('revoke_invitation', 'staff_invitation', p_invitation_id, 'not_found');
  end if;
  if v_inv.status <> 'pending' then
    return public.internal_admin_fail('revoke_invitation', 'staff_invitation', p_invitation_id, 'not_pending');
  end if;
  -- Retirer une invitation à un rôle admin demande d'avoir pu la poser.
  if v_inv.role = 'admin' and not public.has_role('super_admin') then
    return public.internal_admin_fail('revoke_invitation', 'staff_invitation', p_invitation_id, 'requires_super_admin');
  end if;

  update public.staff_invitations set status = 'revoked' where id = p_invitation_id;
  perform public.log_audit('revoke_invitation', 'staff_invitation', p_invitation_id, 'success',
    jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.accept_staff_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.staff_invitations;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null or not public.is_active_account() then
    return public.internal_admin_fail('accept_invitation', 'staff_invitation', p_invitation_id, 'forbidden');
  end if;
  select * into v_inv from public.staff_invitations where id = p_invitation_id for update;
  if not found then
    return public.internal_admin_fail('accept_invitation', 'staff_invitation', p_invitation_id, 'not_found');
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = auth.uid();
  -- Le journal garde la vraie cause ; au tiers on ne révèle pas à qui l'invitation
  -- était adressée (le résultat ne contient jamais l'e-mail invité).
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    return public.internal_admin_fail('accept_invitation', 'staff_invitation', p_invitation_id, 'not_pending_or_expired');
  end if;
  if v_confirmed is null or lower(v_email) <> lower(v_inv.email::text) then
    return public.internal_admin_fail('accept_invitation', 'staff_invitation', p_invitation_id, 'email_mismatch');
  end if;

  insert into public.user_roles (user_id, role, granted_by)
  values (auth.uid(), v_inv.role, v_inv.invited_by)
  on conflict (user_id, role) do nothing;

  update public.staff_invitations
     set status = 'accepted', accepted_by = auth.uid()
   where id = p_invitation_id;

  perform public.log_security_event(auth.uid(), 'role_granted',
    jsonb_build_object('role', v_inv.role, 'via', 'invitation', 'invited_by', v_inv.invited_by));
  perform public.log_audit('accept_invitation', 'staff_invitation', p_invitation_id, 'success',
    jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('success', true, 'role', v_inv.role);
end;
$$;

create or replace function public.admin_list_invitations()
returns table (id uuid, email text, role public.app_role, invited_by_name text,
               state text, expires_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_admin() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select i.id, i.email::text, i.role, p.full_name,
         case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status::text end,
         i.expires_at, i.created_at
  from public.staff_invitations i
  left join public.profiles p on p.id = i.invited_by
  order by i.created_at desc
  limit 100;
end;
$$;

create or replace function public.admin_list_team()
returns table (user_id uuid, full_name text, email text, roles public.app_role[], since timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_admin() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select ur.user_id, p.full_name, pp.email::text,
         array_agg(ur.role order by ur.role), min(ur.created_at)
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  join public.profile_private pp on pp.id = ur.user_id
  where ur.role <> 'student'
  group by ur.user_id, p.full_name, pp.email
  order by min(ur.created_at);
end;
$$;

-- Journal d'audit paginé par curseur (created_at), avec le nom de l'acteur.
-- audit_logs n'a pas de FK vers profiles : sans cette fonction le front ne
-- pourrait pas afficher "qui" sans requête supplémentaire par ligne.
create or replace function public.admin_audit_feed(
  p_limit integer default 50, p_before timestamptz default null, p_action text default null
) returns table (
  id uuid, created_at timestamptz, actor_id uuid, actor_name text, action text,
  resource_type text, resource_id uuid, result text, metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_admin() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select a.id, a.created_at, a.actor_id, p.full_name, a.action, a.resource_type,
         a.resource_id, a.result, a.metadata
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  where (p_before is null or a.created_at < p_before)
    and (p_action is null or a.action = p_action)
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. DROITS D'EXÉCUTION
--     Les fonctions admin_* sont des points d'entrée (appelables par un utilisateur
--     connecté, qui se heurte à leur contrôle de rôle) ; jamais par `anon`.
--     Les aides internes ne sont appelées que depuis d'autres fonctions DEFINER.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname = 'accept_staff_invitation')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

revoke execute on function public.internal_admin_fail(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.act_as_staff() from public, anon;
revoke execute on function public.act_as_admin() from public, anon;
revoke execute on function public.act_as_moderator() from public, anon;
revoke execute on function public.act_as_support() from public, anon;
revoke execute on function public.has_back_office_access(uuid) from public, anon;
revoke execute on function public.staff_rank(uuid) from public, anon;
-- is_active_account reste exécutable par `authenticated` : il est évalué dans les
-- policies RESTRICTIVE, donc sous les droits du client.
revoke execute on function public.is_active_account(uuid) from public, anon;
