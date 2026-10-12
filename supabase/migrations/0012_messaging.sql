-- =============================================================================
-- 0012 — Messagerie (1 à 1). Réf. Backend_Hardened section 17 : persistance
-- avant diffusion realtime (Supabase Realtime écoute cette table, ne fait
-- aucune écriture), vérification serveur de l'appartenance, pièces jointes
-- via Storage + policies, états envoyé/reçu/lu, blocage, rate limit,
-- pagination (index, jamais de chargement illimité — imposé côté client par
-- construction des requêtes, la DB fournit juste les index qui le permettent).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BLOCAGE — vérifié avant toute création de conversation ou envoi de message.
-- -----------------------------------------------------------------------------
create table public.blocked_users (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocked_users enable row level security;

create policy "blocked_users_select_own"
  on public.blocked_users for select
  to authenticated
  using (blocker_id = auth.uid());

create policy "blocked_users_insert_own"
  on public.blocked_users for insert
  to authenticated
  with check (blocker_id = auth.uid());

create policy "blocked_users_delete_own"
  on public.blocked_users for delete
  to authenticated
  using (blocker_id = auth.uid());

create or replace function public.is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

comment on function public.is_blocked is
  'SECURITY DEFINER indispensable : sans ça, appelée par la victime du blocage (jamais blocker_id=elle-même), blocked_users_select_own (RLS) lui masquerait la ligne créée par l''autre partie et is_blocked renverrait toujours faux pour elle — même bug de fond que has_role/is_admin/is_staff en 0001.';

-- -----------------------------------------------------------------------------
-- CONVERSATIONS — une conversation générale par paire d'utilisateurs, plus une
-- conversation par (paire, annonce) puisque le prototype front rattache
-- chaque fil à une annonce précise ("Contacter le vendeur" depuis une fiche
-- produit). participant_low/high (générées, triées) rendent la paire
-- order-independent pour l'unicité, sans dépendre de qui a initié le contact.
-- -----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  participant_one uuid not null references public.profiles (id),
  participant_two uuid not null references public.profiles (id),
  participant_low uuid generated always as (least(participant_one, participant_two)) stored,
  participant_high uuid generated always as (greatest(participant_one, participant_two)) stored,
  product_id uuid references public.products (id),
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  check (participant_one <> participant_two)
);

-- Une seule conversation "générale" (sans annonce) par paire, mais plusieurs
-- conversations possibles pour la même paire si elles portent sur des
-- annonces différentes (NULL n'est pas égal à NULL dans un index unique
-- classique, d'où les deux index partiels ci-dessous plutôt qu'un seul).
create unique index conversations_pair_product_uidx
  on public.conversations (participant_low, participant_high, product_id)
  where product_id is not null;

create unique index conversations_pair_general_uidx
  on public.conversations (participant_low, participant_high)
  where product_id is null;

create index conversations_participant_one_idx on public.conversations (participant_one, last_message_at desc);
create index conversations_participant_two_idx on public.conversations (participant_two, last_message_at desc);

alter table public.conversations enable row level security;

create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (participant_one = auth.uid() or participant_two = auth.uid() or public.is_staff());

create policy "conversations_insert_participant"
  on public.conversations for insert
  to authenticated
  with check (
    (participant_one = auth.uid() or participant_two = auth.uid())
    and not public.is_blocked(participant_one, participant_two)
  );

comment on table public.conversations is
  'Pas de policy update/delete pour les participants : archivage géré par participant dans conversation_states (par-utilisateur, pas partagé), last_message_at/preview écrits uniquement par le trigger messages_update_conversation.';

-- -----------------------------------------------------------------------------
-- ÉTAT PAR PARTICIPANT — l'archivage est individuel (si je l'archive, l'autre
-- personne continue de la voir dans sa boîte de réception). Provisionné
-- automatiquement pour les deux participants à la création, jamais par le
-- client directement.
-- -----------------------------------------------------------------------------
create table public.conversation_states (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create trigger set_conversation_states_updated_at
  before update on public.conversation_states
  for each row execute function public.set_updated_at();

alter table public.conversation_states enable row level security;

create policy "conversation_states_select_own"
  on public.conversation_states for select
  to authenticated
  using (user_id = auth.uid());

create policy "conversation_states_update_own"
  on public.conversation_states for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.provision_conversation_states()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversation_states (conversation_id, user_id)
  values (new.id, new.participant_one), (new.id, new.participant_two);
  return new;
end;
$$;

create trigger conversations_provision_states
  after insert on public.conversations
  for each row execute function public.provision_conversation_states();

-- -----------------------------------------------------------------------------
-- MESSAGES — persistés avant toute diffusion realtime (Supabase Realtime
-- écoute les changements de cette table côté client, aucune écriture de sa
-- part). États envoyé (created_at) / reçu (delivered_at) / lu (read_at),
-- positionnés uniquement par le destinataire, jamais par l'expéditeur, et
-- jamais annulables une fois posés (trigger d'immuabilité plus bas).
-- -----------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text check (body is null or char_length(body) between 1 and 4000),
  attachment_path text,
  attachment_kind text check (attachment_kind is null or attachment_kind in ('image', 'file')),
  attachment_name text,
  attachment_size_bytes integer check (attachment_size_bytes is null or attachment_size_bytes > 0),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or attachment_path is not null),
  check (attachment_path is null or attachment_kind is not null)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_rate_idx on public.messages (sender_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where read_at is null;

alter table public.messages enable row level security;

create policy "messages_select_participant"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
    )
    or public.is_staff()
  );

create policy "messages_insert_sender"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
        and not public.is_blocked(c.participant_one, c.participant_two)
    )
  );

-- Le destinataire (jamais l'expéditeur) peut positionner delivered_at/read_at.
-- Le détail — pas de retour en arrière, contenu figé — est imposé par le
-- trigger d'immuabilité ci-dessous, pas par cette policy (plus simple que
-- d'exprimer une comparaison avec l'ancienne valeur dans un WITH CHECK RLS).
create policy "messages_mark_status_recipient"
  on public.messages for update
  to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
    )
  )
  with check (sender_id <> auth.uid());

create or replace function public.enforce_message_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     or new.attachment_path is distinct from old.attachment_path
     or new.attachment_kind is distinct from old.attachment_kind
     or new.sender_id is distinct from old.sender_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'Un message ne peut pas être modifié après envoi (seuls delivered_at/read_at le peuvent)';
  end if;

  if old.delivered_at is not null and new.delivered_at is null then
    raise exception 'delivered_at ne peut pas être annulé une fois positionné';
  end if;
  if old.read_at is not null and new.read_at is null then
    raise exception 'read_at ne peut pas être annulé une fois positionné';
  end if;

  return new;
end;
$$;

create trigger messages_immutable
  before update on public.messages
  for each row execute function public.enforce_message_immutability();

-- Anti-flood (section 17, "rate limit spécifique à l'envoi de messages") :
-- invariant structurel, comme le verrou de stock des réservations — pas une
-- règle métier calculée, donc légitime en trigger plutôt qu'en couche service.
create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.messages
  where sender_id = new.sender_id and created_at > now() - interval '1 minute';

  if v_count >= 20 then
    raise exception 'Trop de messages envoyés en une minute, réessayez dans un instant';
  end if;

  return new;
end;
$$;

create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

-- Cache d'affichage pour la liste des conversations (tri, aperçu) — simple
-- dénormalisation structurelle, pas un calcul métier (cf. remarque similaire
-- sur reserved_quantity en 0008).
create or replace function public.update_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
    set last_message_at = new.created_at,
        last_message_preview = case
          when new.body is not null then left(new.body, 140)
          else '[Pièce jointe]'
        end
    where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_update_conversation
  after insert on public.messages
  for each row execute function public.update_conversation_last_message();

-- =============================================================================
-- STOCKAGE DES PIÈCES JOINTES — bucket privé, policies vérifiant
-- l'appartenance à la conversation via le premier segment du chemin
-- (convention : <conversation_id>/<uuid>-<nom-fichier>).
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

create policy "message_attachments_select_participant"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
    )
  );

create policy "message_attachments_insert_participant"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.participant_one = auth.uid() or c.participant_two = auth.uid())
        and not public.is_blocked(c.participant_one, c.participant_two)
    )
  );

comment on table public.messages is
  'attachment_path pointe vers le bucket Storage message-attachments (convention <conversation_id>/<fichier>) ; les policies storage.objects ci-dessus vérifient l''appartenance à la conversation avant tout accès.';

-- -----------------------------------------------------------------------------
-- REALTIME — une table doit être explicitement ajoutée à la publication
-- supabase_realtime pour que les clients puissent s'y abonner (section 17,
-- "Supabase Realtime pour nouveaux messages, statut de lecture"). Idempotent :
-- ne re-déclare pas la table si elle y est déjà (ex. rejoué après un ajout
-- manuel depuis le Dashboard).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_states'
  ) then
    -- Pour que le statut "lu" et l'archivage se propagent en temps réel entre
    -- les onglets/appareils d'un même utilisateur, pas seulement entre les deux
    -- participants.
    alter publication supabase_realtime add table public.conversation_states;
  end if;
exception when undefined_object then
  -- La publication supabase_realtime n'existe que sur un vrai projet Supabase,
  -- pas en Postgres local nu (voir tests) : on ignore proprement dans ce cas.
  raise notice 'Publication supabase_realtime absente (normal en local hors Supabase) : realtime à activer manuellement en prod si besoin.';
end $$;
