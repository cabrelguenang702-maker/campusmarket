-- =============================================================================
-- 0002 — Identité : profils publics / privés, provisioning automatique
-- Réf. Backend_Hardened section 6 (domaine identity), section 8 (RLS),
--      section 9 (auth/sessions), section 30 (Profil / sécurité)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles : tout ce qui est visible par les autres utilisateurs (vendeur, membre
-- d'une communauté, etc.). Ne contient jamais d'email/téléphone en clair.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  avatar_url text,
  bio text check (char_length(bio) <= 300),
  university_id uuid references public.universities (id) on delete set null,
  campus text,
  city text,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Informations publiques d''un utilisateur. La vérification (verified) ne peut être positionnée que par le workflow admin, jamais par l''utilisateur lui-même (cf. policy update ci-dessous).';

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Lecture publique : nécessaire pour afficher vendeurs, membres, organisateurs d'événements, etc.
create policy "profiles_select_public"
  on public.profiles for select
  to authenticated, anon
  using (true);

-- Un utilisateur ne modifie que sa propre ligne, et jamais les colonnes de confiance
-- (verified/verified_at) : la clause WITH CHECK compare l'ancienne et la nouvelle valeur.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and verified = (select p.verified from public.profiles p where p.id = auth.uid())
  );

create policy "profiles_admin_update"
  on public.profiles for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Pas de policy insert directe : la ligne est créée par le trigger handle_new_user ci-dessous
-- (aucune confiance accordée au client sur la création de son propre profil).

-- -----------------------------------------------------------------------------
-- profile_private : email/téléphone, jamais exposés à un autre utilisateur.
-- Séparée de `profiles` pour qu'une policy trop permissive sur l'une n'expose pas l'autre.
-- -----------------------------------------------------------------------------
create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  email citext not null unique,
  phone text unique,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profile_private_updated_at
  before update on public.profile_private
  for each row execute function public.set_updated_at();

alter table public.profile_private enable row level security;

create policy "profile_private_select_own"
  on public.profile_private for select
  to authenticated
  using (id = auth.uid());

create policy "profile_private_update_own"
  on public.profile_private for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and phone_verified = (select pp.phone_verified from public.profile_private pp where pp.id = auth.uid()));

create policy "profile_private_admin_select"
  on public.profile_private for select
  to authenticated
  using (public.is_staff());

-- -----------------------------------------------------------------------------
-- Provisioning automatique : à l'inscription (auth.users), on crée profiles +
-- profile_private + rôle 'student' par défaut, dans une seule transaction.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));

  insert into public.profile_private (id, email)
  values (new.id, new.email);

  insert into public.user_roles (user_id, role)
  values (new.id, 'student');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
