
-- Abonnement « Boutique Premium » pour les vendeurs : formules, abonnements, paiement, règlement, avantages.
-- Avantages : badge Premium + exemption de la commission vendeur sur les commandes.

create table public.seller_plans (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 2 and 40),
  days integer not null check (days between 7 and 366),
  price integer not null check (price between 500 and 500000),
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_seller_plans_updated_at before update on public.seller_plans
  for each row execute function public.set_updated_at();
-- Formules de départ (inactives, prix indicatifs à ajuster par l'admin)
insert into public.seller_plans (label, days, price, active, sort_order) values
  ('Mensuel', 30, 2500, false, 1),
  ('Trimestriel', 90, 6500, false, 2),
  ('Annuel', 365, 24000, false, 3);

create table public.seller_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid references public.seller_plans(id) on delete set null,
  plan_label text not null,
  days integer not null check (days between 7 and 366),
  amount integer not null check (amount > 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'cancelled')),
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_seller_subscriptions_updated_at before update on public.seller_subscriptions
  for each row execute function public.set_updated_at();
create index seller_subscriptions_user_idx on public.seller_subscriptions (user_id, status, ends_at desc);
create index seller_subscriptions_plan_idx on public.seller_subscriptions (plan_id);
create unique index seller_subscriptions_one_pending on public.seller_subscriptions (user_id) where status = 'pending_payment';

revoke all on public.seller_plans, public.seller_subscriptions from anon, authenticated;
grant select on public.seller_plans, public.seller_subscriptions to authenticated;
alter table public.seller_plans enable row level security;
alter table public.seller_subscriptions enable row level security;
create policy mfa_required on public.seller_plans as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.seller_subscriptions as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy seller_plans_select on public.seller_plans for select to authenticated
  using (active or (select public.is_staff((select auth.uid()))));
create policy seller_subscriptions_select on public.seller_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff((select auth.uid()))));

-- Paiements : nouvelle cible
alter table public.payments add column seller_subscription_id uuid references public.seller_subscriptions(id) on delete restrict;
create unique index payments_one_per_seller_subscription on public.payments (seller_subscription_id) where seller_subscription_id is not null;
alter table public.payments drop constraint payments_exactly_one_target;
alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id, group_unblock_id, sponsorship_id, seller_subscription_id) = 1);

-- Statut Premium
create or replace function public.is_premium_seller(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.seller_subscriptions
     where user_id = p_user and status = 'active' and starts_at <= now() and ends_at > now());
$$;

create or replace function public.premium_seller_ids(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct s.user_id), '{}')
    from public.seller_subscriptions s
   where s.user_id = any (p_ids[1:100])
     and s.status = 'active' and s.starts_at <= now() and s.ends_at > now();
$$;

revoke execute on function public.is_premium_seller(uuid), public.premium_seller_ids(uuid[]) from public;
grant execute on function public.is_premium_seller(uuid), public.premium_seller_ids(uuid[]) to anon, authenticated;

-- Création de l'abonnement en attente de paiement (appelée par l'Edge Function uniquement)
create or replace function public.create_seller_subscription_pending(p_user uuid, p_plan uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pl public.seller_plans;
  s public.seller_subscriptions;
begin
  select * into pl from public.seller_plans where id = p_plan and active;
  if not found then
    return jsonb_build_object('success', false, 'error', 'plan_unavailable');
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    return jsonb_build_object('success', false, 'error', 'user_not_found');
  end if;
  select * into s from public.seller_subscriptions where user_id = p_user and status = 'pending_payment' for update;
  if found then
    if s.plan_id = pl.id and s.amount = pl.price then
      return jsonb_build_object('success', true, 'subscription_id', s.id, 'amount', s.amount, 'days', s.days, 'plan_label', s.plan_label);
    end if;
    update public.seller_subscriptions set status = 'cancelled', cancel_reason = 'Remplacé par une autre formule' where id = s.id;
  end if;
  insert into public.seller_subscriptions (user_id, plan_id, plan_label, days, amount)
  values (p_user, pl.id, pl.label, pl.days, pl.price) returning * into s;
  return jsonb_build_object('success', true, 'subscription_id', s.id, 'amount', s.amount, 'days', s.days, 'plan_label', s.plan_label);
end;
$$;
revoke execute on function public.create_seller_subscription_pending(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_seller_subscription_pending(uuid, uuid) to service_role;

-- Règlement : branche abonnement + remboursement
create or replace function public.apply_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid;
  sp public.listing_sponsorships;
  ss public.seller_subscriptions;
  v_start timestamptz;
  v_end timestamptz;
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
    elsif new.sponsorship_id is not null then
      select * into sp from public.listing_sponsorships where id = new.sponsorship_id for update;
      if found and sp.status = 'pending_payment' then
        v_start := greatest(now(), coalesce(public.sponsored_until(sp.product_id), now()));
        v_end := v_start + (sp.days * interval '1 day');
        update public.listing_sponsorships
           set status = 'active', paid_at = now(), starts_at = v_start, ends_at = v_end
         where id = sp.id;
        perform public.create_notification(sp.user_id, 'produit', 'sponsorship_activated', null, 'product', sp.product_id,
          jsonb_build_object('days', sp.days, 'starts_at', v_start, 'ends_at', v_end), 'spa:' || sp.id::text);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'sponsorship_not_pending_payment_at_settlement', 'sponsorship_id', new.sponsorship_id));
      end if;
    elsif new.seller_subscription_id is not null then
      select * into ss from public.seller_subscriptions where id = new.seller_subscription_id for update;
      if found and ss.status = 'pending_payment' then
        -- Les périodes s'enchaînent : la nouvelle commence quand l'abonnement actuel se termine.
        select greatest(now(), coalesce(max(ends_at), now())) into v_start
          from public.seller_subscriptions where user_id = ss.user_id and status = 'active' and ends_at > now();
        v_end := v_start + (ss.days * interval '1 day');
        update public.seller_subscriptions
           set status = 'active', paid_at = now(), starts_at = v_start, ends_at = v_end
         where id = ss.id;
        perform public.create_notification(ss.user_id, 'achat', 'seller_premium_activated', null, 'seller_subscription', ss.id,
          jsonb_build_object('plan_label', ss.plan_label, 'starts_at', v_start, 'ends_at', v_end), 'ssa:' || ss.id::text);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'seller_subscription_not_pending_payment_at_settlement', 'seller_subscription_id', new.seller_subscription_id));
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

  if new.status = 'refunded' and old.status is distinct from 'refunded' then
    if new.sponsorship_id is not null then
      update public.listing_sponsorships
         set status = 'cancelled', cancel_reason = 'Paiement remboursé'
       where id = new.sponsorship_id and status <> 'cancelled'
       returning * into sp;
      if sp.id is not null then
        perform public.create_notification(sp.user_id, 'produit', 'sponsorship_cancelled', null, 'product', sp.product_id,
          jsonb_build_object('reason', 'Paiement remboursé', 'paid', true), 'spc:' || sp.id::text);
      end if;
    elsif new.seller_subscription_id is not null then
      update public.seller_subscriptions
         set status = 'cancelled', cancel_reason = 'Paiement remboursé'
       where id = new.seller_subscription_id and status <> 'cancelled'
       returning * into ss;
      if ss.id is not null then
        perform public.create_notification(ss.user_id, 'achat', 'seller_premium_cancelled', null, 'seller_subscription', ss.id,
          jsonb_build_object('reason', 'Paiement remboursé'), 'ssc:' || ss.id::text);
      end if;
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);
  return new;
end;
$function$;

-- Revenus : abonnement + exemption de commission vendeur pour les Premium
create or replace function public.record_revenue_for_payment(p_payment_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  p public.payments;
  o public.orders;
  s public.platform_fee_settings;
  v_base integer;
  v_fee integer;
  v_creator uuid;
  v_event_end timestamptz;
  v_n integer := 0;
  v_rows integer;
begin
  select * into p from public.payments where id = p_payment_id;
  if not found or p.status <> 'success' then return 0; end if;

  if p.order_id is not null then
    select * into o from public.orders where id = p.order_id;
    if found then
      v_base := o.unit_price * o.quantity;
      insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent)
      values (p.id, 'order_buyer_fee', o.service_fee, v_base,
              case when v_base > 0 then round(o.service_fee * 100.0 / v_base, 2) end)
      on conflict (payment_id, kind) where reversal_of is null do nothing;
      get diagnostics v_rows = row_count; v_n := v_n + v_rows;

      select * into s from public.platform_fee_settings where kind = 'order_seller_commission';
      if public.is_premium_seller(o.seller_id) then
        v_fee := 0; s.fee_percent := 0; s.fee_fixed := 0;
      else
        v_fee := public.platform_fee_amount('order_seller_commission', v_base);
      end if;
      insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net, available_at)
      values (p.id, 'order_seller_commission', v_fee, v_base, s.fee_percent, s.fee_fixed, o.seller_id, v_base - v_fee,
              case when o.status = 'completed' then now() + public.platform_hold_interval('order_seller_commission') end)
      on conflict (payment_id, kind) where reversal_of is null do nothing;
      get diagnostics v_rows = row_count; v_n := v_n + v_rows;
    end if;
  elsif p.course_enrollment_id is not null then
    select c.instructor_id into v_creator
      from public.course_enrollments e join public.courses c on c.id = e.course_id
     where e.id = p.course_enrollment_id;
    select * into s from public.platform_fee_settings where kind = 'course_commission';
    v_fee := public.platform_fee_amount('course_commission', p.amount);
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net, available_at)
    values (p.id, 'course_commission', v_fee, p.amount, s.fee_percent, s.fee_fixed, v_creator, p.amount - v_fee,
            now() + public.platform_hold_interval('course_commission'))
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif p.event_ticket_id is not null then
    select ev.created_by, coalesce(ev.ends_at, ev.starts_at) into v_creator, v_event_end
      from public.event_tickets t join public.events ev on ev.id = t.event_id
     where t.id = p.event_ticket_id;
    select * into s from public.platform_fee_settings where kind = 'event_commission';
    v_fee := public.platform_fee_amount('event_commission', p.amount);
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net, available_at)
    values (p.id, 'event_commission', v_fee, p.amount, s.fee_percent, s.fee_fixed, v_creator, p.amount - v_fee,
            greatest(coalesce(v_event_end, now()), now()) + public.platform_hold_interval('event_commission'))
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif p.group_unblock_id is not null then
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount)
    values (p.id, 'group_unblock_fee', p.amount, p.amount)
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif p.sponsorship_id is not null then
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount)
    values (p.id, 'sponsorship', p.amount, p.amount)
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif p.seller_subscription_id is not null then
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount)
    values (p.id, 'seller_subscription', p.amount, p.amount)
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  end if;
  return v_n;
end;
$$;
revoke execute on function public.record_revenue_for_payment(uuid) from public, anon, authenticated;

-- Fonctions vendeur / admin
create or replace function public.my_seller_subscription()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_active_account(v_uid) then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object(
    'success', true,
    'is_premium', public.is_premium_seller(v_uid),
    'current', (select jsonb_build_object('id', s.id, 'plan_label', s.plan_label, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
                  from public.seller_subscriptions s
                 where s.user_id = v_uid and s.status = 'active' and s.ends_at > now()
                 order by s.ends_at desc limit 1),
    'pending', (select jsonb_build_object('id', s.id, 'plan_label', s.plan_label, 'amount', s.amount)
                  from public.seller_subscriptions s where s.user_id = v_uid and s.status = 'pending_payment'),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('plan_label', h.plan_label, 'amount', h.amount, 'status', h.status,
                                          'starts_at', h.starts_at, 'ends_at', h.ends_at, 'paid_at', h.paid_at) order by h.created_at desc)
        from (select * from public.seller_subscriptions where user_id = v_uid and status <> 'pending_payment'
               order by created_at desc limit 10) h), '[]'::jsonb));
end;
$$;

create or replace function public.admin_save_seller_plan(
  p_id uuid, p_label text, p_days integer, p_price integer, p_active boolean, p_sort integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('save_seller_plan', 'seller_plan', p_id, 'forbidden');
  end if;
  if char_length(v_label) not between 2 and 40 then
    return public.internal_admin_fail('save_seller_plan', 'seller_plan', p_id, 'invalid_label');
  end if;
  if p_days is null or p_days not between 7 and 366 then
    return public.internal_admin_fail('save_seller_plan', 'seller_plan', p_id, 'invalid_days');
  end if;
  if p_price is null or p_price not between 500 and 500000 then
    return public.internal_admin_fail('save_seller_plan', 'seller_plan', p_id, 'invalid_price');
  end if;
  if p_id is null then
    insert into public.seller_plans (label, days, price, active, sort_order)
    values (v_label, p_days, p_price, coalesce(p_active, false), coalesce(p_sort, 0)) returning id into v_id;
  else
    update public.seller_plans set label = v_label, days = p_days, price = p_price,
           active = coalesce(p_active, active), sort_order = coalesce(p_sort, sort_order)
     where id = p_id returning id into v_id;
    if v_id is null then
      return public.internal_admin_fail('save_seller_plan', 'seller_plan', p_id, 'not_found');
    end if;
  end if;
  perform public.log_audit('save_seller_plan', 'seller_plan', v_id, 'success',
    jsonb_build_object('label', v_label, 'days', p_days, 'price', p_price, 'active', p_active));
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.admin_list_seller_subscriptions(
  p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_status is not null and p_status not in ('pending_payment', 'active', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  return jsonb_build_object(
    'success', true,
    'total', (select count(*) from public.seller_subscriptions where p_status is null or status = p_status),
    'subscriptions', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select s.id, s.user_id, pr.full_name as user_name, s.plan_label, s.days, s.amount, s.status,
               s.paid_at, s.starts_at, s.ends_at, s.cancel_reason, s.created_at
          from public.seller_subscriptions s left join public.profiles pr on pr.id = s.user_id
         where p_status is null or s.status = p_status
         order by s.created_at desc, s.id limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;

create or replace function public.admin_cancel_seller_subscription(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  s public.seller_subscriptions;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('cancel_seller_subscription', 'seller_subscription', p_id, 'forbidden');
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return public.internal_admin_fail('cancel_seller_subscription', 'seller_subscription', p_id, 'reason_required');
  end if;
  select * into s from public.seller_subscriptions where id = p_id for update;
  if not found then
    return public.internal_admin_fail('cancel_seller_subscription', 'seller_subscription', p_id, 'not_found');
  end if;
  if s.status = 'cancelled' then
    return public.internal_admin_fail('cancel_seller_subscription', 'seller_subscription', p_id, 'already_cancelled');
  end if;
  update public.seller_subscriptions set status = 'cancelled', cancel_reason = v_reason where id = p_id;
  perform public.create_notification(s.user_id, 'achat', 'seller_premium_cancelled', auth.uid(), 'seller_subscription', s.id,
    jsonb_build_object('reason', v_reason), 'ssc:' || s.id::text);
  perform public.log_audit('cancel_seller_subscription', 'seller_subscription', p_id, 'success',
    jsonb_build_object('user', s.user_id, 'paid', s.paid_at is not null));
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function
  public.my_seller_subscription(), public.admin_save_seller_plan(uuid, text, integer, integer, boolean, integer),
  public.admin_list_seller_subscriptions(text, integer, integer), public.admin_cancel_seller_subscription(uuid, text)
  from public, anon;
grant execute on function
  public.my_seller_subscription(), public.admin_save_seller_plan(uuid, text, integer, integer, boolean, integer),
  public.admin_list_seller_subscriptions(text, integer, integer), public.admin_cancel_seller_subscription(uuid, text)
  to authenticated;
