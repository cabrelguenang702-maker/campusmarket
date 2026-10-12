-- =============================================================================
-- 0019 — Support (FAQ + tickets). Pas de section dédiée dans le cahier des
-- charges (juste listé comme module dans l'arborescence backend, section 6) :
-- modélisé à partir du prototype front (mock-support.ts, _admin.admin.support).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FAQ — mêmes catégories que les tickets (le prototype front les partage déjà :
-- FaqCategory.id == SupportTicket.category), une seule table de catégories.
-- -----------------------------------------------------------------------------
create table public.faq_categories (
  slug text primary key,
  name text not null,
  icon text,
  sort_order integer not null default 0
);

alter table public.faq_categories enable row level security;

create policy "faq_categories_select_public"
  on public.faq_categories for select
  to authenticated, anon
  using (true);

create policy "faq_categories_staff_write"
  on public.faq_categories for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create table public.faq_items (
  id uuid primary key default gen_random_uuid(),
  category_slug text not null references public.faq_categories (slug),
  question text not null check (char_length(question) between 5 and 300),
  answer text not null check (char_length(answer) between 5 and 3000),
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index faq_items_category_idx on public.faq_items (category_slug, sort_order);

create trigger set_faq_items_updated_at
  before update on public.faq_items
  for each row execute function public.set_updated_at();

alter table public.faq_items enable row level security;

create policy "faq_items_select_published"
  on public.faq_items for select
  to authenticated, anon
  using (published);

create policy "faq_items_staff_all"
  on public.faq_items for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- TICKETS — même principe qu'une conversation de messagerie (0012), avec un
-- statut orienté "à qui la balle" plutôt qu'un simple ouvert/fermé :
-- ouvert (attend une réponse du support) / en_attente (attend une réponse de
-- l'utilisateur, le support vient de répondre) / resolu (décision du support) /
-- ferme (soit par l'utilisateur, soit automatiquement après resolu — ce dernier
-- point reste un job à ajouter si le besoin se confirme, pas fait ici).
-- -----------------------------------------------------------------------------
create type public.support_ticket_status as enum ('ouvert', 'en_attente', 'resolu', 'ferme');

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  subject text not null check (char_length(subject) between 3 and 200),
  category_slug text not null references public.faq_categories (slug),
  status public.support_ticket_status not null default 'ouvert',
  assigned_to uuid references public.profiles (id),
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_tickets_user_idx on public.support_tickets (user_id, updated_at desc);
create index support_tickets_status_idx on public.support_tickets (status, last_message_at desc);
create index support_tickets_assigned_idx on public.support_tickets (assigned_to) where assigned_to is not null;

create trigger set_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;

create policy "support_tickets_select_own_or_staff"
  on public.support_tickets for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy "support_tickets_insert_own"
  on public.support_tickets for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'ouvert' and assigned_to is null);

-- Deux policies UPDATE distinctes, chacune self-sufficient (reasserte sa
-- propre condition d'identité complète — voir la leçon documentée en 0014 sur
-- les WITH CHECK combinés par OR) : elles ne se recoupent jamais puisque l'une
-- est bornée par user_id = auth.uid() et l'autre par is_staff(), deux
-- prédicats mutuellement exclusifs pour un même utilisateur non-staff.
create policy "support_tickets_close_own"
  on public.support_tickets for update
  to authenticated
  using (user_id = auth.uid() and status <> 'ferme')
  with check (user_id = auth.uid() and status = 'ferme');

create policy "support_tickets_staff_manage"
  on public.support_tickets for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create or replace function public.enforce_ticket_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.subject is distinct from old.subject
     or new.category_slug is distinct from old.category_slug
     or new.user_id is distinct from old.user_id then
    raise exception 'Le sujet, la catégorie et l''auteur d''un ticket ne se modifient pas après création';
  end if;
  return new;
end;
$$;

create trigger support_tickets_immutable
  before update on public.support_tickets
  for each row execute function public.enforce_ticket_immutability();

comment on table public.support_tickets is
  'last_message_at/preview et status (hors fermeture par l''utilisateur) écrits par le trigger sur support_ticket_messages, pas par le client directement.';

-- -----------------------------------------------------------------------------
-- MESSAGES DE TICKET — immuables une fois envoyés (même principe que
-- messages, 0012), jamais d'update/delete côté client.
-- -----------------------------------------------------------------------------
create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text check (body is null or char_length(body) between 1 and 4000),
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null)
);

create index support_ticket_messages_ticket_idx on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_ticket_messages enable row level security;

create policy "support_ticket_messages_select_involved"
  on public.support_ticket_messages for select
  to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  );

-- Le demandeur ne peut écrire que sur SON ticket et seulement s'il n'est pas
-- fermé (rouvrir se fait explicitement : cf. trigger plus bas qui repasse le
-- ticket à 'ouvert', mais seulement depuis 'resolu'/'en_attente' — pas depuis
-- 'ferme', qui exige de facto un nouveau ticket, comme la plupart des outils
-- de support).
create policy "support_ticket_messages_insert_owner"
  on public.support_ticket_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid() and t.status <> 'ferme')
  );

create policy "support_ticket_messages_insert_staff"
  on public.support_ticket_messages for insert
  to authenticated
  with check (sender_id = auth.uid() and public.is_staff());

create or replace function public.handle_support_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.support_tickets;
  v_is_staff_sender boolean;
begin
  select * into v_ticket from public.support_tickets where id = new.ticket_id;
  v_is_staff_sender := public.is_staff(new.sender_id);

  update public.support_tickets
    set last_message_at = new.created_at,
        last_message_preview = case when new.body is not null then left(new.body, 140) else '[Pièce jointe]' end,
        status = case
          when v_is_staff_sender then 'en_attente'::public.support_ticket_status
          else 'ouvert'::public.support_ticket_status -- l'utilisateur écrit : rouvre si en_attente/resolu
        end,
        -- Auto-assignation à la première réponse d'un membre du support non
        -- encore assigné (convention courante des outils de support : qui
        -- répond en premier devient responsable, réassignable ensuite).
        assigned_to = case
          when v_is_staff_sender and assigned_to is null then new.sender_id
          else assigned_to
        end
    where id = new.ticket_id;

  if v_is_staff_sender and v_ticket.user_id <> new.sender_id then
    perform public.create_notification(v_ticket.user_id, 'systeme', 'support_reply', new.sender_id, 'support_ticket', new.ticket_id,
      '{}'::jsonb, 'support:' || new.ticket_id::text);
  end if;

  return new;
end;
$$;

create trigger support_ticket_messages_handle
  after insert on public.support_ticket_messages
  for each row execute function public.handle_support_ticket_message();

-- -----------------------------------------------------------------------------
-- PIÈCES JOINTES — bucket privé, même schéma d'autorisation que les messages
-- (0012) : demandeur du ticket ou staff, chemin <ticket_id>/<fichier>.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

create policy "support_attachments_select_involved"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'support-attachments'
    and (
      public.is_staff()
      or exists (
        select 1 from public.support_tickets t
        where t.id::text = (storage.foldername(name))[1] and t.user_id = auth.uid()
      )
    )
  );

create policy "support_attachments_insert_involved"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (
      public.is_staff()
      or exists (
        select 1 from public.support_tickets t
        where t.id::text = (storage.foldername(name))[1] and t.user_id = auth.uid() and t.status <> 'ferme'
      )
    )
  );
