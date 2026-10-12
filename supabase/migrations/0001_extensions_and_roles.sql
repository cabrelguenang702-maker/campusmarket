-- =============================================================================
-- 0001 — Fondations : extensions, fonctions utilitaires, rôles applicatifs
-- Réf. CampusMarket_Backend_Hardened_Security_Edition, sections 5 à 8, 42-43
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- emails insensibles à la casse

-- -----------------------------------------------------------------------------
-- updated_at automatique sur toute table qui en dispose
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rôles applicatifs (RBAC minimal — domaine "admin" du modèle de données)
-- Un utilisateur peut cumuler plusieurs rôles (ex. étudiant vérifié + modérateur).
-- Ne jamais laisser le front-end écrire dans cette table : RLS "deny all" par défaut,
-- seules des fonctions SECURITY DEFINER contrôlées (à ajouter au fil des phases) y écrivent.
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('student', 'moderator', 'support', 'admin', 'super_admin');

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

-- Un utilisateur peut lire ses propres rôles (utile pour adapter l'UI), jamais les modifier lui-même.
create policy "user_roles_select_own"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

-- Aucune policy insert/update/delete : voir règle "Ne jamais faire confiance au frontend
-- pour les permissions" (section 36). L'attribution de rôle passe par une fonction
-- SECURITY DEFINER dédiée (à livrer avec le module admin, phase 10-9) ou la service_role.

-- -----------------------------------------------------------------------------
-- Fonctions d'autorisation (SECURITY DEFINER minimales, cf. section 43)
-- STABLE + search_path figé pour éviter toute escalade de privilèges.
-- -----------------------------------------------------------------------------
create or replace function public.has_role(check_role public.app_role, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role = check_role
  );
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.is_staff(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = uid and role in ('moderator', 'support', 'admin', 'super_admin')
  );
$$;

comment on function public.is_admin is
  'Utilisée dans les policies RLS des tables admin/modération. Ne jamais exposer via l''API publique sans contrôle.';
