-- 0047 — Messages des déclencheurs d'espaces affichables tels quels
-- Convention du projet : une exception métier lève le code par défaut (P0001) et son message est montré à la personne
-- (voir friendlyError). 0045 utilisait 42501, que l'interface traduit par un message générique.
create or replace function public.enforce_space_member_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.space_role;
begin
  -- Fonction VOLONTAIREMENT non SECURITY DEFINER : current_user doit rester le rôle de l'appelant (authenticated) pour
  -- distinguer une action utilisateur d'une opération interne (cascade, fonctions du personnel : current_user = propriétaire).
  if v_actor is null or current_user not in ('authenticated', 'anon') or public.is_staff() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select role into v_actor_role from public.space_members where space_id = old.space_id and user_id = v_actor;

  if tg_op = 'DELETE' then
    if old.user_id = v_actor then
      -- Le propriétaire ne peut partir que s'il reste un autre responsable.
      if old.role = 'owner' and not exists (
        select 1 from public.space_members where space_id = old.space_id and user_id <> v_actor and role in ('owner', 'admin')
      ) then
        raise exception 'Le propriétaire ne peut pas quitter l''espace tant qu''il n''a pas nommé un autre administrateur';
      end if;
      return old;
    end if;
    -- Exclusion d'un autre membre : il faut le surclasser strictement (le propriétaire peut tout le monde sauf lui-même).
    if v_actor_role is null
       or (old.role = 'owner')
       or (old.role = 'admin' and v_actor_role <> 'owner')
       or (old.role = 'moderator' and v_actor_role not in ('owner', 'admin'))
       or (old.role = 'member' and v_actor_role not in ('owner', 'admin', 'moderator')) then
      raise exception 'Vous ne pouvez pas exclure ce membre';
    end if;
    return old;
  end if;

  -- UPDATE : changement de rôle
  if new.role is distinct from old.role then
    if old.role = 'owner' or new.role = 'owner' then
      raise exception 'Le rôle de propriétaire ne se modifie pas';
    end if;
    if (old.role = 'admin' or new.role = 'admin') and v_actor_role is distinct from 'owner' then
      raise exception 'Seul le propriétaire peut nommer ou retirer un administrateur';
    end if;
  end if;
  new.space_id := old.space_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  return new;
end;
$$;

create or replace function public.protect_space_post_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.author_id is distinct from old.author_id or new.space_id is distinct from old.space_id then
    raise exception 'Auteur et espace d''une publication ne se modifient pas';
  end if;
  if new.hidden_at is distinct from old.hidden_at or new.hidden_reason is distinct from old.hidden_reason then
    raise exception 'Le masquage relève de la modération';
  end if;
  -- Seul l'auteur modifie le contenu ; un modérateur n'agit que sur l'épinglage.
  if old.author_id is distinct from auth.uid()
     and (new.body is distinct from old.body or new.image_path is distinct from old.image_path) then
    raise exception 'Seul l''auteur peut modifier cette publication';
  end if;
  return new;
end;
$$;

