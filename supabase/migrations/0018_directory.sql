-- =============================================================================
-- 0018 — Annuaire. Pas de section dédiée dans le cahier des charges (countries/
-- universities existent déjà en 0002, avec lecture publique et écriture admin :
-- c'est l'essentiel de l'annuaire). Deux trous concrets restaient, identifiés
-- dans le prototype front :
-- 1. flagByCountry est codé en dur côté front (src/lib/university-directory.ts) —
--    autant le stocker avec le pays, comme "region" l'est déjà.
-- 2. Le bouton "Suggérer mon université" (_auth.inscription.universite.tsx) ne
--    fait qu'un toast : aucune persistance, la suggestion est perdue.
-- =============================================================================

-- La colonne est peuplée dans seed.sql (les pays eux-mêmes n'existent qu'après
-- l'exécution du seed, qui tourne après toutes les migrations) et, pour un
-- projet réel, via countries_admin_write (0002) au moment de la création.
alter table public.countries add column flag_emoji text;

-- -----------------------------------------------------------------------------
-- SUGGESTIONS D'UNIVERSITÉ — n'importe quel utilisateur authentifié peut en
-- soumettre une ; seul le staff les traite. L'approbation crée la vraie ligne
-- dans `universities` (jamais le client), pour ne pas dupliquer les règles de
-- validation (unique (short_name, country_code), etc.) à deux endroits.
-- -----------------------------------------------------------------------------
create type public.suggestion_status as enum ('pending', 'approved', 'rejected');

create table public.university_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggested_by uuid not null references public.profiles (id),
  name text not null check (char_length(name) between 3 and 150),
  city text not null check (char_length(city) between 2 and 100),
  country_code char(2) not null references public.countries (code),
  note text check (note is null or char_length(note) <= 500),
  status public.suggestion_status not null default 'pending',
  handled_by uuid references public.profiles (id),
  resulting_university_id uuid references public.universities (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index university_suggestions_status_idx on public.university_suggestions (status, created_at);

create trigger set_university_suggestions_updated_at
  before update on public.university_suggestions
  for each row execute function public.set_updated_at();

alter table public.university_suggestions enable row level security;

create policy "university_suggestions_select_own_or_staff"
  on public.university_suggestions for select
  to authenticated
  using (suggested_by = auth.uid() or public.is_staff());

create policy "university_suggestions_insert_own"
  on public.university_suggestions for insert
  to authenticated
  with check (suggested_by = auth.uid() and status = 'pending');

-- Le staff ne modifie jamais resulting_university_id/status directement (voir
-- fonctions ci-dessous, même principe que les colonnes de modération en 0014) :
-- aucune policy UPDATE pour authenticated du tout, y compris staff.
comment on table public.university_suggestions is
  'Écriture réservée à review_university_suggestion() (SECURITY DEFINER) au-delà de la création par le suggéreur : jamais de policy UPDATE authenticated, pour que status/resulting_university_id restent cohérents entre eux (approved <=> resulting_university_id renseigné).';

create or replace function public.review_university_suggestion(
  p_suggestion_id uuid, p_approve boolean, p_short_name text default null, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suggestion public.university_suggestions;
  v_university_id uuid;
begin
  if not public.is_staff() then
    perform public.log_audit('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'failure',
      jsonb_build_object('reason', 'not_staff'));
    return jsonb_build_object('success', false, 'error', 'not_staff');
  end if;

  select * into v_suggestion from public.university_suggestions where id = p_suggestion_id and status = 'pending';
  if v_suggestion.id is null then
    return jsonb_build_object('success', false, 'error', 'not_found_or_already_handled');
  end if;

  if p_approve then
    -- Le sigle (short_name) n'est pas déduit automatiquement du nom complet
    -- (une troncature aurait pu produire un résultat absurde ou entrer en
    -- collision) : le staff le saisit explicitement au moment d'approuver.
    if p_short_name is null or char_length(trim(p_short_name)) = 0 then
      return jsonb_build_object('success', false, 'error', 'short_name_required');
    end if;

    insert into public.universities (name, short_name, city, country_code)
    values (v_suggestion.name, p_short_name, v_suggestion.city, v_suggestion.country_code)
    on conflict (short_name, country_code) do update set active = true
    returning id into v_university_id;

    update public.university_suggestions
      set status = 'approved', handled_by = auth.uid(), resulting_university_id = v_university_id
      where id = p_suggestion_id;
  else
    update public.university_suggestions
      set status = 'rejected', handled_by = auth.uid()
      where id = p_suggestion_id;
  end if;

  perform public.create_notification(
    v_suggestion.suggested_by, 'systeme',
    case when p_approve then 'university_suggestion_approved' else 'university_suggestion_rejected' end,
    null, 'university_suggestion', p_suggestion_id,
    case when p_approve then jsonb_build_object('university_id', v_university_id) else '{}'::jsonb end
  );

  perform public.log_audit('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'success',
    jsonb_build_object('approved', p_approve, 'note', p_note));

  return jsonb_build_object('success', true, 'university_id', v_university_id);
end;
$$;

grant execute on function public.review_university_suggestion(uuid, boolean, text, text) to authenticated;

comment on function public.review_university_suggestion is
  'p_short_name est obligatoire à l''approbation : jamais déduit automatiquement du nom complet suggéré (une troncature aurait pu produire un sigle absurde ou entrer en collision avec un existant).';
