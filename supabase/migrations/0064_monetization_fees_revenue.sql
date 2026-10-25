
-- Monétisation : frais et commissions réglables + registre des revenus de la plateforme.
-- Les valeurs par défaut reproduisent le comportement actuel : frais acheteur 2 %, déblocage 500 F, aucune commission vendeur/formateur/organisateur.

create table public.platform_fee_settings (
  kind text primary key check (kind in (
    'order_buyer_fee', 'order_seller_commission', 'course_commission', 'event_commission', 'group_unblock_fee')),
  fee_percent numeric(5,2) not null default 0 check (fee_percent between 0 and 30),
  fee_fixed integer not null default 0 check (fee_fixed between 0 and 50000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index platform_fee_settings_updated_by_idx on public.platform_fee_settings (updated_by);

insert into public.platform_fee_settings (kind, fee_percent, fee_fixed) values
  ('order_buyer_fee', 2, 0),
  ('order_seller_commission', 0, 0),
  ('course_commission', 0, 0),
  ('event_commission', 0, 0),
  ('group_unblock_fee', 0, 500);

create trigger set_platform_fee_settings_updated_at before update on public.platform_fee_settings
  for each row execute function public.set_updated_at();

revoke all on public.platform_fee_settings from anon, authenticated;
grant select on public.platform_fee_settings to authenticated;
alter table public.platform_fee_settings enable row level security;
create policy mfa_required on public.platform_fee_settings as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy platform_fee_settings_select on public.platform_fee_settings for select to authenticated
  using ((select public.is_active_account((select auth.uid()))));

create table public.platform_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  kind text not null check (kind in (
    'order_buyer_fee', 'order_seller_commission', 'course_commission', 'event_commission',
    'group_unblock_fee', 'sponsorship')),
  amount integer not null,
  base_amount integer not null default 0,
  rate_percent numeric(5,2),
  fixed_fee integer,
  creator_id uuid,
  creator_net integer,
  reversal_of uuid references public.platform_revenue_entries(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index platform_revenue_one_per_payment_kind on public.platform_revenue_entries (payment_id, kind) where reversal_of is null;
create unique index platform_revenue_one_reversal on public.platform_revenue_entries (reversal_of) where reversal_of is not null;
create index platform_revenue_created_idx on public.platform_revenue_entries (created_at desc);
create index platform_revenue_kind_created_idx on public.platform_revenue_entries (kind, created_at desc);
create index platform_revenue_creator_idx on public.platform_revenue_entries (creator_id);

revoke all on public.platform_revenue_entries from anon, authenticated;
alter table public.platform_revenue_entries enable row level security;

-- Accès finance : admin ou gestionnaire financier, compte actif, MFA satisfaite
create or replace function public.can_view_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select (public.is_admin() or public.has_role('financial_manager'))
     and public.is_active_account()
     and public.mfa_ok();
$$;

-- Calcul d'un frais : pourcentage + montant fixe ; les commissions ne dépassent jamais la base
create or replace function public.platform_fee_amount(p_kind text, p_base integer)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  s public.platform_fee_settings;
  v integer;
begin
  select * into s from public.platform_fee_settings where kind = p_kind;
  if not found then return 0; end if;
  v := round(coalesce(p_base, 0) * s.fee_percent / 100)::integer + s.fee_fixed;
  if p_kind in ('order_seller_commission', 'course_commission', 'event_commission') then
    v := least(v, greatest(coalesce(p_base, 0), 0));
  end if;
  return greatest(v, 0);
end;
$$;

-- Les fonctions existantes lisent désormais les réglages (mêmes valeurs par défaut qu'avant)
create or replace function public.order_service_fee(p_subtotal integer)
returns integer language sql stable parallel safe set search_path = '' as $$
  select public.platform_fee_amount('order_buyer_fee', p_subtotal)
$$;

create or replace function public.group_buy_unblock_fee()
returns integer language sql stable parallel safe set search_path = '' as $$
  select public.platform_fee_amount('group_unblock_fee', 0)
$$;

revoke execute on function public.platform_fee_amount(text, integer), public.can_view_finance() from public, anon;
grant execute on function public.platform_fee_amount(text, integer), public.can_view_finance() to authenticated;

-- Enregistrement des revenus à la réussite d'un paiement
create or replace function public.record_revenue_for_payment(p_payment_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  p public.payments;
  o public.orders;
  s public.platform_fee_settings;
  v_base integer;
  v_fee integer;
  v_creator uuid;
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
      v_fee := public.platform_fee_amount('order_seller_commission', v_base);
      insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net)
      values (p.id, 'order_seller_commission', v_fee, v_base, s.fee_percent, s.fee_fixed, o.seller_id, v_base - v_fee)
      on conflict (payment_id, kind) where reversal_of is null do nothing;
      get diagnostics v_rows = row_count; v_n := v_n + v_rows;
    end if;
  elsif p.course_enrollment_id is not null then
    select c.instructor_id into v_creator
      from public.course_enrollments e join public.courses c on c.id = e.course_id
     where e.id = p.course_enrollment_id;
    select * into s from public.platform_fee_settings where kind = 'course_commission';
    v_fee := public.platform_fee_amount('course_commission', p.amount);
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net)
    values (p.id, 'course_commission', v_fee, p.amount, s.fee_percent, s.fee_fixed, v_creator, p.amount - v_fee)
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  elsif p.event_ticket_id is not null then
    select ev.created_by into v_creator
      from public.event_tickets t join public.events ev on ev.id = t.event_id
     where t.id = p.event_ticket_id;
    select * into s from public.platform_fee_settings where kind = 'event_commission';
    v_fee := public.platform_fee_amount('event_commission', p.amount);
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net)
    values (p.id, 'event_commission', v_fee, p.amount, s.fee_percent, s.fee_fixed, v_creator, p.amount - v_fee)
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
  end if;
  return v_n;
end;
$$;

create or replace function public.reverse_revenue_for_payment(p_payment_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  insert into public.platform_revenue_entries
    (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net, reversal_of)
  select e.payment_id, e.kind, -e.amount, -e.base_amount, e.rate_percent, e.fixed_fee, e.creator_id,
         case when e.creator_net is null then null else -e.creator_net end, e.id
    from public.platform_revenue_entries e
   where e.payment_id = p_payment_id and e.reversal_of is null
  on conflict (reversal_of) where reversal_of is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.record_revenue_for_payment(uuid), public.reverse_revenue_for_payment(uuid) from public, anon, authenticated;

-- Une erreur d'enregistrement du revenu ne doit jamais bloquer un règlement : elle est tracée dans le journal des paiements.
create or replace function public.platform_revenue_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status = 'success' and old.status is distinct from 'success' then
      perform public.record_revenue_for_payment(new.id);
    elsif new.status = 'refunded' and old.status is distinct from 'refunded' then
      perform public.reverse_revenue_for_payment(new.id);
    end if;
  exception when others then
    insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
    values (new.id, 'revenue_recording_failed', new.amount, new.currency, jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create trigger payments_revenue after update of status on public.payments
  for each row execute function public.platform_revenue_on_payment();

-- Fonctions d'administration
create or replace function public.admin_get_fee_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('success', true, 'settings', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', s.kind, 'fee_percent', s.fee_percent, 'fee_fixed', s.fee_fixed,
      'updated_at', s.updated_at, 'updated_by_name', pr.full_name) order by s.kind)
    from public.platform_fee_settings s left join public.profiles pr on pr.id = s.updated_by), '[]'::jsonb));
end;
$$;

create or replace function public.admin_save_fee_setting(p_kind text, p_percent numeric, p_fixed integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.platform_fee_settings;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('save_fee_setting', 'fee_setting', null, 'forbidden');
  end if;
  select * into o from public.platform_fee_settings where kind = p_kind;
  if not found then
    return public.internal_admin_fail('save_fee_setting', 'fee_setting', null, 'invalid_kind', jsonb_build_object('kind', p_kind));
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 30 then
    return public.internal_admin_fail('save_fee_setting', 'fee_setting', null, 'invalid_percent', jsonb_build_object('kind', p_kind));
  end if;
  if p_fixed is null or p_fixed < 0 or p_fixed > 50000 then
    return public.internal_admin_fail('save_fee_setting', 'fee_setting', null, 'invalid_fixed', jsonb_build_object('kind', p_kind));
  end if;
  if p_kind = 'group_unblock_fee' and p_percent <> 0 then
    return public.internal_admin_fail('save_fee_setting', 'fee_setting', null, 'invalid_percent', jsonb_build_object('kind', p_kind));
  end if;
  update public.platform_fee_settings
     set fee_percent = round(p_percent, 2), fee_fixed = p_fixed, updated_by = auth.uid()
   where kind = p_kind;
  perform public.log_audit('save_fee_setting', 'fee_setting', null, 'success', jsonb_build_object(
    'kind', p_kind, 'old_percent', o.fee_percent, 'old_fixed', o.fee_fixed,
    'new_percent', round(p_percent, 2), 'new_fixed', p_fixed));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_revenue_summary(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_to date := coalesce(p_to, current_date);
  v_from date := coalesce(p_from, coalesce(p_to, current_date) - 29);
  v_days integer;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if v_from > v_to or v_to - v_from > 400 then
    return jsonb_build_object('success', false, 'error', 'invalid_period');
  end if;
  v_days := v_to - v_from + 1;
  v_start := v_from::timestamptz;
  v_end := (v_to + 1)::timestamptz;
  v_prev_start := v_start - (v_days * interval '1 day');

  return jsonb_build_object(
    'success', true,
    'from', v_from, 'to', v_to, 'currency', 'XAF',
    'totals', (
      select jsonb_build_object(
        'net_revenue', coalesce(sum(amount), 0),
        'refunded', coalesce(-sum(amount) filter (where reversal_of is not null), 0),
        'transactions', count(*) filter (where reversal_of is null),
        'volume', coalesce(sum(base_amount), 0))
      from public.platform_revenue_entries where created_at >= v_start and created_at < v_end),
    'previous_period_net', (
      select coalesce(sum(amount), 0) from public.platform_revenue_entries
       where created_at >= v_prev_start and created_at < v_start),
    'processed_volume', (
      select coalesce(sum(amount), 0) from public.payments
       where status = 'success' and created_at >= v_start and created_at < v_end),
    'by_kind', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', kind, 'transactions', n, 'volume', vol, 'revenue', rev) order by rev desc)
      from (
        select kind, count(*) filter (where reversal_of is null) n,
               coalesce(sum(base_amount), 0) vol, coalesce(sum(amount), 0) rev
          from public.platform_revenue_entries
         where created_at >= v_start and created_at < v_end
         group by kind) k), '[]'::jsonb),
    'creator_net_total', coalesce((
      select jsonb_object_agg(kind, tot)
      from (
        select kind, sum(creator_net) tot from public.platform_revenue_entries
         where creator_net is not null and created_at >= v_start and created_at < v_end
         group by kind) c), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'revenue', coalesce(x.rev, 0)) order by d.day)
      from generate_series(v_from, v_to, interval '1 day') as d(day)
      left join (
        select created_at::date as day, sum(amount) rev from public.platform_revenue_entries
         where created_at >= v_start and created_at < v_end group by 1) x on x.day = d.day::date), '[]'::jsonb));
end;
$$;

create or replace function public.admin_revenue_entries(
  p_from date default null, p_to date default null, p_kind text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_to date := coalesce(p_to, current_date);
  v_from date := coalesce(p_from, coalesce(p_to, current_date) - 29);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if v_from > v_to or v_to - v_from > 400 then
    return jsonb_build_object('success', false, 'error', 'invalid_period');
  end if;
  if p_kind is not null and p_kind not in (
    'order_buyer_fee', 'order_seller_commission', 'course_commission', 'event_commission', 'group_unblock_fee', 'sponsorship') then
    return jsonb_build_object('success', false, 'error', 'invalid_kind');
  end if;
  return jsonb_build_object(
    'success', true,
    'total', (select count(*) from public.platform_revenue_entries e
               where e.created_at >= v_from::timestamptz and e.created_at < (v_to + 1)::timestamptz
                 and (p_kind is null or e.kind = p_kind)),
    'entries', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select e.id, e.kind, e.amount, e.base_amount, e.rate_percent, e.fixed_fee, e.creator_id,
               pr.full_name as creator_name, e.creator_net, e.payment_id,
               (e.reversal_of is not null) as is_reversal, e.created_at
          from public.platform_revenue_entries e
          left join public.profiles pr on pr.id = e.creator_id
         where e.created_at >= v_from::timestamptz and e.created_at < (v_to + 1)::timestamptz
           and (p_kind is null or e.kind = p_kind)
         order by e.created_at desc, e.id
         limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;

create or replace function public.admin_backfill_revenue()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_payments integer := 0;
  v_entries integer := 0;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('backfill_revenue', 'revenue', null, 'forbidden');
  end if;
  for r in
    select p.id from public.payments p
     where p.status = 'success'
       and not exists (select 1 from public.platform_revenue_entries e where e.payment_id = p.id)
  loop
    v_entries := v_entries + public.record_revenue_for_payment(r.id);
    v_payments := v_payments + 1;
  end loop;
  perform public.log_audit('backfill_revenue', 'revenue', null, 'success',
    jsonb_build_object('payments', v_payments, 'entries', v_entries));
  return jsonb_build_object('success', true, 'payments', v_payments, 'entries', v_entries);
end;
$$;

revoke execute on function
  public.admin_get_fee_settings(), public.admin_save_fee_setting(text, numeric, integer),
  public.admin_revenue_summary(date, date), public.admin_revenue_entries(date, date, text, integer, integer),
  public.admin_backfill_revenue()
  from public, anon;
grant execute on function
  public.admin_get_fee_settings(), public.admin_save_fee_setting(text, numeric, integer),
  public.admin_revenue_summary(date, date), public.admin_revenue_entries(date, date, text, integer, integer),
  public.admin_backfill_revenue()
  to authenticated;
