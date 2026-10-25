
-- Versements aux créateurs, disponibilité des gains, interrupteurs de la plateforme, lien litige -> revenu.

-- 1) Interrupteurs (paiements tutorat / inscription payante : désactivés par défaut)
create table public.platform_flags (
  key text primary key check (key in ('paid_tutoring', 'paid_registration')),
  enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index platform_flags_updated_by_idx on public.platform_flags (updated_by);
insert into public.platform_flags (key, enabled) values ('paid_tutoring', false), ('paid_registration', false);
create trigger set_platform_flags_updated_at before update on public.platform_flags
  for each row execute function public.set_updated_at();
revoke all on public.platform_flags from anon, authenticated;
alter table public.platform_flags enable row level security;

create or replace function public.get_platform_flags()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb) from public.platform_flags;
$$;

create or replace function public.admin_set_platform_flag(p_key text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.platform_flags;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('set_platform_flag', 'platform_flag', null, 'forbidden');
  end if;
  select * into o from public.platform_flags where key = p_key;
  if not found then
    return public.internal_admin_fail('set_platform_flag', 'platform_flag', null, 'invalid_key', jsonb_build_object('key', p_key));
  end if;
  if p_enabled is null then
    return public.internal_admin_fail('set_platform_flag', 'platform_flag', null, 'invalid_value', jsonb_build_object('key', p_key));
  end if;
  update public.platform_flags set enabled = p_enabled, updated_by = auth.uid() where key = p_key;
  perform public.log_audit('set_platform_flag', 'platform_flag', null, 'success',
    jsonb_build_object('key', p_key, 'old', o.enabled, 'new', p_enabled));
  return jsonb_build_object('success', true);
end;
$$;

-- 2) Réglages : délai de disponibilité des gains + commission tutorat
alter table public.platform_fee_settings add column payout_hold_days integer not null default 0 check (payout_hold_days between 0 and 60);
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.platform_fee_settings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%order_buyer_fee%';
  if c is not null then execute format('alter table public.platform_fee_settings drop constraint %I', c); end if;
  select conname into c from pg_constraint
   where conrelid = 'public.platform_revenue_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%order_buyer_fee%';
  if c is not null then execute format('alter table public.platform_revenue_entries drop constraint %I', c); end if;
end $$;
alter table public.platform_fee_settings add constraint platform_fee_settings_kind_check check (kind in (
  'order_buyer_fee', 'order_seller_commission', 'course_commission', 'event_commission', 'tutoring_commission', 'group_unblock_fee'));
alter table public.platform_revenue_entries add constraint platform_revenue_entries_kind_check check (kind in (
  'order_buyer_fee', 'order_seller_commission', 'course_commission', 'event_commission', 'tutoring_commission',
  'group_unblock_fee', 'sponsorship', 'seller_subscription', 'registration_fee'));
insert into public.platform_fee_settings (kind, fee_percent, fee_fixed) values ('tutoring_commission', 0, 0);

create or replace function public.platform_fee_amount(p_kind text, p_base integer)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  s public.platform_fee_settings;
  v integer;
begin
  select * into s from public.platform_fee_settings where kind = p_kind;
  if not found then return 0; end if;
  v := round(coalesce(p_base, 0) * s.fee_percent / 100)::integer + s.fee_fixed;
  if p_kind in ('order_seller_commission', 'course_commission', 'event_commission', 'tutoring_commission') then
    v := least(v, greatest(coalesce(p_base, 0), 0));
  end if;
  return greatest(v, 0);
end;
$$;

-- 3) Disponibilité des gains
alter table public.platform_revenue_entries add column available_at timestamptz;
create index platform_revenue_creator_available_idx on public.platform_revenue_entries (creator_id, available_at) where creator_net is not null;

create or replace function public.platform_hold_interval(p_kind text)
returns interval language sql stable security definer set search_path = public as $$
  select coalesce((select payout_hold_days from public.platform_fee_settings where kind = p_kind), 0) * interval '1 day';
$$;
revoke execute on function public.platform_hold_interval(text) from public, anon, authenticated;

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
      v_fee := public.platform_fee_amount('order_seller_commission', v_base);
      -- gains du vendeur disponibles à la clôture de la commande (voir trigger)
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
    -- gains de l'organisateur disponibles après la fin de l'événement
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
  end if;
  return v_n;
end;
$$;
revoke execute on function public.record_revenue_for_payment(uuid) from public, anon, authenticated;

-- L'écriture inverse reprend la disponibilité de l'original : un gain jamais libéré s'annule sans créer de dette.
create or replace function public.reverse_revenue_for_payment(p_payment_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  insert into public.platform_revenue_entries
    (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net, available_at, reversal_of)
  select e.payment_id, e.kind, -e.amount, -e.base_amount, e.rate_percent, e.fixed_fee, e.creator_id,
         case when e.creator_net is null then null else -e.creator_net end, e.available_at, e.id
    from public.platform_revenue_entries e
   where e.payment_id = p_payment_id and e.reversal_of is null
  on conflict (reversal_of) where reversal_of is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.reverse_revenue_for_payment(uuid) from public, anon, authenticated;

create or replace function public.release_order_earnings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.platform_revenue_entries
       set available_at = now() + public.platform_hold_interval('order_seller_commission')
     where kind = 'order_seller_commission' and available_at is null
       and payment_id in (select id from public.payments where order_id = new.id);
  end if;
  return null;
end;
$$;
create trigger orders_release_earnings after update of status on public.orders
  for each row execute function public.release_order_earnings();

-- 4) Un remboursement de litige acté annule le revenu (le paiement passe à « remboursé »)
create or replace function public.admin_mark_dispute_refunded(p_dispute_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.order_disputes;
begin
  if not public.act_as_admin() then return public.internal_admin_fail('refund_dispute', 'order_dispute', p_dispute_id, 'forbidden'); end if;
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  if not found then return public.internal_admin_fail('refund_dispute', 'order_dispute', p_dispute_id, 'not_found'); end if;
  if v_d.refund_status <> 'due' then return public.internal_admin_fail('refund_dispute', 'order_dispute', p_dispute_id, 'no_refund_due'); end if;
  update public.order_disputes set refund_status = 'done' where id = p_dispute_id;
  update public.payments set status = 'refunded' where order_id = v_d.order_id and status = 'success';
  perform public.log_audit('refund_dispute', 'order_dispute', p_dispute_id, 'success', '{}'::jsonb);
  return jsonb_build_object('success', true);
end;
$$;

-- 5) Réglages : lecture / écriture avec délai de disponibilité
drop function public.admin_save_fee_setting(text, numeric, integer);

create or replace function public.admin_save_fee_setting(
  p_kind text, p_percent numeric, p_fixed integer, p_hold_days integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.platform_fee_settings;
  v_hold integer;
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
  v_hold := coalesce(p_hold_days, o.payout_hold_days);
  if v_hold < 0 or v_hold > 60 then
    return public.internal_admin_fail('save_fee_setting', 'fee_setting', null, 'invalid_hold_days', jsonb_build_object('kind', p_kind));
  end if;
  update public.platform_fee_settings
     set fee_percent = round(p_percent, 2), fee_fixed = p_fixed, payout_hold_days = v_hold, updated_by = auth.uid()
   where kind = p_kind;
  perform public.log_audit('save_fee_setting', 'fee_setting', null, 'success', jsonb_build_object(
    'kind', p_kind, 'old_percent', o.fee_percent, 'old_fixed', o.fee_fixed, 'old_hold_days', o.payout_hold_days,
    'new_percent', round(p_percent, 2), 'new_fixed', p_fixed, 'new_hold_days', v_hold));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_get_fee_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('success', true, 'settings', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', s.kind, 'fee_percent', s.fee_percent, 'fee_fixed', s.fee_fixed, 'payout_hold_days', s.payout_hold_days,
      'updated_at', s.updated_at, 'updated_by_name', pr.full_name) order by s.kind)
    from public.platform_fee_settings s left join public.profiles pr on pr.id = s.updated_by), '[]'::jsonb),
    'flags', public.get_platform_flags());
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
    'order_buyer_fee', 'order_seller_commission', 'course_commission', 'event_commission', 'tutoring_commission',
    'group_unblock_fee', 'sponsorship', 'seller_subscription', 'registration_fee') then
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
               pr.full_name as creator_name, e.creator_net, e.available_at, e.payment_id,
               (e.reversal_of is not null) as is_reversal, e.created_at
          from public.platform_revenue_entries e
          left join public.profiles pr on pr.id = e.creator_id
         where e.created_at >= v_from::timestamptz and e.created_at < (v_to + 1)::timestamptz
           and (p_kind is null or e.kind = p_kind)
         order by e.created_at desc, e.id
         limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;

-- 6) Versements
create table public.payout_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('mtn_momo', 'orange_money')),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  holder_name text not null check (char_length(holder_name) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_payout_accounts_updated_at before update on public.payout_accounts
  for each row execute function public.set_updated_at();

create table public.creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  amount integer not null check (amount > 0),
  provider text,
  phone text,
  holder_name text,
  reference text check (reference is null or char_length(reference) <= 120),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  voided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index creator_payouts_creator_idx on public.creator_payouts (creator_id, created_at desc);
create index creator_payouts_recorded_by_idx on public.creator_payouts (recorded_by);
create index creator_payouts_voided_by_idx on public.creator_payouts (voided_by);

revoke all on public.payout_accounts, public.creator_payouts from anon, authenticated;
alter table public.payout_accounts enable row level security;
alter table public.creator_payouts enable row level security;

create or replace function public.creator_balance(p_creator uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'available', coalesce((select sum(creator_net) from public.platform_revenue_entries
                            where creator_id = p_creator and creator_net is not null and available_at <= now()), 0)
               - coalesce((select sum(amount) from public.creator_payouts where creator_id = p_creator and voided_at is null), 0),
    'pending', coalesce((select sum(creator_net) from public.platform_revenue_entries
                          where creator_id = p_creator and creator_net is not null and (available_at is null or available_at > now())), 0),
    'paid', coalesce((select sum(amount) from public.creator_payouts where creator_id = p_creator and voided_at is null), 0));
$$;
revoke execute on function public.creator_balance(uuid) from public, anon, authenticated;

create or replace function public.save_payout_account(p_provider text, p_phone text, p_holder_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s.-]', '', 'g');
  v_name text := btrim(coalesce(p_holder_name, ''));
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_provider not in ('mtn_momo', 'orange_money') then
    return jsonb_build_object('success', false, 'error', 'invalid_provider');
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('success', false, 'error', 'invalid_phone');
  end if;
  if char_length(v_name) not between 2 and 80 then
    return jsonb_build_object('success', false, 'error', 'invalid_holder_name');
  end if;
  insert into public.payout_accounts (user_id, provider, phone, holder_name)
  values (v_uid, p_provider, v_phone, v_name)
  on conflict (user_id) do update set provider = excluded.provider, phone = excluded.phone, holder_name = excluded.holder_name;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.my_earnings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object(
    'success', true,
    'currency', 'XAF',
    'balance', public.creator_balance(v_uid),
    'account', (select to_jsonb(a) - 'user_id' - 'created_at' - 'updated_at' from public.payout_accounts a where a.user_id = v_uid),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'reference', x.reference, 'created_at', x.created_at) order by x.created_at desc)
      from (select id, amount, reference, created_at from public.creator_payouts
             where creator_id = v_uid and voided_at is null order by created_at desc limit 20) x), '[]'::jsonb),
    'earnings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'base_amount', e.base_amount, 'commission', e.amount, 'net', e.creator_net,
        'available_at', e.available_at, 'is_reversal', (e.reversal_of is not null), 'created_at', e.created_at) order by e.created_at desc)
      from (select * from public.platform_revenue_entries
             where creator_id = v_uid and creator_net is not null order by created_at desc limit 30) e), '[]'::jsonb));
end;
$$;

create or replace function public.admin_creator_balances(
  p_only_due boolean default true, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return (
    with e as (
      select creator_id,
             sum(creator_net) filter (where available_at <= now()) as earned_available,
             sum(creator_net) filter (where available_at is null or available_at > now()) as pending
        from public.platform_revenue_entries
       where creator_id is not null and creator_net is not null
       group by creator_id),
    p as (
      select creator_id, sum(amount) as paid from public.creator_payouts where voided_at is null group by creator_id),
    b as (
      select e.creator_id,
             coalesce(e.earned_available, 0) - coalesce(p.paid, 0) as available,
             coalesce(e.pending, 0) as pending,
             coalesce(p.paid, 0) as paid
        from e left join p on p.creator_id = e.creator_id)
    select jsonb_build_object(
      'success', true,
      'totals', (select jsonb_build_object(
                   'available', coalesce(sum(available) filter (where available > 0), 0),
                   'pending', coalesce(sum(pending), 0),
                   'paid', coalesce(sum(paid), 0),
                   'creators_due', count(*) filter (where available > 0)) from b),
      'creators', coalesce((
        select jsonb_agg(row_to_json(r)) from (
          select b.creator_id, pr.full_name as creator_name, b.available, b.pending, b.paid,
                 a.provider, a.phone, a.holder_name, (a.user_id is not null) as has_account
            from b
            left join public.profiles pr on pr.id = b.creator_id
            left join public.payout_accounts a on a.user_id = b.creator_id
           where (not coalesce(p_only_due, true)) or b.available > 0
           order by b.available desc, b.creator_id
           limit v_limit offset v_offset) r), '[]'::jsonb)));
end;
$$;

create or replace function public.admin_record_payout(
  p_creator uuid, p_amount integer, p_reference text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.payout_accounts;
  v_available integer;
  v_id uuid;
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.can_view_finance() then
    return public.internal_admin_fail('record_payout', 'creator_payout', null, 'forbidden');
  end if;
  if p_creator is null or p_amount is null or p_amount <= 0 then
    return public.internal_admin_fail('record_payout', 'creator_payout', null, 'invalid_amount');
  end if;
  if (v_ref is not null and char_length(v_ref) > 120) or (v_note is not null and char_length(v_note) > 500) then
    return public.internal_admin_fail('record_payout', 'creator_payout', null, 'invalid_text');
  end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || p_creator::text));
  select * into a from public.payout_accounts where user_id = p_creator;
  if not found then
    return public.internal_admin_fail('record_payout', 'creator_payout', null, 'no_payout_account', jsonb_build_object('creator', p_creator));
  end if;
  v_available := (public.creator_balance(p_creator) ->> 'available')::integer;
  if p_amount > v_available then
    return public.internal_admin_fail('record_payout', 'creator_payout', null, 'exceeds_available',
      jsonb_build_object('creator', p_creator, 'amount', p_amount, 'available', v_available));
  end if;
  insert into public.creator_payouts (creator_id, amount, provider, phone, holder_name, reference, note, recorded_by)
  values (p_creator, p_amount, a.provider, a.phone, a.holder_name, v_ref, v_note, auth.uid())
  returning id into v_id;
  perform public.create_notification(p_creator, 'achat', 'payout_sent', auth.uid(), 'payout', v_id,
    jsonb_build_object('amount', p_amount), 'pay:' || v_id::text);
  perform public.log_audit('record_payout', 'creator_payout', v_id, 'success',
    jsonb_build_object('creator', p_creator, 'amount', p_amount));
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.admin_void_payout(p_payout uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_p public.creator_payouts;
begin
  if not public.can_view_finance() then
    return public.internal_admin_fail('void_payout', 'creator_payout', p_payout, 'forbidden');
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return public.internal_admin_fail('void_payout', 'creator_payout', p_payout, 'reason_required');
  end if;
  select * into v_p from public.creator_payouts where id = p_payout for update;
  if not found then
    return public.internal_admin_fail('void_payout', 'creator_payout', p_payout, 'not_found');
  end if;
  if v_p.voided_at is not null then
    return public.internal_admin_fail('void_payout', 'creator_payout', p_payout, 'already_voided');
  end if;
  update public.creator_payouts set voided_at = now(), void_reason = v_reason, voided_by = auth.uid() where id = p_payout;
  perform public.log_audit('void_payout', 'creator_payout', p_payout, 'success',
    jsonb_build_object('creator', v_p.creator_id, 'amount', v_p.amount));
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function
  public.get_platform_flags(), public.admin_set_platform_flag(text, boolean),
  public.admin_save_fee_setting(text, numeric, integer, integer),
  public.save_payout_account(text, text, text), public.my_earnings(),
  public.admin_creator_balances(boolean, integer, integer),
  public.admin_record_payout(uuid, integer, text, text), public.admin_void_payout(uuid, text)
  from public, anon;
grant execute on function
  public.get_platform_flags(), public.admin_set_platform_flag(text, boolean),
  public.admin_save_fee_setting(text, numeric, integer, integer),
  public.save_payout_account(text, text, text), public.my_earnings(),
  public.admin_creator_balances(boolean, integer, integer),
  public.admin_record_payout(uuid, integer, text, text), public.admin_void_payout(uuid, text)
  to authenticated;
