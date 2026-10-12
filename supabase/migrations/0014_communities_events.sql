-- =============================================================================
-- 0014 — Communautés, groupes, modération (section 20) et Événements/billetterie
-- (section 21).
--
-- "Communauté" et "groupe" partagent exactement le même modèle côté front
-- (mock-community.ts : type Space, kind: "communaute" | "groupe") — une seule
-- table `spaces` avec un champ `kind`, comme products/orders ne dupliquent pas
-- de table par catégorie.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ESPACES (communautés + groupes)
-- -----------------------------------------------------------------------------
create table public.space_categories (
  slug text primary key,
  name text not null,
  sort_order integer not null default 0
);

alter table public.space_categories enable row level security;

create policy "space_categories_select_public"
  on public.space_categories for select
  to authenticated, anon
  using (true);

create policy "space_categories_admin_write"
  on public.space_categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create type public.space_kind as enum ('communaute', 'groupe');
-- "invitation" : ni listé publiquement ni auto-joignable, seul un admin/owner
-- peut y faire entrer quelqu'un (section 20, "Visibilité public/privé/invitation").
create type public.space_privacy as enum ('publique', 'privee', 'invitation');
create type public.space_role as enum ('owner', 'admin', 'moderator', 'member');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind public.space_kind not null,
  category_slug text not null references public.space_categories (slug),
  name text not null check (char_length(name) between 3 and 120),
  description text not null check (char_length(description) <= 2000),
  privacy public.space_privacy not null default 'publique',
  rules text[] not null default '{}',
  created_by uuid not null references public.profiles (id),
  member_count integer not null default 0, -- cache, maintenu par trigger
  suspended_at timestamptz,
  suspended_reason text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- MEMBRES — table nue créée ici (avant les policies de spaces qui la
-- référencent) ; RLS + policies de space_members arrivent plus bas, une fois
-- spaces ET space_members toutes deux présentes (référence croisée entre les
-- deux tables).
-- -----------------------------------------------------------------------------
create table public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  role public.space_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index spaces_kind_idx on public.spaces (kind, privacy);
create index spaces_category_idx on public.spaces (category_slug);

-- Fonctions d'appartenance — SECURITY DEFINER indispensable : sans ça, une
-- policy sur space_members qui interroge space_members elle-même (même sous
-- un autre alias, pour vérifier l'appartenance d'un tiers) déclenche une
-- réévaluation infinie de sa propre RLS ("infinite recursion detected in
-- policy for relation space_members" — trouvé en testant, pas en relisant).
-- Même famille de bug que is_blocked (0012) et has_role/is_admin/is_staff
-- (0001), un cran plus insidieux ici car la récursion est sur LA MÊME table,
-- pas seulement masquée par la RLS d'un appelant.
create or replace function public.is_space_member(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.space_members where space_id = p_space_id and user_id = p_user_id);
$$;

create or replace function public.is_space_admin(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.space_members where space_id = p_space_id and user_id = p_user_id and role in ('owner', 'admin'));
$$;

create or replace function public.is_space_moderator(p_space_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.space_members where space_id = p_space_id and user_id = p_user_id and role in ('owner', 'admin', 'moderator'));
$$;

comment on function public.is_space_member is
  'SECURITY DEFINER obligatoire : appelée depuis la policy select de space_members elle-même (pour vérifier "un autre membre du même espace"), une version sans SECURITY DEFINER reboucle sur sa propre RLS à l''infini.';

create trigger set_spaces_updated_at
  before update on public.spaces
  for each row execute function public.set_updated_at();

alter table public.spaces enable row level security;

-- Un espace public OU privé est découvrable (on doit pouvoir le trouver pour
-- demander à le rejoindre) ; seul "invitation" est réellement invisible tant
-- qu'on n'y a pas été invité — section 20, "Visibilité public/privé/
-- invitation" : 3 paliers distincts, pas 2 (trouvé en testant le flux de
-- demande spontanée sur un espace privee, qui ne peut fonctionner si
-- l'espace est totalement invisible avant d'y être membre).
create policy "spaces_select_visible"
  on public.spaces for select
  to authenticated
  using (
    (privacy in ('publique', 'privee') and deleted_at is null)
    or public.is_space_member(id)
    or public.is_staff()
  );

create policy "spaces_select_public_anon"
  on public.spaces for select
  to anon
  using (privacy = 'publique' and deleted_at is null);

comment on policy "spaces_select_public_anon" on public.spaces is
  'Volontairement plus restrictif que la policy authenticated (publique uniquement, pas privee) : un visiteur non connecté n''a pas besoin de découvrir les groupes privés, seuls les espaces ouverts servent de vitrine publique.';

create policy "spaces_insert_own"
  on public.spaces for insert
  to authenticated
  with check (created_by = auth.uid());

-- Le créateur/admin modifie nom/description/règles, mais pas les champs de
-- modération (suspended_at/deleted_at) : ceux-ci passent uniquement par les
-- fonctions moderate_* plus bas, jamais par un UPDATE direct du client.
create policy "spaces_update_admin"
  on public.spaces for update
  to authenticated
  using (public.is_space_admin(id))
  with check (public.is_space_admin(id));

-- Les colonnes de modération ne sont modifiables QUE depuis les fonctions
-- moderate_* (SECURITY DEFINER : current_user = propriétaire de la fonction).
-- Un UPDATE direct d'un client (current_user = authenticated) est rejeté ici.
-- Fait en trigger plutôt qu'en WITH CHECK : une première version comparait
-- suspended_at à un sous-select "where s.id = id", où `id` non qualifié se
-- résolvait sur l'alias interne (s.id = s.id, toujours vrai) et renvoyait
-- toutes les lignes — un WITH CHECK ne peut pas référencer proprement l'ancienne
-- valeur de la ligne, un trigger BEFORE UPDATE le fait via OLD.
create or replace function public.protect_space_moderation_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.suspended_at is distinct from old.suspended_at
      or new.suspended_reason is distinct from old.suspended_reason
      or new.deleted_at is distinct from old.deleted_at)
     and current_user in ('authenticated', 'anon') then
    raise exception 'Les champs de modération d''un espace ne se modifient que via les fonctions moderate_*';
  end if;
  return new;
end;
$$;

create trigger spaces_protect_moderation
  before update on public.spaces
  for each row execute function public.protect_space_moderation_columns();

comment on table public.spaces is
  'suspended_at/deleted_at écrits uniquement par moderate_suspend_space/moderate_delete_space/moderate_restore_space (staff), jamais par un UPDATE direct (trigger spaces_protect_moderation).';

create or replace function public.provision_space_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.space_members (space_id, user_id, role) values (new.id, new.created_by, 'owner');
  update public.spaces set member_count = 1 where id = new.id;
  return new;
end;
$$;

create trigger spaces_provision_owner
  after insert on public.spaces
  for each row execute function public.provision_space_owner();


alter table public.space_members enable row level security;

create policy "space_members_select_visible_space"
  on public.space_members for select
  to authenticated
  using (
    exists (
      select 1 from public.spaces s
      where s.id = space_id
        and (s.privacy = 'publique' or public.is_space_member(s.id))
    )
    or public.is_staff()
  );

-- Rejoindre directement un espace PUBLIC uniquement (privee/invitation passent
-- par space_membership_requests plus bas, jamais un insert direct).
create policy "space_members_join_public"
  on public.space_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (select 1 from public.spaces s where s.id = space_id and s.privacy = 'publique' and s.deleted_at is null)
  );

-- Changer le rôle d'un membre : réservé owner/admin, jamais sur soi-même
-- (évite qu'un admin se rétrograde/promeuve lui-même de façon incohérente),
-- et un admin ne peut pas promouvoir quelqu'un au rang owner (seul un owner
-- transfère la propriété — non exposé ici, hors périmètre de ce premier jet).
create policy "space_members_update_role_admin"
  on public.space_members for update
  to authenticated
  using (user_id <> auth.uid() and public.is_space_admin(space_id))
  with check (role in ('admin', 'moderator', 'member'));

-- Quitter soi-même, ou être exclu par owner/admin/moderator (modération).
create policy "space_members_leave_or_kick"
  on public.space_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_space_moderator(space_id)
    or public.is_staff()
  );

create or replace function public.sync_space_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.spaces
    set member_count = (select count(*) from public.space_members where space_id = coalesce(new.space_id, old.space_id))
    where id = coalesce(new.space_id, old.space_id);
  return null;
end;
$$;

create trigger space_members_sync_count
  after insert or delete on public.space_members
  for each row execute function public.sync_space_member_count();

-- -----------------------------------------------------------------------------
-- DEMANDES D'ADHÉSION / INVITATIONS — seule porte d'entrée pour privee et
-- invitation. invited_by NULL = demande spontanée (privee, résolue par un
-- admin) ; invited_by renseigné = invitation (résolue par l'invité lui-même).
-- -----------------------------------------------------------------------------
create type public.membership_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.space_membership_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  invited_by uuid references public.profiles (id),
  status public.membership_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index space_membership_requests_pending_uidx
  on public.space_membership_requests (space_id, user_id)
  where status = 'pending';

create trigger set_space_membership_requests_updated_at
  before update on public.space_membership_requests
  for each row execute function public.set_updated_at();

alter table public.space_membership_requests enable row level security;

create policy "space_membership_requests_select_involved"
  on public.space_membership_requests for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_space_admin(space_id)
    or public.is_staff()
  );

-- Demande spontanée sur un espace 'privee' (invited_by NULL).
-- IMPORTANT (trouvé en testant, généralisable à tout le fichier) : quand
-- plusieurs policies UPDATE permissives existent sur une même table, Postgres
-- combine leurs USING par OR **et** leurs WITH CHECK par OR, INDÉPENDAMMENT
-- les uns des autres — le WITH CHECK d'une policy B peut valider une ligne
-- alors que c'est le USING d'une policy A (pas B) qui a donné l'accès à cette
-- ligne. Chaque WITH CHECK ci-dessous réaffirme donc systématiquement SA
-- PROPRE condition d'autorisation complète, jamais seulement "quelle valeur
-- est posée" — sinon une policy avec un WITH CHECK trop permissif peut être
-- détournée via l'accès accordé par une autre policy.
create policy "space_membership_requests_self_request"
  on public.space_membership_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and invited_by is null
    and exists (select 1 from public.spaces s where s.id = space_id and s.privacy = 'privee' and s.deleted_at is null)
  );

-- Invitation par un admin/owner sur un espace 'invitation' (ou 'privee', une
-- invitation directe y reste cohérente).
create policy "space_membership_requests_invite"
  on public.space_membership_requests for insert
  to authenticated
  with check (
    invited_by = auth.uid()
    and user_id <> auth.uid()
    and public.is_space_admin(space_id)
  );

-- L'invité accepte/refuse sa propre invitation.
create policy "space_membership_requests_resolve_invitee"
  on public.space_membership_requests for update
  to authenticated
  using (user_id = auth.uid() and invited_by is not null and status = 'pending')
  with check (user_id = auth.uid() and invited_by is not null and status in ('approved', 'rejected'));

-- L'admin/owner approuve/rejette une demande spontanée (jamais une invitation :
-- celle-ci se résout par l'invité lui-même, cf. policy précédente).
create policy "space_membership_requests_resolve_admin"
  on public.space_membership_requests for update
  to authenticated
  using (
    invited_by is null and status = 'pending'
    and public.is_space_admin(space_id)
  )
  with check (invited_by is null and public.is_space_admin(space_id) and status in ('approved', 'rejected'));

create policy "space_membership_requests_cancel_own"
  on public.space_membership_requests for update
  to authenticated
  using (user_id = auth.uid() and invited_by is null and status = 'pending')
  with check (user_id = auth.uid() and invited_by is null and status = 'cancelled');

create or replace function public.resolve_membership_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.space_members (space_id, user_id, role)
    values (new.space_id, new.user_id, 'member')
    on conflict (space_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger space_membership_requests_approve
  after update of status on public.space_membership_requests
  for each row execute function public.resolve_membership_request();

-- -----------------------------------------------------------------------------
-- PUBLICATIONS, COMMENTAIRES, RÉACTIONS
-- -----------------------------------------------------------------------------
create table public.space_posts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 3000),
  image_path text,
  pinned boolean not null default false,
  hidden_at timestamptz,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index space_posts_space_idx on public.space_posts (space_id, pinned desc, created_at desc);

create trigger set_space_posts_updated_at
  before update on public.space_posts
  for each row execute function public.set_updated_at();

alter table public.space_posts enable row level security;

create policy "space_posts_select_member"
  on public.space_posts for select
  to authenticated
  using (hidden_at is null and public.is_space_member(space_id));

create policy "space_posts_staff_select"
  on public.space_posts for select
  to authenticated
  using (public.is_staff());

-- Publier : réservé aux membres (section 20, "permissions de publier").
create policy "space_posts_insert_member"
  on public.space_posts for insert
  to authenticated
  with check (author_id = auth.uid() and public.is_space_member(space_id));

-- Épingler : réservé owner/admin/moderator ; l'auteur modifie son propre texte.
-- (Deux policies UPDATE distinctes, comme ailleurs, pour ne pas mélanger les
-- pouvoirs : l'auteur ne doit pas pouvoir s'auto-épingler.)
create policy "space_posts_update_own_body"
  on public.space_posts for update
  to authenticated
  using (author_id = auth.uid() and hidden_at is null)
  with check (author_id = auth.uid() and pinned is not distinct from false);

create policy "space_posts_pin_moderator"
  on public.space_posts for update
  to authenticated
  using (public.is_space_moderator(space_id))
  with check (public.is_space_moderator(space_id) and hidden_at is not distinct from null);

-- Supprimer : auteur, ou modération de l'espace, ou staff (section 20,
-- "permissions de ... supprimer"). hidden_at reste réservé aux fonctions
-- moderate_* pour l'action de masquage formelle avec motif tracé ; un DELETE
-- pur reste possible pour l'auteur qui retire son propre post sans que ce
-- soit un événement de modération à auditer.
create policy "space_posts_delete_own_or_moderator"
  on public.space_posts for delete
  to authenticated
  using (
    author_id = auth.uid()
    or public.is_space_moderator(space_id)
    or public.is_staff()
  );

create table public.space_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.space_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 1000),
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);

create index space_post_comments_post_idx on public.space_post_comments (post_id, created_at);

alter table public.space_post_comments enable row level security;

create policy "space_post_comments_select_member"
  on public.space_post_comments for select
  to authenticated
  using (
    hidden_at is null
    and exists (select 1 from public.space_posts p where p.id = post_id and public.is_space_member(p.space_id))
  );

create policy "space_post_comments_insert_member"
  on public.space_post_comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.space_posts p where p.id = post_id and public.is_space_member(p.space_id))
  );

create policy "space_post_comments_delete_own_or_moderator"
  on public.space_post_comments for delete
  to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.space_posts p where p.id = post_id and public.is_space_moderator(p.space_id))
    or public.is_staff()
  );

create type public.reaction_kind as enum ('jaime', 'jadore', 'haha', 'triste', 'grrr');

create table public.space_post_reactions (
  post_id uuid not null references public.space_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  kind public.reaction_kind not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.space_post_reactions enable row level security;

create policy "space_post_reactions_select_member"
  on public.space_post_reactions for select
  to authenticated
  using (exists (select 1 from public.space_posts p where p.id = post_id and public.is_space_member(p.space_id)));

-- Une seule réaction par (post, utilisateur) : re-réagir change juste kind
-- (upsert côté client), la clé primaire empêche tout doublon.
create policy "space_post_reactions_upsert_own"
  on public.space_post_reactions for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.space_posts p where p.id = post_id and public.is_space_member(p.space_id))
  );

-- -----------------------------------------------------------------------------
-- MODÉRATION — masquer/rétablir un contenu (espace, modérateurs ou staff),
-- suspendre/supprimer/rétablir un espace entier (staff seul, action plus
-- lourde) et avertir un utilisateur. Toujours journalisé dans audit_logs
-- (0011) : section 20, "chaque action importante est auditée".
-- -----------------------------------------------------------------------------
create or replace function public.moderate_hide_post(p_post_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.space_posts where id = p_post_id;

  if not (public.is_staff() or public.is_space_moderator(v_space_id)) then
    raise exception 'Permission refusée : modération réservée au staff ou aux modérateurs de cet espace';
  end if;

  update public.space_posts set hidden_at = now(), hidden_reason = p_reason where id = p_post_id;
  perform public.log_audit('hide_post', 'space_post', p_post_id, 'success', jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.moderate_restore_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from public.space_posts where id = p_post_id;

  if not (public.is_staff() or public.is_space_moderator(v_space_id)) then
    raise exception 'Permission refusée : modération réservée au staff ou aux modérateurs de cet espace';
  end if;

  update public.space_posts set hidden_at = null, hidden_reason = null where id = p_post_id;
  perform public.log_audit('restore_post', 'space_post', p_post_id, 'success', '{}'::jsonb);
end;
$$;

create or replace function public.moderate_suspend_space(p_space_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Permission refusée : suspension d''un espace réservée au staff';
  end if;

  update public.spaces set suspended_at = now(), suspended_reason = p_reason where id = p_space_id;
  perform public.log_audit('suspend_space', 'space', p_space_id, 'success', jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.moderate_restore_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Permission refusée : rétablissement d''un espace réservé au staff';
  end if;

  update public.spaces set suspended_at = null, suspended_reason = null where id = p_space_id;
  perform public.log_audit('restore_space', 'space', p_space_id, 'success', '{}'::jsonb);
end;
$$;

create or replace function public.moderate_delete_space(p_space_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Permission refusée : suppression d''un espace réservée au staff';
  end if;

  update public.spaces set deleted_at = now(), suspended_reason = p_reason where id = p_space_id;
  perform public.log_audit('delete_space', 'space', p_space_id, 'success', jsonb_build_object('reason', p_reason));
end;
$$;

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
end;
$$;

grant execute on function
  public.moderate_hide_post(uuid, text),
  public.moderate_restore_post(uuid),
  public.moderate_suspend_space(uuid, text),
  public.moderate_restore_space(uuid),
  public.moderate_delete_space(uuid, text),
  public.moderate_warn_user(uuid, text)
to authenticated;

comment on function public.moderate_warn_user is
  'Journalise dans audit_logs (visible staff uniquement pour l''instant) ; la remontée d''un avertissement à l''utilisateur concerné dépend de la table notifications, pas encore construite.';

-- -----------------------------------------------------------------------------
-- SIGNALEMENTS — génériques, couvrent profils/annonces/messages/commentaires/
-- espaces/formations (section 20). target_id n'a pas de FK (association
-- polymorphe classique) puisqu'il pointe vers l'une ou l'autre de plusieurs
-- tables selon target_type.
-- -----------------------------------------------------------------------------
create type public.report_target_type as enum ('profile', 'product', 'message', 'comment', 'space', 'course');
create type public.report_status as enum ('pending', 'reviewing', 'actioned', 'dismissed');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id),
  target_type public.report_target_type not null,
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 200),
  details text check (details is null or char_length(details) <= 2000),
  status public.report_status not null default 'pending',
  handled_by uuid references public.profiles (id),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reports_status_idx on public.reports (status, created_at);
create index reports_target_idx on public.reports (target_type, target_id);

create trigger set_reports_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

alter table public.reports enable row level security;

create policy "reports_select_own_or_staff"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

create policy "reports_insert_own"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid() and status = 'pending');

create policy "reports_staff_update"
  on public.reports for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

comment on table public.reports is
  'target_id sans clé étrangère : association polymorphe (le type de la cible varie selon target_type). "Examiner" = status -> reviewing ; "actioned"/"dismissed" ferment le signalement, tracés par updated_at + handled_by, sans table d''audit séparée puisque reports EST déjà le journal de cette action.';

-- =============================================================================
-- ÉVÉNEMENTS ET BILLETTERIE (section 21)
-- =============================================================================
create table public.event_categories (
  slug text primary key,
  name text not null,
  sort_order integer not null default 0
);

alter table public.event_categories enable row level security;

create policy "event_categories_select_public"
  on public.event_categories for select
  to authenticated, anon
  using (true);

create policy "event_categories_admin_write"
  on public.event_categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create type public.event_status as enum ('draft', 'published', 'cancelled', 'completed');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id),
  organizer_space_id uuid references public.spaces (id),
  organizer_name text not null check (char_length(organizer_name) between 2 and 120),
  category_slug text not null references public.event_categories (slug),
  name text not null check (char_length(name) between 3 and 150),
  description text not null check (char_length(description) <= 3000),
  venue text not null,
  campus text not null,
  city text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  capacity integer not null check (capacity > 0),
  price integer not null default 0 check (price >= 0),
  status public.event_status not null default 'draft',
  tickets_sold integer not null default 0 check (tickets_sold >= 0), -- inclut pending_payment, cf. commentaire sur issue_ticket
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index events_status_idx on public.events (status, starts_at);
create index events_organizer_space_idx on public.events (organizer_space_id);

create trigger set_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

alter table public.events enable row level security;

create policy "events_select_published"
  on public.events for select
  to authenticated, anon
  using (status in ('published', 'completed', 'cancelled'));

create policy "events_select_own_or_staff"
  on public.events for select
  to authenticated
  using (created_by = auth.uid() or public.is_staff());

-- Créateur direct, ou au nom d'un espace dont il est owner/admin (pas de
-- palier de modération staff pour publier un événement — pas d'exigence en
-- ce sens dans le cahier des charges, contrairement aux annonces/formations).
create policy "events_insert_own_or_space_admin"
  on public.events for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (organizer_space_id is null or public.is_space_admin(organizer_space_id))
  );

create policy "events_update_own_or_space_admin"
  on public.events for update
  to authenticated
  using (created_by = auth.uid() or public.is_space_admin(organizer_space_id))
  with check (created_by = auth.uid() or public.is_space_admin(organizer_space_id));

create policy "events_staff_write"
  on public.events for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- BILLETS — même principe que course_enrollments : sert d'intention d'achat
-- (payant) et de justificatif d'accès (gratuit direct). qr_code est
-- l'identifiant opaque exigé par la section 21 ("QR code avec identifiant
-- opaque et/ou signature cryptographique") : 24 octets aléatoires (192 bits),
-- non déductible, généré côté serveur uniquement (jamais fourni par le client).
-- -----------------------------------------------------------------------------
create type public.ticket_status as enum ('pending_payment', 'valid', 'used', 'cancelled', 'refunded');

create table public.event_tickets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  attendee_id uuid not null references public.profiles (id),
  unit_price integer not null check (unit_price >= 0),
  idempotency_key uuid not null unique,
  qr_code text unique,
  status public.ticket_status not null default 'pending_payment',
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, attendee_id)
);

create index event_tickets_event_idx on public.event_tickets (event_id, status);
create index event_tickets_qr_idx on public.event_tickets (qr_code);

create trigger set_event_tickets_updated_at
  before update on public.event_tickets
  for each row execute function public.set_updated_at();

alter table public.event_tickets enable row level security;

create policy "event_tickets_select_own"
  on public.event_tickets for select
  to authenticated
  using (
    attendee_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.events e
      where e.id = event_id and (e.created_by = auth.uid() or public.is_space_admin(e.organizer_space_id))
    )
  );

-- Gratuit → 'valid' immédiat ; payant → 'pending_payment' obligatoire, même
-- principe anti-triche que course_enrollments_insert_self (0013) : le prix
-- doit correspondre au prix réel de l'événement, jamais une valeur du client.
create policy "event_tickets_insert_self"
  on public.event_tickets for insert
  to authenticated
  with check (
    attendee_id = auth.uid()
    and unit_price = (select price from public.events where id = event_id and status = 'published')
    and (
      (status = 'valid' and unit_price = 0)
      or (status = 'pending_payment' and unit_price > 0)
    )
  );

create policy "event_tickets_cancel_own"
  on public.event_tickets for update
  to authenticated
  using (attendee_id = auth.uid() and status in ('pending_payment', 'valid'))
  with check (attendee_id = auth.uid() and status = 'cancelled');

create or replace function public.enforce_ticket_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'pending_payment' and new.status in ('valid', 'cancelled') then
    return new;
  end if;
  if old.status = 'valid' and new.status in ('used', 'cancelled', 'refunded') then
    return new;
  end if;
  raise exception 'Transition de statut de billet invalide : % -> %', old.status, new.status;
end;
$$;

create trigger event_tickets_status_transition
  before update of status on public.event_tickets
  for each row execute function public.enforce_ticket_status_transition();

-- Génère l'identifiant opaque à l'émission, jamais fourni par le client.
create or replace function public.generate_ticket_qr_code()
returns trigger
language plpgsql
as $$
begin
  new.qr_code := encode(gen_random_bytes(24), 'hex');
  return new;
end;
$$;

create trigger event_tickets_generate_qr
  before insert on public.event_tickets
  for each row execute function public.generate_ticket_qr_code();

-- Anti sur-vente : verrou de ligne sur events avant de vérifier la capacité
-- réellement disponible, même mécanique que reserve_stock (0008). Compte
-- pending_payment ET valid comme "pris" : un panier en cours de paiement doit
-- lui aussi bloquer une place, sans quoi deux acheteurs pourraient payer pour
-- la même dernière place.
create or replace function public.reserve_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_taken integer;
begin
  select capacity into v_capacity from public.events where id = new.event_id for update;

  if v_capacity is null then
    raise exception 'Événement introuvable : %', new.event_id;
  end if;

  select count(*) into v_taken from public.event_tickets
    where event_id = new.event_id and status in ('pending_payment', 'valid', 'used');

  if v_taken >= v_capacity then
    raise exception 'Capacité atteinte pour cet événement (% places)', v_capacity;
  end if;

  update public.events set tickets_sold = tickets_sold + 1 where id = new.event_id;
  return new;
end;
$$;

create trigger event_tickets_reserve_capacity
  before insert on public.event_tickets
  for each row execute function public.reserve_event_capacity();

create or replace function public.release_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('pending_payment', 'valid') and new.status in ('cancelled', 'refunded') then
    update public.events set tickets_sold = greatest(tickets_sold - 1, 0) where id = old.event_id;
  end if;
  return new;
end;
$$;

create trigger event_tickets_release_capacity
  after update of status on public.event_tickets
  for each row execute function public.release_event_capacity();

create or replace function public.expire_stale_tickets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.event_tickets
    set status = 'cancelled'
    where status = 'pending_payment' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.expire_stale_tickets is
  'À planifier via pg_cron aux côtés de expire_stale_offers()/expire_stale_reservations() (0010).';

-- -----------------------------------------------------------------------------
-- JOURNAL DE SCAN + VALIDATION ATOMIQUE (section 21 : "transaction atomique
-- pour éviter la double validation", "journal de scan"). scan_ticket() est
-- LA seule façon de faire passer un billet à 'used' — jamais une policy
-- update authenticated pour ce statut.
-- -----------------------------------------------------------------------------
create type public.scan_result as enum ('valid', 'already_used', 'invalid_code', 'wrong_event', 'not_valid_status');

create table public.ticket_scans (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.event_tickets (id),
  event_id uuid not null references public.events (id),
  scanned_by uuid not null references public.profiles (id),
  result public.scan_result not null,
  scanned_at timestamptz not null default now()
);

create index ticket_scans_event_idx on public.ticket_scans (event_id, scanned_at desc);

alter table public.ticket_scans enable row level security;

create policy "ticket_scans_select_organizer"
  on public.ticket_scans for select
  to authenticated
  using (
    scanned_by = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.events e
      where e.id = event_id and (e.created_by = auth.uid() or public.is_space_admin(e.organizer_space_id))
    )
  );

revoke update, delete on public.ticket_scans from authenticated, anon, service_role;

create or replace function public.scan_ticket(p_qr_code text, p_event_id uuid)
returns public.scan_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.event_tickets;
  v_authorized boolean;
  v_result public.scan_result;
begin
  select public.is_staff() or exists (
    select 1 from public.events e
    where e.id = p_event_id and (e.created_by = auth.uid() or public.is_space_admin(e.organizer_space_id))
  ) into v_authorized;

  if not v_authorized then
    raise exception 'Permission refusée : contrôle des billets réservé à l''organisateur ou au staff';
  end if;

  -- Verrou de ligne : deux scans simultanés du même billet physique se
  -- sérialisent ici, le second voit forcément status='used' posé par le
  -- premier — c'est ce qui rend la double validation structurellement
  -- impossible, pas seulement improbable.
  select * into v_ticket from public.event_tickets where qr_code = p_qr_code for update;

  if v_ticket.id is null then
    v_result := 'invalid_code';
  elsif v_ticket.event_id <> p_event_id then
    v_result := 'wrong_event';
  elsif v_ticket.status = 'used' then
    v_result := 'already_used';
  elsif v_ticket.status <> 'valid' then
    v_result := 'not_valid_status';
  else
    update public.event_tickets set status = 'used', used_at = now() where id = v_ticket.id;
    v_result := 'valid';
  end if;

  insert into public.ticket_scans (ticket_id, event_id, scanned_by, result)
  values (v_ticket.id, p_event_id, auth.uid(), v_result);

  return v_result;
end;
$$;

grant execute on function public.scan_ticket(text, uuid) to authenticated;

-- =============================================================================
-- GÉNÉRALISATION DES PAIEMENTS (suite) — un billet payant se règle par le
-- même pipeline CamPay, comme une inscription à une formation (0013).
-- =============================================================================
alter table public.payments drop constraint payments_exactly_one_target;
alter table public.payments add column event_ticket_id uuid references public.event_tickets (id);

alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id) = 1);

create unique index payments_event_ticket_uidx
  on public.payments (event_ticket_id)
  where event_ticket_id is not null;

create or replace function public.apply_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    if new.order_id is not null then
      update public.orders
        set status = 'paid'
        where id = new.order_id and status = 'pending_payment';

      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'order_not_pending_payment_at_settlement', 'order_id', new.order_id));
      end if;
    elsif new.course_enrollment_id is not null then
      update public.course_enrollments
        set status = 'active'
        where id = new.course_enrollment_id and status = 'pending_payment';

      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'enrollment_not_pending_payment_at_settlement', 'course_enrollment_id', new.course_enrollment_id));
      end if;
    else
      update public.event_tickets
        set status = 'valid'
        where id = new.event_ticket_id and status = 'pending_payment';

      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'ticket_not_pending_payment_at_settlement', 'event_ticket_id', new.event_ticket_id));
      end if;
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);

  return new;
end;
$$;

drop policy if exists "payments_select_participant" on public.payments;
create policy "payments_select_participant"
  on public.payments for select
  to authenticated
  using (
    exists (select 1 from public.orders o where o.id = payments.order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid()))
    or exists (select 1 from public.course_enrollments e where e.id = payments.course_enrollment_id and e.user_id = auth.uid())
    or exists (select 1 from public.event_tickets t where t.id = payments.event_ticket_id and t.attendee_id = auth.uid())
    or public.is_staff()
  );

drop policy if exists "payment_attempts_select_buyer" on public.payment_attempts;
create policy "payment_attempts_select_buyer"
  on public.payment_attempts for select
  to authenticated
  using (
    exists (
      select 1 from public.payments p
      left join public.orders o on o.id = p.order_id
      left join public.course_enrollments e on e.id = p.course_enrollment_id
      left join public.event_tickets t on t.id = p.event_ticket_id
      where p.id = payment_attempts.payment_id
        and (o.buyer_id = auth.uid() or e.user_id = auth.uid() or t.attendee_id = auth.uid() or public.is_staff())
    )
  );

-- Planification du nettoyage des billets pending_payment expirés (libère la
-- capacité). Gardée : ignorée proprement si pg_cron n'est pas installé (local).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('expire-stale-tickets', '*/5 * * * *', 'select public.expire_stale_tickets();');
  else
    raise notice 'pg_cron absent : planifier manuellement select public.expire_stale_tickets() (voir 0010).';
  end if;
end $$;
