
-- Inscription payante (désactivée par défaut, activable par l'admin avec un prix par pays).
-- Le pays est déduit du numéro de téléphone vérifié. Un compte en attente de paiement n'est pas « actif » (is_active_account).

create table public.registration_fees (
  country_code char(2) primary key references public.countries(code) on delete cascade,
  price integer not null check (price between 500 and 100000),
  active boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index registration_fees_updated_by_idx on public.registration_fees (updated_by);
create trigger set_registration_fees_updated_at before update on public.registration_fees
  for each row execute function public.set_updated_at();

create table public.account_registrations (
  id uuid not null default gen_random_uuid() unique,
  user_id uuid primary key references public.profiles(id) on delete cascade,
  country_code char(2) references public.countries(code) on delete set null,
  status text not null default 'exempt' check (status in ('pending_payment', 'paid', 'exempt')),
  fee integer check (fee is null or fee > 0),
  paid_at timestamptz,
  exempt_reason text check (exempt_reason is null or char_length(exempt_reason) <= 300),
  exempted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index account_registrations_country_idx on public.account_registrations (country_code);
create index account_registrations_exempted_by_idx on public.account_registrations (exempted_by);
create index account_registrations_status_idx on public.account_registrations (status, created_at desc);
create trigger set_account_registrations_updated_at before update on public.account_registrations
  for each row execute function public.set_updated_at();

revoke all on public.registration_fees, public.account_registrations from anon, authenticated;
alter table public.registration_fees enable row level security;
alter table public.account_registrations enable row level security;

-- Comptes existants : exemptés
insert into public.account_registrations (user_id, status, exempt_reason)
select id, 'exempt', 'Compte existant avant l''inscription payante' from public.profiles;

-- Paiements : nouvelle cible
alter table public.payments add column registration_id uuid references public.account_registrations(id) on delete restrict;
create unique index payments_one_per_registration on public.payments (registration_id) where registration_id is not null;
alter table public.payments drop constraint payments_exactly_one_target;
alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id, group_unblock_id, sponsorship_id, seller_subscription_id, tutoring_request_id, registration_id) = 1);

-- Un compte en attente de paiement n'est pas actif
create or replace function public.is_active_account(uid uuid default auth.uid())
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select uid is not null
     and (uid is not distinct from auth.uid() or private.can_inspect_others())
     and not exists (select 1 from public.account_restrictions where user_id = uid)
     and not exists (select 1 from public.profiles where id = uid and deactivated_at is not null)
     and not exists (select 1 from public.account_registrations where user_id = uid and status = 'pending_payment');
$function$;

-- Création du compte : en attente si l'inscription payante est activée
create or replace function public.init_registration(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_flag_enabled('paid_registration') then
    insert into public.account_registrations (user_id, status) values (p_user, 'pending_payment')
    on conflict (user_id) do nothing;
  else
    insert into public.account_registrations (user_id, status, exempt_reason)
    values (p_user, 'exempt', 'Inscription gratuite')
    on conflict (user_id) do nothing;
  end if;
end;
$$;
revoke execute on function public.init_registration(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));

  insert into public.profile_private (id, email)
  values (new.id, new.email);

  insert into public.user_roles (user_id, role)
  values (new.id, 'student');

  perform public.init_registration(new.id);

  return new;
end;
$function$;

-- Résolution du pays et du tarif à partir du téléphone vérifié
create or replace function public.resolve_registration(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pp public.profile_private;
  reg public.account_registrations;
  f public.registration_fees;
  v_country char(2);
begin
  select * into reg from public.account_registrations where user_id = p_user for update;
  if not found or reg.status <> 'pending_payment' then return; end if;
  select * into pp from public.profile_private where id = p_user;
  if not found or pp.phone is null or not pp.phone_verified then return; end if;
  select c.code into v_country from public.countries c
   where pp.phone like c.dial_code || '%'
   order by length(c.dial_code) desc limit 1;
  select * into f from public.registration_fees where country_code = v_country and active;
  if v_country is null or not found or not public.is_flag_enabled('paid_registration') then
    update public.account_registrations
       set status = 'exempt', country_code = v_country, exempt_reason = 'Inscription gratuite dans ce pays'
     where user_id = p_user;
  else
    update public.account_registrations set country_code = v_country, fee = f.price where user_id = p_user;
  end if;
end;
$$;
revoke execute on function public.resolve_registration(uuid) from public, anon, authenticated;

create or replace function public.tg_resolve_registration()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.resolve_registration(new.id);
  return null;
end;
$$;
create trigger profile_private_resolve_registration after update of phone, phone_verified on public.profile_private
  for each row when (new.phone_verified and new.phone is not null)
  execute function public.tg_resolve_registration();

-- Les membres de l'équipe ne paient pas
create or replace function public.tg_exempt_staff_registration()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role::text <> 'student' then
    update public.account_registrations
       set status = 'exempt', exempt_reason = 'Membre de l''équipe'
     where user_id = new.user_id and status = 'pending_payment';
  end if;
  return null;
end;
$$;
create trigger user_roles_exempt_staff after insert on public.user_roles
  for each row execute function public.tg_exempt_staff_registration();

-- Désactiver l'inscription payante libère les comptes en attente
create or replace function public.admin_set_platform_flag(p_key text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.platform_flags;
  v_released integer := 0;
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
  if p_key = 'paid_registration' and not p_enabled then
    update public.account_registrations
       set status = 'exempt', exempt_reason = 'Inscription payante désactivée'
     where status = 'pending_payment';
    get diagnostics v_released = row_count;
  end if;
  perform public.log_audit('set_platform_flag', 'platform_flag', null, 'success',
    jsonb_build_object('key', p_key, 'old', o.enabled, 'new', p_enabled, 'released_accounts', v_released));
  return jsonb_build_object('success', true, 'released_accounts', v_released);
end;
$$;

-- Cible de paiement (Edge Function uniquement)
create or replace function public.create_registration_payment_target(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  reg public.account_registrations;
begin
  select * into reg from public.account_registrations where user_id = p_user;
  if not found then
    return jsonb_build_object('success', false, 'error', 'registration_not_found');
  end if;
  if reg.status = 'paid' then
    return jsonb_build_object('success', false, 'error', 'already_paid');
  end if;
  if reg.status <> 'pending_payment' then
    return jsonb_build_object('success', false, 'error', 'not_payable');
  end if;
  if reg.fee is null or reg.fee <= 0 then
    return jsonb_build_object('success', false, 'error', 'phone_not_verified');
  end if;
  return jsonb_build_object('success', true, 'registration_id', reg.id, 'amount', reg.fee);
end;
$$;
revoke execute on function public.create_registration_payment_target(uuid) from public, anon, authenticated;
grant execute on function public.create_registration_payment_target(uuid) to service_role;

-- Lecture : tarif public (écran d'inscription) et statut personnel
create or replace function public.get_registration_pricing(p_country text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when public.is_flag_enabled('paid_registration') and f.country_code is not null and f.active
      then jsonb_build_object('paid', true, 'price', f.price, 'currency', 'XAF', 'country', upper(p_country))
    else jsonb_build_object('paid', false, 'country', upper(p_country))
  end
  from (select 1) d left join public.registration_fees f on f.country_code = upper(p_country);
$$;
revoke execute on function public.get_registration_pricing(text) from public;
grant execute on function public.get_registration_pricing(text) to anon, authenticated;

create or replace function public.my_registration()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  reg public.account_registrations;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  select * into reg from public.account_registrations where user_id = auth.uid();
  if not found then
    return jsonb_build_object('success', true, 'status', 'exempt');
  end if;
  return jsonb_build_object('success', true, 'status', reg.status, 'fee', reg.fee, 'country', reg.country_code,
                            'paid_at', reg.paid_at, 'currency', 'XAF');
end;
$$;
revoke execute on function public.my_registration() from public, anon;
grant execute on function public.my_registration() to authenticated;

-- Administration
create or replace function public.admin_save_registration_fee(p_country text, p_price integer, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code char(2) := upper(btrim(coalesce(p_country, '')));
  o public.registration_fees;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('save_registration_fee', 'registration_fee', null, 'forbidden');
  end if;
  if not exists (select 1 from public.countries where code = v_code) then
    return public.internal_admin_fail('save_registration_fee', 'registration_fee', null, 'invalid_country', jsonb_build_object('country', v_code));
  end if;
  if p_price is null or p_price not between 500 and 100000 then
    return public.internal_admin_fail('save_registration_fee', 'registration_fee', null, 'invalid_price', jsonb_build_object('country', v_code));
  end if;
  select * into o from public.registration_fees where country_code = v_code;
  insert into public.registration_fees (country_code, price, active, updated_by)
  values (v_code, p_price, coalesce(p_active, false), auth.uid())
  on conflict (country_code) do update
    set price = excluded.price, active = excluded.active, updated_by = excluded.updated_by;
  perform public.log_audit('save_registration_fee', 'registration_fee', null, 'success', jsonb_build_object(
    'country', v_code, 'old_price', o.price, 'old_active', o.active, 'new_price', p_price, 'new_active', coalesce(p_active, false)));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_list_registration_fees()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object(
    'success', true,
    'enabled', public.is_flag_enabled('paid_registration'),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'price', f.price, 'active', coalesce(f.active, false)) order by c.name)
        from public.countries c left join public.registration_fees f on f.country_code = c.code), '[]'::jsonb));
end;
$$;

create or replace function public.admin_list_registrations(
  p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_status is not null and p_status not in ('pending_payment', 'paid', 'exempt') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  return jsonb_build_object(
    'success', true,
    'total', (select count(*) from public.account_registrations where p_status is null or status = p_status),
    'registrations', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select a.user_id, pr.full_name, a.country_code, a.status, a.fee, a.paid_at, a.exempt_reason, a.created_at
          from public.account_registrations a left join public.profiles pr on pr.id = a.user_id
         where p_status is null or a.status = p_status
         order by a.created_at desc, a.user_id limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;

create or replace function public.admin_exempt_registration(p_user uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  reg public.account_registrations;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('exempt_registration', 'registration', null, 'forbidden');
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return public.internal_admin_fail('exempt_registration', 'registration', null, 'reason_required');
  end if;
  select * into reg from public.account_registrations where user_id = p_user for update;
  if not found then
    return public.internal_admin_fail('exempt_registration', 'registration', null, 'not_found');
  end if;
  if reg.status <> 'pending_payment' then
    return public.internal_admin_fail('exempt_registration', 'registration', null, 'not_pending');
  end if;
  update public.account_registrations
     set status = 'exempt', exempt_reason = v_reason, exempted_by = auth.uid()
   where user_id = p_user;
  perform public.create_notification(p_user, 'achat', 'registration_exempted', auth.uid(), 'registration', reg.id,
    '{}'::jsonb, 'rge:' || reg.id::text);
  perform public.log_audit('exempt_registration', 'registration', null, 'success', jsonb_build_object('user', p_user));
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function
  public.admin_save_registration_fee(text, integer, boolean), public.admin_list_registration_fees(),
  public.admin_list_registrations(text, integer, integer), public.admin_exempt_registration(uuid, text)
  from public, anon;
grant execute on function
  public.admin_save_registration_fee(text, integer, boolean), public.admin_list_registration_fees(),
  public.admin_list_registrations(text, integer, integer), public.admin_exempt_registration(uuid, text)
  to authenticated;

-- Règlement : branche inscription
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
  tr public.tutoring_requests;
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
    elsif new.tutoring_request_id is not null then
      update public.tutoring_requests
         set payment_status = 'paid', paid_at = now()
       where id = new.tutoring_request_id and status = 'accepted' and payment_status = 'unpaid'
       returning * into tr;
      if tr.id is not null then
        perform public.create_notification(tr.tutor_id, 'formation', 'tutoring_paid', tr.student_id, 'tutoring_request', tr.id,
          jsonb_build_object('subject', tr.subject, 'scheduled_at', tr.scheduled_at), 'trp:' || tr.id::text);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'tutoring_not_payable_at_settlement', 'tutoring_request_id', new.tutoring_request_id));
      end if;
    elsif new.registration_id is not null then
      update public.account_registrations
         set status = 'paid', paid_at = now()
       where id = new.registration_id and status = 'pending_payment'
       returning user_id into v_user;
      if v_user is not null then
        perform public.create_notification(v_user, 'achat', 'registration_paid', null, 'registration', new.registration_id,
          '{}'::jsonb, 'rgp:' || new.registration_id::text);
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
    elsif new.tutoring_request_id is not null then
      update public.tutoring_requests
         set refund_status = 'done', status = case when status = 'accepted' then 'cancelled' else status end
       where id = new.tutoring_request_id and refund_status <> 'done';
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);
  return new;
end;
$function$;

-- Revenus : branche inscription
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
  elsif p.tutoring_request_id is not null then
    select tr.tutor_id into v_creator from public.tutoring_requests tr where tr.id = p.tutoring_request_id;
    select * into s from public.platform_fee_settings where kind = 'tutoring_commission';
    v_fee := public.platform_fee_amount('tutoring_commission', p.amount);
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount, rate_percent, fixed_fee, creator_id, creator_net)
    values (p.id, 'tutoring_commission', v_fee, p.amount, s.fee_percent, s.fee_fixed, v_creator, p.amount - v_fee)
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
  elsif p.registration_id is not null then
    insert into public.platform_revenue_entries (payment_id, kind, amount, base_amount)
    values (p.id, 'registration_fee', p.amount, p.amount)
    on conflict (payment_id, kind) where reversal_of is null do nothing;
    get diagnostics v_rows = row_count; v_n := v_n + v_rows;
  end if;
  return v_n;
end;
$$;
revoke execute on function public.record_revenue_for_payment(uuid) from public, anon, authenticated;
