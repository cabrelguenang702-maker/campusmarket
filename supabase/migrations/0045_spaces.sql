-- 0045 — Communautés et groupes : données de référence, garde-fous de rôles, vues et images
--
-- * space_categories : les sept catégories de l'interface (table vide jusqu'ici : aucun espace ne pouvait être créé)
-- * report_target_type : ajout de « post » (signalement d'une publication)
-- * space_members : un modérateur pouvait exclure un administrateur, un admin pouvait rétrograder le propriétaire,
--   le propriétaire pouvait quitter et laisser l'espace sans responsable → déclencheur de hiérarchie
-- * space_posts : un modérateur pouvait RÉÉCRIRE le texte d'une autre personne (la politique d'épinglage ouvre toutes les
--   colonnes) ; l'auteur pouvait changer d'espace ou lever un masquage → déclencheur de colonnes protégées
-- * space_posts_feed / space_members_list : vues (security_invoker, donc soumises à la RLS) avec auteur, réactions, commentaires
-- * bucket space-media : images des publications, lisibles par les membres de l'espace seulement

insert into public.space_categories (slug, name, sort_order) values
  ('technologie', 'Technologie', 1),
  ('entrepreneuriat', 'Entrepreneuriat', 2),
  ('vie-de-campus', 'Vie de campus', 3),
  ('creativite', 'Créativité', 4),
  ('classe', 'Classe', 5),
  ('sport', 'Sport', 6),
  ('etudes', 'Études', 7)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

alter type public.report_target_type add value if not exists 'post';

-- ---------------------------------------------------------------------------------------------
-- Hiérarchie des rôles : owner > admin > moderator > member
-- ---------------------------------------------------------------------------------------------
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
        raise exception 'Le propriétaire ne peut pas quitter l''espace tant qu''il n''a pas nommé un autre administrateur' using errcode = '42501';
      end if;
      return old;
    end if;
    -- Exclusion d'un autre membre : il faut le surclasser strictement (le propriétaire peut tout le monde sauf lui-même).
    if v_actor_role is null
       or (old.role = 'owner')
       or (old.role = 'admin' and v_actor_role <> 'owner')
       or (old.role = 'moderator' and v_actor_role not in ('owner', 'admin'))
       or (old.role = 'member' and v_actor_role not in ('owner', 'admin', 'moderator')) then
      raise exception 'Vous ne pouvez pas exclure ce membre' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE : changement de rôle
  if new.role is distinct from old.role then
    if old.role = 'owner' or new.role = 'owner' then
      raise exception 'Le rôle de propriétaire ne se modifie pas' using errcode = '42501';
    end if;
    if (old.role = 'admin' or new.role = 'admin') and v_actor_role is distinct from 'owner' then
      raise exception 'Seul le propriétaire peut nommer ou retirer un administrateur' using errcode = '42501';
    end if;
  end if;
  new.space_id := old.space_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  return new;
end;
$$;

drop trigger if exists space_members_hierarchy on public.space_members;
create trigger space_members_hierarchy before update or delete on public.space_members
  for each row execute function public.enforce_space_member_hierarchy();

-- ---------------------------------------------------------------------------------------------
-- Colonnes protégées des publications
-- ---------------------------------------------------------------------------------------------
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
    raise exception 'Auteur et espace d''une publication ne se modifient pas' using errcode = '42501';
  end if;
  if new.hidden_at is distinct from old.hidden_at or new.hidden_reason is distinct from old.hidden_reason then
    raise exception 'Le masquage relève de la modération' using errcode = '42501';
  end if;
  -- Seul l'auteur modifie le contenu ; un modérateur n'agit que sur l'épinglage.
  if old.author_id is distinct from auth.uid()
     and (new.body is distinct from old.body or new.image_path is distinct from old.image_path) then
    raise exception 'Seul l''auteur peut modifier cette publication' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists space_posts_protect_columns on public.space_posts;
create trigger space_posts_protect_columns before update on public.space_posts
  for each row execute function public.protect_space_post_columns();

-- ---------------------------------------------------------------------------------------------
-- Vues de lecture (soumises à la RLS de l'appelant)
-- ---------------------------------------------------------------------------------------------
create or replace view public.space_posts_feed with (security_invoker = true) as
select
  p.id,
  p.space_id,
  p.author_id,
  pr.full_name as author_name,
  pr.avatar_url as author_avatar,
  p.body,
  p.image_path,
  p.pinned,
  p.created_at,
  coalesce((select jsonb_object_agg(k.kind, k.n)
              from (select r.kind, count(*) as n from public.space_post_reactions r where r.post_id = p.id group by r.kind) k),
           '{}'::jsonb) as reactions,
  (select count(*) from public.space_post_comments c where c.post_id = p.id and c.hidden_at is null)::int as comment_count,
  (select r.kind from public.space_post_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_reaction
from public.space_posts p
join public.profiles pr on pr.id = p.author_id
where p.hidden_at is null;

create or replace view public.space_members_list with (security_invoker = true) as
select m.space_id, m.user_id, m.role, m.joined_at, pr.full_name, pr.avatar_url, pr.campus, pr.verified
from public.space_members m
join public.profiles pr on pr.id = m.user_id;

grant select on public.space_posts_feed, public.space_members_list to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Images des publications : <space_id>/<user_id>/<fichier>
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('space-media', 'space-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function public.space_media_space_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case when (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((storage.foldername(p_name))[1])::uuid end;
$$;

drop policy if exists space_media_select_member on storage.objects;
create policy space_media_select_member on storage.objects for select to authenticated
  using (bucket_id = 'space-media' and public.is_space_member(public.space_media_space_id(name)));

drop policy if exists space_media_insert_member on storage.objects;
create policy space_media_insert_member on storage.objects for insert to authenticated
  with check (
    bucket_id = 'space-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_space_member(public.space_media_space_id(name))
  );

drop policy if exists space_media_delete_own on storage.objects;
create policy space_media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'space-media' and (storage.foldername(name))[2] = (select auth.uid())::text);
