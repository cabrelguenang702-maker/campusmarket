-- 0037 — « Supprimer la conversation » = effacer l'historique pour soi, pas seulement masquer le fil. Un nouveau message
-- fait réapparaître la conversation (désarchivée) mais l'historique antérieur à la suppression reste masqué pour celui qui
-- l'a supprimé. deleted_at devient donc « historique effacé avant cette date » et n'est plus remis à zéro (0036).
create or replace function public.tg_messages_revive_states() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_states set archived = false
   where conversation_id = new.conversation_id and archived;
  return null;
end $$;

-- `hidden` : conversation supprimée par l'utilisateur et sans message depuis (à exclure de sa boîte de réception).
create or replace view public.my_conversations
with (security_invoker = true) as
select
  c.id, c.product_id, c.created_at, c.last_message_at, c.last_message_preview, o.other_id,
  pr.full_name as other_name, pr.avatar_url as other_avatar_url, pr.campus as other_campus, pr.verified as other_verified,
  coalesce(cs.archived, false) as archived,
  cs.deleted_at,
  (select count(*) from public.messages m
    where m.conversation_id = c.id and m.sender_id <> (select auth.uid()) and m.read_at is null
      and (cs.deleted_at is null or m.created_at > cs.deleted_at))::integer as unread,
  p.name as product_name, p.price as product_price, p.category_slug as product_category, p.status as product_status,
  exists (select 1 from public.blocked_users b where b.blocker_id = (select auth.uid()) and b.blocked_id = o.other_id) as blocked_by_me,
  (public.is_blocked((select auth.uid()), o.other_id)
     and not exists (select 1 from public.blocked_users b where b.blocker_id = (select auth.uid()) and b.blocked_id = o.other_id)) as blocked_me,
  (cs.deleted_at is not null and (c.last_message_at is null or c.last_message_at <= cs.deleted_at)) as hidden
from public.conversations c
cross join lateral (select case when c.participant_one = (select auth.uid()) then c.participant_two else c.participant_one end as other_id) o
join public.profiles pr on pr.id = o.other_id
left join public.conversation_states cs on cs.conversation_id = c.id and cs.user_id = (select auth.uid())
left join public.products p on p.id = c.product_id
where c.participant_one = (select auth.uid()) or c.participant_two = (select auth.uid());
