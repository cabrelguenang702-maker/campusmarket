-- 0053 — Support côté personnel : trois trous fermés + historique complet
--
--   * Un membre du personnel pouvait écrire assigned_to / last_message_* d'un ticket directement (politique
--     support_tickets_staff_manage), donc assigner à n'importe quel profil sans contrôle ni trace, contournant
--     admin_assign_ticket. Désormais, côté client (personnel compris), seul le STATUT se modifie ; l'assignation passe
--     par admin_assign_ticket (agents vérifiés, journalisée) ou par l'auto-assignation à la première réponse.
--   * Un message du personnel sur un ticket FERMÉ le rouvrait en silence (le déclencheur le repassait en « en attente »
--     et le demandeur pouvait de nouveau écrire). Un ticket fermé ne reçoit plus de message de personne ; le personnel
--     peut le rouvrir explicitement en changeant son statut.
--   * Seule l'assignation était journalisée : les passages de/vers « résolu » et « fermé » le sont désormais aussi
--     (les bascules automatiques ouvert/en attente, à chaque message, restent hors journal pour ne pas le noyer).
--   * admin_ticket_history renvoie assignations ET changements de statut.

create or replace function public.enforce_ticket_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subject is distinct from old.subject
     or new.category_slug is distinct from old.category_slug
     or new.user_id is distinct from old.user_id then
    raise exception 'Le sujet, la catégorie et l''auteur d''un ticket ne se modifient pas après création';
  end if;
  if current_user in ('authenticated', 'anon')
     and (new.assigned_to is distinct from old.assigned_to
          or new.last_message_at is distinct from old.last_message_at
          or new.last_message_preview is distinct from old.last_message_preview) then
    raise exception 'Seul le statut du ticket peut être modifié';
  end if;
  return new;
end;
$$;

create or replace function public.guard_support_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if exists (select 1 from public.support_tickets where id = new.ticket_id and status = 'ferme') then
    raise exception 'Ce ticket est fermé. Rouvrez-le pour y répondre, ou ouvrez un nouveau ticket.';
  end if;

  if new.attachment_path is not null then
    if new.attachment_path not like new.ticket_id::text || '/%' then
      raise exception 'La pièce jointe doit appartenir à ce ticket';
    end if;
    if new.attachment_name is null or char_length(trim(new.attachment_name)) = 0 then
      raise exception 'La pièce jointe doit avoir un nom';
    end if;
  end if;

  if private.in_client_context() and not public.is_staff(new.sender_id) then
    perform pg_advisory_xact_lock(hashtextextended('support_ticket_messages:' || new.sender_id::text, 0));
    select count(*) into v_count from public.support_ticket_messages
      where sender_id = new.sender_id and created_at > now() - interval '1 hour';
    if v_count >= 30 then
      raise exception 'Vous avez envoyé beaucoup de messages en peu de temps. Réessayez dans une heure.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.audit_support_ticket_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.status is distinct from old.status
     and (new.status in ('resolu', 'ferme') or old.status in ('resolu', 'ferme')) then
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, result, metadata)
    values (auth.uid(), 'ticket_status', 'support_ticket', new.id, 'success',
            jsonb_build_object('from', old.status::text, 'to', new.status::text));
  end if;
  return null;
end;
$$;
revoke all on function public.audit_support_ticket_status() from public, anon, authenticated;
drop trigger if exists support_tickets_audit_status on public.support_tickets;
create trigger support_tickets_audit_status after update of status on public.support_tickets
  for each row execute function public.audit_support_ticket_status();

drop function if exists public.admin_ticket_history(uuid);
create function public.admin_ticket_history(p_ticket_id uuid)
returns table (at timestamptz, kind text, actor_name text, from_value text, to_value text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.act_as_staff() then
    raise exception 'Permission refusée' using errcode = '42501';
  end if;
  return query
  select a.created_at,
         case when a.action = 'assign_ticket' then 'assign' else 'status' end,
         actor.full_name,
         case when a.action = 'assign_ticket' then f.full_name else a.metadata ->> 'from' end,
         case when a.action = 'assign_ticket' then t.full_name else a.metadata ->> 'to' end
  from public.audit_logs a
  left join public.profiles actor on actor.id = a.actor_id
  left join public.profiles f on f.id = case when a.action = 'assign_ticket' then nullif(a.metadata ->> 'from', '')::uuid end
  left join public.profiles t on t.id = case when a.action = 'assign_ticket' then nullif(a.metadata ->> 'to', '')::uuid end
  where a.resource_type = 'support_ticket' and a.resource_id = p_ticket_id
    and a.action in ('assign_ticket', 'ticket_status') and a.result = 'success'
  order by a.created_at;
end;
$$;
revoke all on function public.admin_ticket_history(uuid) from public, anon;
grant execute on function public.admin_ticket_history(uuid) to authenticated;
