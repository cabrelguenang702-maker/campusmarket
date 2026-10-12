-- 0048 — Achats groupés : intégrité de la base (avant tout branchement du paiement)
--
-- * FAILLE : la politique gpp_insert_self laissait n'importe quel utilisateur connecté s'inscrire comme participant d'un
--   achat groupé avec un `paid_amount` de son choix, sans rien payer, et donc faire monter le compteur jusqu'à l'objectif.
--   La participation ne pourra être créée que par une fonction contrôlée (paiement confirmé), jamais par le client.
-- * participant_count : compteur tenu par déclencheur (affichable publiquement, alors que la liste des participants
--   reste réservée aux participants).
-- * statut « reached » posé automatiquement quand l'objectif est atteint avant l'échéance.
-- * le vendeur ne peut plus modifier les conditions (objectif, échéance, produit, paliers) dès qu'une personne a rejoint,
--   ni se donner un statut « reached » / « expired » ; il peut seulement annuler un groupe actif.

drop policy if exists gpp_insert_self on public.group_purchase_participants;

alter table public.group_purchases
  add column if not exists participant_count integer not null default 0 check (participant_count >= 0);

update public.group_purchases g
   set participant_count = (select count(*) from public.group_purchase_participants p where p.group_purchase_id = g.id);

create or replace function public.sync_group_purchase_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := coalesce(new.group_purchase_id, old.group_purchase_id);
  v_count integer;
begin
  select count(*) into v_count from public.group_purchase_participants where group_purchase_id = v_group;
  update public.group_purchases
     set participant_count = v_count,
         status = case when status = 'active' and ends_at > now() and v_count >= target_participants then 'reached'::public.group_purchase_status else status end
   where id = v_group;
  return null;
end;
$$;

drop trigger if exists group_purchase_participants_count on public.group_purchase_participants;
create trigger group_purchase_participants_count after insert or delete on public.group_purchase_participants
  for each row execute function public.sync_group_purchase_count();

-- Fonction VOLONTAIREMENT non SECURITY DEFINER : current_user doit rester le rôle de l'appelant.
create or replace function public.protect_group_purchase_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.participant_count is distinct from old.participant_count then
    raise exception 'Le nombre de participants est calculé automatiquement';
  end if;
  if new.status is distinct from old.status and not (old.status = 'active' and new.status = 'cancelled') then
    raise exception 'Le statut d''un achat groupé évolue automatiquement ; vous pouvez seulement l''annuler';
  end if;
  if old.participant_count > 0
     and (new.target_participants is distinct from old.target_participants
          or new.ends_at is distinct from old.ends_at
          or new.product_id is distinct from old.product_id) then
    raise exception 'Les conditions ne peuvent plus changer : des étudiants ont déjà rejoint ce groupe';
  end if;
  return new;
end;
$$;

drop trigger if exists group_purchases_protect_columns on public.group_purchases;
create trigger group_purchases_protect_columns before update on public.group_purchases
  for each row execute function public.protect_group_purchase_columns();

create or replace function public.protect_group_purchase_tiers()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group uuid := coalesce(new.group_purchase_id, old.group_purchase_id);
begin
  if current_user in ('authenticated', 'anon')
     and exists (select 1 from public.group_purchases where id = v_group and participant_count > 0) then
    raise exception 'Les paliers ne peuvent plus changer : des étudiants ont déjà rejoint ce groupe';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists group_purchase_tiers_protect on public.group_purchase_tiers;
create trigger group_purchase_tiers_protect before insert or update or delete on public.group_purchase_tiers
  for each row execute function public.protect_group_purchase_tiers();

-- Un produit ne peut avoir qu'un seul achat groupé actif à la fois.
create unique index if not exists group_purchases_one_active_per_product on public.group_purchases (product_id) where status = 'active';
