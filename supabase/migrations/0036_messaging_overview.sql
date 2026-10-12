-- 0036 — Messagerie : ce que l'interface affiche et que la base ne fournissait pas.
--  * « Supprimer la conversation » : suppression pour soi uniquement (conversation_states.deleted_at) ; l'autre
--    participant garde la sienne. Les messages ne sont jamais effacés (immuabilité, modération, litiges).
--  * Un nouveau message désarchive et « restaure » la conversation chez les deux participants (l'interface le promet).
--  * Vue my_conversations : une ligne par conversation de l'utilisateur connecté, avec le correspondant, l'annonce liée,
--    les non-lus, l'archivage et l'état de blocage — pour trier, filtrer et compter côté serveur sans N+1.
alter table public.conversation_states add column deleted_at timestamptz;

create function public.tg_messages_revive_states() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_states
     set archived = false, deleted_at = null
   where conversation_id = new.conversation_id and (archived or deleted_at is not null);
  return null;
end $$;
revoke all on function public.tg_messages_revive_states() from public, anon, authenticated;
create trigger messages_revive_states after insert on public.messages
  for each row execute function public.tg_messages_revive_states();

create view public.my_conversations
with (security_invoker = true) as
select
  c.id,
  c.product_id,
  c.created_at,
  c.last_message_at,
  c.last_message_preview,
  o.other_id,
  pr.full_name as other_name,
  pr.avatar_url as other_avatar_url,
  pr.campus as other_campus,
  pr.verified as other_verified,
  coalesce(cs.archived, false) as archived,
  cs.deleted_at,
  (select count(*) from public.messages m
    where m.conversation_id = c.id and m.sender_id <> (select auth.uid()) and m.read_at is null)::integer as unread,
  p.name as product_name,
  p.price as product_price,
  p.category_slug as product_category,
  p.status as product_status,
  exists (select 1 from public.blocked_users b where b.blocker_id = (select auth.uid()) and b.blocked_id = o.other_id) as blocked_by_me,
  (public.is_blocked((select auth.uid()), o.other_id)
     and not exists (select 1 from public.blocked_users b where b.blocker_id = (select auth.uid()) and b.blocked_id = o.other_id)) as blocked_me
from public.conversations c
cross join lateral (select case when c.participant_one = (select auth.uid()) then c.participant_two else c.participant_one end as other_id) o
join public.profiles pr on pr.id = o.other_id
left join public.conversation_states cs on cs.conversation_id = c.id and cs.user_id = (select auth.uid())
left join public.products p on p.id = c.product_id
where c.participant_one = (select auth.uid()) or c.participant_two = (select auth.uid());

revoke all on public.my_conversations from anon, authenticated;
grant select on public.my_conversations to authenticated;
