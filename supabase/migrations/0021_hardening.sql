-- =============================================================================
-- 0021 — Durcissement de sécurité avant production
-- Réf. Backend_Hardened sections 8 (RLS), 9 (sessions/OTP), 24 (logs), 36, 43, 47
--
-- Issu d'un audit du schéma 0001-0020 et des Edge Functions. Chaque point cite
-- le problème constaté ; le test `hardening_rls_test.sql` en prouve la correction.
-- =============================================================================

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- 1. CONTEXTE D'APPEL
--    `current_user` ne distingue pas un appel client d'un appel interne dans une
--    fonction SECURITY DEFINER (il vaut toujours le propriétaire). Le GUC `role`,
--    lui, reste celui posé par PostgREST (SET LOCAL ROLE anon|authenticated) :
--    c'est la seule façon fiable de savoir si l'appel vient directement d'un client.
-- -----------------------------------------------------------------------------
create or replace function private.in_client_context()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('role', true), 'none') in ('anon', 'authenticated');
$$;

-- Qui peut interroger les rôles/appartenances d'UN AUTRE compte : le staff, et
-- tout contexte interne (cron, service_role, SQL editor). Jamais un client lambda.
create or replace function private.can_inspect_others()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not private.in_client_context()
      or exists (
        select 1 from public.user_roles
        where user_id = auth.uid()
          and role in ('moderator', 'support', 'admin', 'super_admin', 'financial_manager')
      );
$$;

-- -----------------------------------------------------------------------------
-- 2. ORACLES D'AUTORISATION FERMÉS
--    Ces helpers sont SECURITY DEFINER avec un paramètre `uid` et étaient
--    appelables via /rpc/<nom> par n'importe qui : `is_admin(<uuid>)` révélait
--    qui administre la plateforme ; `is_space_member(<espace privé>, <uuid>)`
--    qui est membre d'un groupe privé ; `is_blocked(a, b)` qui a bloqué qui.
--    Les signatures restent identiques (les policies existantes y sont liées par
--    OID) ; seul le corps change : un client ne reçoit de réponse VRAIE que pour
--    lui-même (ou, pour le staff, pour les autres comptes).
-- -----------------------------------------------------------------------------
create or replace function public.has_role(check_role public.app_role, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.user_roles where user_id = uid and role = check_role)
    else false
  end;
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.user_roles where user_id = uid and role in ('admin', 'super_admin'))
    else false
  end;
$$;

create or replace function public.is_staff(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.user_roles
                 where user_id = uid and role in ('moderator', 'support', 'admin', 'super_admin'))
    else false
  end;
$$;

create or replace function public.has_back_office_access(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.user_roles
                 where user_id = uid
                   and role in ('moderator', 'support', 'admin', 'super_admin', 'financial_manager'))
    else false
  end;
$$;

create or replace function public.staff_rank(uid uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is not distinct from auth.uid() or private.can_inspect_others()
    then coalesce((select max(case role
           when 'super_admin' then 4
           when 'admin' then 3
           when 'moderator' then 2
           when 'support' then 2
           when 'financial_manager' then 2
           else 0 end)
         from public.user_roles where user_id = uid), 0)
    else 0
  end;
$$;

create or replace function public.is_active_account(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
     and (uid is not distinct from auth.uid() or private.can_inspect_others())
     and not exists (select 1 from public.account_restrictions where user_id = uid);
$$;

create or replace function public.is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Un client ne sonde que ses propres relations de blocage.
    when private.in_client_context() and auth.uid() is distinct from p_a and auth.uid() is distinct from p_b
    then false
    else exists (
      select 1 from public.blocked_users
      where (blocker_id = p_a and blocked_id = p_b)
         or (blocker_id = p_b and blocked_id = p_a)
    )
  end;
$$;

create or replace function public.is_space_member(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.space_members where space_id = p_space_id and user_id = p_user_id)
    else false
  end;
$$;

create or replace function public.is_space_admin(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.space_members
                 where space_id = p_space_id and user_id = p_user_id and role in ('owner', 'admin'))
    else false
  end;
$$;

create or replace function public.is_space_moderator(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is not distinct from auth.uid() or private.can_inspect_others()
    then exists (select 1 from public.space_members
                 where space_id = p_space_id and user_id = p_user_id and role in ('owner', 'admin', 'moderator'))
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. DROITS DE TABLES AU MINIMUM
--    Sur Supabase, toute table de `public` reçoit TOUS les droits pour anon et
--    authenticated ; seule la RLS protège. Or TRUNCATE ne passe pas par la RLS :
--    un seul droit TRUNCATE suffit à vider une table (audit_logs compris, dont le
--    caractère "append-only" ne couvrait que UPDATE/DELETE).
-- -----------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- anon ne lit que ce qu'une policy anon l'autorise à lire : on retire SELECT
-- partout, puis on le rend uniquement aux tables qui ont une policy applicable à anon.
revoke select on all tables in schema public from anon;

do $$
declare
  r record;
begin
  for r in
    select distinct c.oid::regclass as tbl
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and p.polcmd in ('r', '*')
      and p.polpermissive
      and (0 = any (p.polroles) or (select oid from pg_roles where rolname = 'anon') = any (p.polroles))
  loop
    execute format('grant select on %s to anon', r.tbl);
  end loop;
end $$;

-- Tables réservées au service (RLS sans aucune policy : deny-all pour les clients) et
-- journaux append-only : aucun droit du tout pour les clients, plutôt que des droits
-- que seule la RLS neutralise.
revoke all on public.provider_events from anon, authenticated;
revoke all on public.phone_verification_codes from anon, authenticated;
revoke all on public.notification_email_queue from anon, authenticated;
revoke all on public.audit_logs from anon;
revoke insert on public.audit_logs from authenticated;
revoke all on public.security_logs from anon;
revoke insert on public.security_logs from authenticated;

-- Vues : lecture seule, jamais pour anon.
revoke all on public.cities_overview from anon;
revoke insert, update, delete on public.cities_overview from authenticated;

-- Les futures tables suivent la même règle (sinon la prochaine migration réintroduit
-- le problème). Après ça, une table lisible par anon exige un `grant select ... to anon`
-- explicite dans sa migration.
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete, select on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- -----------------------------------------------------------------------------
-- 4. FONCTIONS : EXECUTE AU MINIMUM
--    Par défaut PUBLIC (donc anon) peut exécuter toute fonction de `public`, et
--    PostgREST l'expose en /rpc/<nom>. On retire EXECUTE à PUBLIC et anon partout,
--    puis on le rend uniquement aux fonctions que les policies applicables à anon
--    évaluent réellement (relevées via pg_depend, pas listées à la main).
--    Les fonctions de trigger n'ont besoin d'aucun EXECUTE pour fonctionner.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;

do $$
declare
  r record;
begin
  for r in
    select distinct p.oid::regprocedure as sig
    from pg_depend d
    join pg_policy pol on pol.oid = d.objid
    join pg_proc p on p.oid = d.refobjid
    join pg_namespace n on n.oid = p.pronamespace
    where d.classid = 'pg_policy'::regclass
      and d.refclassid = 'pg_proc'::regclass
      and n.nspname = 'public'
      and (0 = any (pol.polroles) or (select oid from pg_roles where rolname = 'anon') = any (pol.polroles))
  loop
    execute format('grant execute on function %s to anon', r.sig);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end $$;

-- PUBLIC a EXECUTE par défaut via l'ACL GLOBALE (pas une entrée de schéma) : seule la forme
-- sans IN SCHEMA peut la retirer. Sans elle, toute fonction créée APRÈS cette migration
-- (y compris celles de cette migration) resterait exécutable par anon.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- -----------------------------------------------------------------------------
-- 5. LIMITES DE DÉBIT EN BASE
--    Rien ne bornait la création de signalements, tickets, annonces, offres,
--    commandes (retenue de stock), etc. : spam de la file de modération, saturation
--    du support, stock bloqué par des commandes jetables. Verrou consultatif par
--    (table, utilisateur) pour que des insertions parallèles ne passent pas toutes
--    sous le seuil. Les appels internes (service_role, cron, SQL editor) ne sont
--    jamais limités.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text := tg_argv[0];
  v_max integer := tg_argv[1]::integer;
  v_window interval := (tg_argv[2] || ' seconds')::interval;
  v_owner text;
  v_count bigint;
begin
  if not private.in_client_context() then
    return new;
  end if;

  v_owner := to_jsonb(new) ->> v_col;
  if v_owner is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || v_owner, 0));

  execute format('select count(*) from %I.%I where %I = $1::uuid and created_at > now() - $2',
                 tg_table_schema, tg_table_name, v_col)
    into v_count using v_owner, v_window;

  if v_count >= v_max then
    raise exception 'rate_limited' using errcode = 'P0429',
      hint = format('Maximum %s créations par %s sur %s', v_max, v_window, tg_table_name);
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('reports',                'reporter_id',   20, 3600),
      ('support_tickets',        'user_id',        5, 3600),
      ('university_suggestions', 'suggested_by',   5, 86400),
      ('products',               'seller_id',     50, 86400),
      ('spaces',                 'created_by',     5, 86400),
      ('events',                 'created_by',    10, 86400),
      ('offers',                 'buyer_id',      30, 3600),
      ('orders',                 'buyer_id',      20, 3600),
      ('reservations',           'buyer_id',      20, 3600),
      ('exchanges',              'requester_id',  20, 3600),
      ('course_reviews',         'user_id',       20, 86400),
      ('space_posts',            'author_id',     60, 3600),
      ('space_post_comments',    'author_id',    120, 3600),
      ('verification_requests',  'user_id',        5, 86400)
    ) as t(tbl, col, max_n, window_s)
  loop
    execute format('create index if not exists %I on public.%I (%I, created_at desc)',
                   'rl_' || r.tbl || '_idx', r.tbl, r.col);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.enforce_rate_limit(%L, %L, %L)',
      r.tbl || '_rate_limit', r.tbl, r.col, r.max_n, r.window_s);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6. INTÉGRITÉ DU STOCK ET DES COMPTEURS D'ANNONCE
--    products_update_own laissait un vendeur écrire `reserved_quantity` : le remettre
--    à 0 alors que des réservations sont actives permettait de vendre le même article
--    à plusieurs acheteurs (l'anti double-vente de 0008 repose sur ce compteur).
--    Même chose pour `views` (popularité falsifiable). Les triggers de réservation
--    sont SECURITY DEFINER : ils continuent d'écrire ces colonnes.
-- -----------------------------------------------------------------------------
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
    if new.reserved_quantity is distinct from old.reserved_quantity or new.views is distinct from old.views then
      raise exception 'reserved_quantity et views sont gérés par le système, jamais par un UPDATE client';
    end if;
    if new.quantity < new.reserved_quantity then
      raise exception 'La quantité ne peut pas descendre sous les réservations actives (%)', new.reserved_quantity;
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. FORMAT DES CHAMPS À CONTENU LIBRE
--    avatar_url acceptait n'importe quelle chaîne : `javascript:`/`data:` (XSS si
--    le front l'injecte dans un href), ou une URL de traçage externe en http.
--    NOT VALID puis VALIDATE : n'échoue pas la migration si d'anciennes lignes sont
--    hors format (elles sont alors listées pour correction manuelle).
-- -----------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_avatar_url_https
  check (avatar_url is null or (avatar_url ~* '^https://[^\s]+$' and char_length(avatar_url) <= 500)) not valid;

do $$
begin
  alter table public.profiles validate constraint profiles_avatar_url_https;
exception when check_violation then
  raise warning 'profiles.avatar_url : des lignes existantes ne respectent pas le format https — contrainte posée (nouvelles écritures protégées) mais non validée. Voir : select id, avatar_url from profiles where avatar_url !~* ''^https://[^\\s]+$'';';
end $$;

-- -----------------------------------------------------------------------------
-- 8. STOCKAGE : LIMITES DE TAILLE ET DE TYPE, ET BUCKET DES IMAGES D'ANNONCE
--    Aucun bucket n'avait de limite : fichiers énormes, ou HTML/SVG servis depuis
--    le domaine de stockage (hébergement de phishing). product_media.storage_path
--    n'avait par ailleurs AUCUN bucket (0004 ne le créait pas).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-media', 'product-media', false)
on conflict (id) do nothing;

update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'product-media';
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id in ('message-attachments', 'support-attachments');
update storage.buckets set file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'verification-documents';
update storage.buckets set file_size_limit = 209715200,
  allowed_mime_types = array['video/mp4', 'video/webm', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id = 'course-media';

-- Dossier = identifiant du vendeur (<seller_id>/<product_id>/<fichier>), même
-- convention que les autres buckets. Lecture : annonce publiée (visiteurs compris),
-- son propre dossier, ou le staff — une annonce retirée n'est plus servie.
create policy "product_media_storage_select"
  on storage.objects for select
  to authenticated, anon
  using (
    bucket_id = 'product-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_staff()
      or exists (
        select 1
        from public.product_media pm
        join public.products p on p.id = pm.product_id
        -- `objects.name` et non `name` : products a aussi une colonne `name`, et dans la
        -- sous-requête un `name` nu désigne celle de products (comparaison toujours fausse :
        -- aucune image d'annonce n'aurait jamais été servie aux visiteurs).
        where pm.storage_path = objects.name
          and p.status = 'published' and p.deleted_at is null
      )
    )
  );

create policy "product_media_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_account()
  );

create policy "product_media_storage_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Une ligne product_media ne peut référencer qu'un fichier du dossier du vendeur
-- de l'annonce : sinon on pouvait "publier" le chemin d'un fichier d'un autre
-- dossier et, l'annonce étant publiée, rendre ce fichier lisible par tous.
create or replace function public.enforce_product_media_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
begin
  select seller_id into v_seller from public.products where id = new.product_id;
  if v_seller is null or split_part(new.storage_path, '/', 1) <> v_seller::text then
    raise exception 'Le fichier doit se trouver dans le dossier du vendeur de l''annonce';
  end if;
  return new;
end;
$$;

create trigger product_media_path_check
  before insert or update of storage_path, product_id on public.product_media
  for each row execute function public.enforce_product_media_path();

-- -----------------------------------------------------------------------------
-- 9. OTP TÉLÉPHONE : ATOMICITÉ
--    phone-otp-verify lisait `attempts`, comparait, PUIS incrémentait : N requêtes
--    parallèles lisaient toutes attempts = 0 et contournaient max_attempts.
--    phone-otp-request ne limitait que par utilisateur : il suffisait de créer des
--    comptes pour harceler un numéro par SMS ou faire exploser la facture SMS.
--    Les deux passent maintenant par une fonction qui prend un verrou de ligne /
--    consultatif ; EXECUTE réservé à service_role (les Edge Functions).
-- -----------------------------------------------------------------------------
create or replace function public.create_phone_otp(
  p_user_id uuid, p_phone text, p_code_hash text, p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Deux verrous (utilisateur puis numéro), toujours dans le même ordre : pas d'interblocage.
  perform pg_advisory_xact_lock(hashtextextended('otp-user:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('otp-phone:' || p_phone, 0));

  if (select count(*) from public.phone_verification_codes
        where user_id = p_user_id and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.phone_verification_codes
           where phone = p_phone and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('status', 'too_many_requests');
  end if;

  insert into public.phone_verification_codes (user_id, phone, code_hash, expires_at)
  values (p_user_id, p_phone, p_code_hash, p_expires_at)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

create or replace function public.verify_phone_otp(p_user_id uuid, p_phone text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.phone_verification_codes;
  v_last4 text := right(p_phone, 4);
begin
  select * into v_code
  from public.phone_verification_codes
  where user_id = p_user_id and phone = p_phone and consumed_at is null
  order by created_at desc
  limit 1
  for update;                       -- sérialise les vérifications concurrentes du même code

  if not found then
    return jsonb_build_object('status', 'no_active_code');
  end if;
  if v_code.expires_at < now() then
    insert into public.security_logs (user_id, event_type, metadata)
    values (p_user_id, 'otp_expired', jsonb_build_object('phone_last4', v_last4));
    return jsonb_build_object('status', 'code_expired');
  end if;
  if v_code.attempts >= v_code.max_attempts then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;

  -- L'essai est compté AVANT la comparaison, dans la même transaction.
  update public.phone_verification_codes set attempts = attempts + 1 where id = v_code.id;

  if v_code.code_hash <> p_code_hash then
    insert into public.security_logs (user_id, event_type, metadata)
    values (p_user_id, 'otp_failed', jsonb_build_object('phone_last4', v_last4));
    return jsonb_build_object('status', 'invalid_code',
                              'attempts_remaining', v_code.max_attempts - v_code.attempts - 1);
  end if;

  update public.phone_verification_codes set consumed_at = now() where id = v_code.id;

  begin
    update public.profile_private set phone = p_phone, phone_verified = true where id = p_user_id;
  exception when unique_violation then
    return jsonb_build_object('status', 'phone_already_used');
  end;

  insert into public.security_logs (user_id, event_type, metadata)
  values (p_user_id, 'otp_verified', jsonb_build_object('phone_last4', v_last4));
  return jsonb_build_object('status', 'verified');
end;
$$;

revoke all on function public.create_phone_otp(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.verify_phone_otp(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_phone_otp(uuid, text, text, timestamptz) to service_role;
grant execute on function public.verify_phone_otp(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 10. RÉTENTION
--     Codes OTP expirés (hash de codes à 6 chiffres : à ne pas garder), événements
--     de webhook anciens, files e-mail terminées, journaux de sécurité très anciens.
--     Les durées sont des choix de départ, à ajuster avec les obligations légales
--     applicables à la plateforme.
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_security_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes bigint;
  v_events bigint;
begin
  delete from public.phone_verification_codes where created_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;

  -- Un événement de webhook "processed" de plus de 180 jours n'a plus d'utilité
  -- opérationnelle ; les erreurs et rejets sont gardés pour enquête.
  delete from public.provider_events
   where processing_status = 'processed' and received_at < now() - interval '180 days';
  get diagnostics v_events = row_count;

  return jsonb_build_object('phone_codes', v_codes, 'provider_events', v_events);
end;
$$;

revoke all on function public.purge_expired_security_data() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('purge-security-data-daily', '17 3 * * *', 'select public.purge_expired_security_data();');
  else
    raise notice 'pg_cron absent : planifier manuellement select public.purge_expired_security_data() (quotidien).';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 11. FONCTIONS DE TRIGGER CRÉÉES DANS CETTE MIGRATION
--     La passe de la section 4 est antérieure à enforce_rate_limit() et
--     enforce_product_media_path() : on la rejoue en fin de fichier. Un trigger
--     s'exécute sans que l'appelant ait EXECUTE sur sa fonction.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
