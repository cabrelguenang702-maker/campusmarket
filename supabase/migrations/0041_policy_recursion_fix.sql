-- 0041 — Politiques qui se lisaient elles-mêmes (récursion avec les politiques « mfa_required » de 0039)
--
-- Trois politiques contenaient une sous-requête sur leur propre table ; combinées à une politique RESTRICTIVE, Postgres
-- répond « infinite recursion detected in policy ». On retire l'auto-référence :
--   * profiles / profile_private : la protection de `verified` / `phone_verified` passe par un déclencheur
--     (celui de `verified` existait déjà) ; `deactivated_at` n'est modifiable que par deactivate/reactivate_my_account().
--   * group_purchase_participants : l'appartenance au groupe est lue par une fonction SECURITY DEFINER.

create or replace function public.protect_profile_trust_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at)
     and current_user in ('authenticated', 'anon') then
    raise exception 'La vérification d''un compte ne se modifie que via admin_review_verification / admin_verify_user';
  end if;
  if new.deactivated_at is distinct from old.deactivated_at and current_user in ('authenticated', 'anon') then
    raise exception 'La désactivation se fait via deactivate_my_account() / reactivate_my_account()';
  end if;
  return new;
end;
$$;

create or replace function public.protect_private_trust_columns()
returns trigger
language plpgsql
as $$
begin
  if new.phone_verified is distinct from old.phone_verified and current_user in ('authenticated', 'anon') then
    raise exception 'La vérification du téléphone ne se modifie que par le code reçu par SMS';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_private_trust_columns on public.profile_private;
create trigger protect_private_trust_columns before update on public.profile_private
  for each row execute function public.protect_private_trust_columns();

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists profile_private_update_own on public.profile_private;
create policy profile_private_update_own on public.profile_private for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.is_group_purchase_member(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_purchase_participants
    where group_purchase_id = p_group and buyer_id = p_user
  );
$$;

revoke all on function public.is_group_purchase_member(uuid, uuid) from public, anon;
grant execute on function public.is_group_purchase_member(uuid, uuid) to authenticated;

drop policy if exists gpp_select_group_members on public.group_purchase_participants;
create policy gpp_select_group_members on public.group_purchase_participants for select to authenticated
  using (buyer_id = (select auth.uid()) or (select public.is_staff()) or public.is_group_purchase_member(group_purchase_id, (select auth.uid())));
