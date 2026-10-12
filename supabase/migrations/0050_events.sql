-- 0050 — Événements : catalogue exploitable et billetterie sans impasse
--
-- * event_categories : cinq catégories (table vide jusqu'ici : aucun événement ne pouvait être créé)
-- * events.program : programme [{time, title}] affiché sur la fiche
-- * IMPASSE : la contrainte UNIQUE (event_id, attendee_id) couvrait aussi les billets annulés. Une personne dont le paiement
--   avait expiré (annulation automatique toutes les 5 min) ou qui avait annulé son billet ne pouvait JAMAIS se réinscrire.
--   L'unicité ne vaut plus que pour les billets actifs (en attente de paiement, valides, utilisés).
-- * plus de billet sur un événement terminé
-- * l'organisateur ne peut plus fausser `tickets_sold`, baisser la capacité sous les places prises, changer le prix une fois des
--   billets émis, ni repasser un événement annulé en « publié »

insert into public.event_categories (slug, name, sort_order) values
  ('technologie', 'Technologie', 1),
  ('vie-de-campus', 'Vie de campus', 2),
  ('carriere', 'Carrière', 3),
  ('sport', 'Sport', 4),
  ('culture', 'Culture', 5)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

alter table public.events
  add column if not exists program jsonb not null default '[]'::jsonb;
alter table public.events drop constraint if exists events_program_is_array;
alter table public.events add constraint events_program_is_array
  check (jsonb_typeof(program) = 'array' and jsonb_array_length(program) <= 20);

alter table public.event_tickets drop constraint if exists event_tickets_event_id_attendee_id_key;
create unique index if not exists event_tickets_one_active_per_attendee
  on public.event_tickets (event_id, attendee_id) where status in ('pending_payment', 'valid', 'used');

create or replace function public.reserve_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_taken integer;
  v_end timestamptz;
begin
  select capacity, coalesce(ends_at, starts_at + interval '6 hours') into v_capacity, v_end
    from public.events where id = new.event_id for update;

  if v_capacity is null then
    raise exception 'Événement introuvable : %', new.event_id;
  end if;
  if v_end <= now() then
    raise exception 'Les inscriptions sont closes : cet événement est terminé';
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

-- Fonction VOLONTAIREMENT non SECURITY DEFINER : current_user doit rester le rôle de l'appelant.
create or replace function public.protect_event_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'L''organisateur d''un événement ne se modifie pas';
  end if;
  if new.tickets_sold is distinct from old.tickets_sold then
    raise exception 'Le nombre de billets vendus est calculé automatiquement';
  end if;
  if new.capacity < old.tickets_sold then
    raise exception 'La capacité ne peut pas être inférieure aux % places déjà prises', old.tickets_sold;
  end if;
  if new.price is distinct from old.price and old.tickets_sold > 0 then
    raise exception 'Le prix ne peut plus changer : des billets ont déjà été émis';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('published', 'cancelled'))
    or (old.status = 'published' and new.status = 'cancelled')) then
    raise exception 'Ce changement de statut n''est pas autorisé';
  end if;
  return new;
end;
$$;

drop trigger if exists events_protect_columns on public.events;
create trigger events_protect_columns before update on public.events
  for each row execute function public.protect_event_columns();
