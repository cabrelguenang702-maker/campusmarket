-- =============================================================================
-- 0002 — Géographie : pays, universités
-- Réf. Backend_Hardened section 6 (domaine geo), correspond à /universites et à
-- l'étape "Pays" de l'inscription déjà construite côté front (_auth.inscription.*)
-- =============================================================================

create table public.countries (
  code char(2) primary key,                      -- ISO 3166-1 alpha-2, ex. "CM"
  name text not null,
  dial_code text not null,
  mobile_money_providers text[] not null default '{}',
  region text,                                     -- ex. "Afrique centrale" (cf. front university-directory.ts)
  created_at timestamptz not null default now()
);

alter table public.countries enable row level security;

-- Référentiel public : nécessaire dès la page d'accueil et l'inscription, avant authentification.
create policy "countries_select_public"
  on public.countries for select
  to authenticated, anon
  using (true);

create policy "countries_admin_write"
  on public.countries for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) >= 3),
  short_name text not null,
  city text not null,
  country_code char(2) not null references public.countries (code),
  student_count integer check (student_count >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (short_name, country_code)
);

create index universities_country_idx on public.universities (country_code);
create index universities_city_idx on public.universities (city);

create trigger set_universities_updated_at
  before update on public.universities
  for each row execute function public.set_updated_at();

alter table public.universities enable row level security;

create policy "universities_select_public"
  on public.universities for select
  to authenticated, anon
  using (active or public.is_staff());

create policy "universities_admin_write"
  on public.universities for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
