-- 0055 — Frais d'inscription (1 000 F, paiement unique, tous pays) : cible de paiement « inscription », règle d'accès côté base.
-- Choix validés : frais obligatoires et à vie ; tant qu'ils ne sont pas réglés le compte reste en attente (l'application renvoie vers
-- le paiement) et la base refuse de publier une annonce, passer commande ou écrire. Le personnel est exempté. Le montant vient de la base.

alter table public.profiles add column if not exists registration_paid_at timestamptz;

-- La date de paiement ne se modifie que par le règlement du paiement (SECURITY DEFINER), jamais depuis un client.
create or replace function public.protect_profile_trust_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at)
     and current_user in ('authenticated', 'anon') then
    raise exception 'La vérification d''un compte ne se modifie que via admin_review_verification / admin_verify_user';
  end if;
  if new.deactivated_at is distinct from old.deactivated_at and current_user in ('authenticated', 'anon') then
    raise exception 'La désactivation se fait via deactivate_my_account() / reactivate_my_account()';
  end if;
  if new.registration_paid_at is distinct from old.registration_paid_at and current_user in ('authenticated', 'anon') then
    raise exception 'Le règlement de l''inscription ne se modifie que par un paiement confirmé';
  end if;
  return new;
end;
$$;

create or replace function public.registration_fee() returns integer
language sql immutable parallel safe set search_path = '' as $$ select 1000 $$;

create table public.registration_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  amount integer not null check (amount > 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid')),
  created_at timestamptz not null default now()
);
alter table public.registration_payments enable row level security;
create policy registration_payments_select_own on public.registration_payments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());
create policy mfa_required on public.registration_payments as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
comment on table public.registration_payments is 'Aucune policy d''écriture : créée par l''Edge Function registration-initiate, réglée par apply_payment_settlement.';

-- Cible de paiement « inscription » : exactement une cible parmi cinq.
alter table public.payments add column registration_id uuid references public.registration_payments (id) on delete cascade;
create index payments_registration_id_idx on public.payments (registration_id) where registration_id is not null;
create unique index payments_registration_id_key on public.payments (registration_id) where registration_id is not null;
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%num_nonnulls%';
  execute format('alter table public.payments drop constraint %I', c);
end $$;
alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id, group_unblock_id, registration_id) = 1);

drop policy payments_select_participant on public.payments;
create policy payments_select_participant on public.payments for select to authenticated using (
  exists (select 1 from public.orders o where o.id = payments.order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid()))
  or exists (select 1 from public.course_enrollments e where e.id = payments.course_enrollment_id and e.user_id = auth.uid())
  or exists (select 1 from public.event_tickets t where t.id = payments.event_ticket_id and t.attendee_id = auth.uid())
  or exists (select 1 from public.group_buy_unblocks u where u.id = payments.group_unblock_id and u.user_id = auth.uid())
  or exists (select 1 from public.registration_payments r where r.id = payments.registration_id and r.user_id = auth.uid())
  or public.is_staff()
);

create or replace function public.apply_payment_settlement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    if new.order_id is not null then
      update public.orders set status = 'paid' where id = new.order_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'order_not_pending_payment_at_settlement', 'order_id', new.order_id));
      end if;
    elsif new.course_enrollment_id is not null then
      update public.course_enrollments set status = 'active' where id = new.course_enrollment_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'enrollment_not_pending_payment_at_settlement', 'course_enrollment_id', new.course_enrollment_id));
      end if;
    elsif new.group_unblock_id is not null then
      update public.group_buy_unblocks set status = 'paid' where id = new.group_unblock_id and status = 'pending_payment'
        returning user_id into v_user;
      if v_user is not null then
        delete from public.group_buy_blocks where user_id = v_user;
        perform public.create_notification(v_user, 'groupe', 'group_buy_unblocked', null, 'group_buy_unblock', new.group_unblock_id, '{}'::jsonb, 'gbu:' || new.group_unblock_id);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'unblock_not_pending_payment_at_settlement', 'group_unblock_id', new.group_unblock_id));
      end if;
    elsif new.registration_id is not null then
      update public.registration_payments set status = 'paid' where id = new.registration_id and status = 'pending_payment'
        returning user_id into v_user;
      if v_user is not null then
        update public.profiles set registration_paid_at = now() where id = v_user and registration_paid_at is null;
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'registration_not_pending_payment_at_settlement', 'registration_id', new.registration_id));
      end if;
    else
      update public.event_tickets set status = 'valid' where id = new.event_ticket_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'ticket_not_pending_payment_at_settlement', 'event_ticket_id', new.event_ticket_id));
      end if;
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);
  return new;
end;
$$;

-- Inscription réglée ? Le personnel est exempté (comptes créés par l'équipe).
create or replace function public.registration_paid(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
    exists (select 1 from public.profiles where id = uid and registration_paid_at is not null)
    or exists (select 1 from public.user_roles where user_id = uid and role in ('moderator', 'support', 'admin', 'super_admin', 'financial_manager'))
  );
$$;
revoke execute on function public.registration_paid(uuid) from public, anon;
grant execute on function public.registration_paid(uuid) to authenticated;
revoke execute on function public.registration_fee() from public, anon;
grant execute on function public.registration_fee() to authenticated;

-- Règle d'accès : sans inscription réglée, pas de publication, de commande ni de message.
create policy registration_paid_insert on public.products as restrictive for insert to authenticated with check ((select public.registration_paid()));
create policy registration_paid_insert on public.orders as restrictive for insert to authenticated with check ((select public.registration_paid()));
create policy registration_paid_insert on public.conversations as restrictive for insert to authenticated with check ((select public.registration_paid()));
create policy registration_paid_insert on public.messages as restrictive for insert to authenticated with check ((select public.registration_paid()));
