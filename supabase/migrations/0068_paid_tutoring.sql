
-- Tutorat payant (activable par l'interrupteur paid_tutoring) : prix du tuteur, paiement après acceptation, remboursement, commission.

alter table public.tutor_profiles drop constraint tutor_profiles_free_only;
alter table public.tutor_profiles add constraint tutor_profiles_price_range check (hourly_price = 0 or hourly_price between 500 and 50000);

alter table public.tutoring_requests
  add column duration_minutes integer not null default 60 check (duration_minutes between 30 and 240),
  add column price integer not null default 0 check (price between 0 and 200000),
  add column payment_status text not null default 'not_required' check (payment_status in ('not_required', 'unpaid', 'paid')),
  add column pay_by timestamptz,
  add column paid_at timestamptz,
  add column refund_status text not null default 'none' check (refund_status in ('none', 'due', 'done'));
create index tutoring_requests_unpaid_idx on public.tutoring_requests (pay_by) where status = 'accepted' and payment_status = 'unpaid';
create index tutoring_requests_refund_idx on public.tutoring_requests (updated_at) where refund_status = 'due';

-- Paiements : nouvelle cible
alter table public.payments add column tutoring_request_id uuid references public.tutoring_requests(id) on delete restrict;
create unique index payments_one_per_tutoring_request on public.payments (tutoring_request_id) where tutoring_request_id is not null;
alter table public.payments drop constraint payments_exactly_one_target;
alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id, group_unblock_id, sponsorship_id, seller_subscription_id, tutoring_request_id) = 1);

create or replace function public.is_flag_enabled(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.platform_flags where key = p_key), false);
$$;
revoke execute on function public.is_flag_enabled(text) from public, anon;
grant execute on function public.is_flag_enabled(text) to authenticated;

-- Profil tuteur : prix horaire (accepté seulement si le tutorat payant est activé)
drop function public.save_tutor_profile(text[], text, text, text, boolean);

create or replace function public.save_tutor_profile(
  p_subjects text[], p_bio text, p_availability text, p_mode text, p_active boolean default true,
  p_hourly_price integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_subjects text[];
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_avail text := nullif(btrim(coalesce(p_availability, '')), '');
  v_price integer := coalesce(p_hourly_price, 0);
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_mode not in ('online', 'in_person', 'both') then
    return jsonb_build_object('success', false, 'error', 'invalid_mode');
  end if;
  select coalesce(array_agg(q.s order by q.ord), '{}') into v_subjects from (
    select distinct on (lower(btrim(t.x))) btrim(t.x) as s, t.ord
    from unnest(coalesce(p_subjects, '{}')) with ordinality as t(x, ord)
    where btrim(t.x) <> ''
    order by lower(btrim(t.x)), t.ord
  ) q;
  if cardinality(v_subjects) < 1 or cardinality(v_subjects) > 8
     or exists (select 1 from unnest(v_subjects) s where char_length(s) not between 2 and 60) then
    return jsonb_build_object('success', false, 'error', 'invalid_subjects');
  end if;
  if v_bio is not null and char_length(v_bio) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_bio');
  end if;
  if v_avail is not null and char_length(v_avail) > 300 then
    return jsonb_build_object('success', false, 'error', 'invalid_availability');
  end if;
  if v_price <> 0 then
    if v_price not between 500 and 50000 then
      return jsonb_build_object('success', false, 'error', 'invalid_price');
    end if;
    if not public.is_flag_enabled('paid_tutoring') then
      return jsonb_build_object('success', false, 'error', 'paid_tutoring_disabled');
    end if;
  end if;
  if coalesce(p_active, true) and not exists (select 1 from public.profiles where id = v_uid and verified) then
    return jsonb_build_object('success', false, 'error', 'verification_required');
  end if;

  insert into public.tutor_profiles (user_id, subjects, bio, availability, mode, active, hourly_price)
  values (v_uid, v_subjects, v_bio, v_avail, p_mode, coalesce(p_active, true), v_price)
  on conflict (user_id) do update
    set subjects = excluded.subjects, bio = excluded.bio, availability = excluded.availability,
        mode = excluded.mode, active = excluded.active, hourly_price = excluded.hourly_price;
  return jsonb_build_object('success', true);
end;
$$;

-- Demande : durée et prix figé au moment de la demande
drop function public.request_tutoring(uuid, text, text, text, timestamptz);

create or replace function public.request_tutoring(
  p_tutor uuid, p_subject text, p_message text, p_mode text, p_proposed_at timestamptz default null,
  p_duration_minutes integer default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t public.tutor_profiles;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_id uuid;
  v_name text;
  v_price integer := 0;
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  if p_tutor = v_uid then
    return jsonb_build_object('success', false, 'error', 'own_profile');
  end if;
  select * into t from public.tutor_profiles where user_id = p_tutor and active;
  if not found
     or public.is_account_hidden(p_tutor)
     or exists (select 1 from public.account_restrictions where user_id = p_tutor)
     or public.is_blocked(v_uid, p_tutor) or public.is_blocked(p_tutor, v_uid) then
    return jsonb_build_object('success', false, 'error', 'unavailable');
  end if;
  if p_mode not in ('online', 'in_person') or (t.mode <> 'both' and t.mode <> p_mode) then
    return jsonb_build_object('success', false, 'error', 'mode_unavailable');
  end if;
  if char_length(v_subject) not between 2 and 60
     or not exists (select 1 from unnest(t.subjects) s where lower(btrim(s)) = lower(v_subject)) then
    return jsonb_build_object('success', false, 'error', 'subject_unavailable');
  end if;
  if v_msg is not null and char_length(v_msg) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_message');
  end if;
  if p_proposed_at is not null and p_proposed_at <= now() then
    return jsonb_build_object('success', false, 'error', 'invalid_date');
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 30 and 240 then
    return jsonb_build_object('success', false, 'error', 'invalid_duration');
  end if;
  if t.hourly_price > 0 and public.is_flag_enabled('paid_tutoring') then
    v_price := greatest(round(t.hourly_price * p_duration_minutes / 60.0)::integer, 500);
  end if;

  begin
    insert into public.tutoring_requests (student_id, tutor_id, subject, message, mode, proposed_at, duration_minutes, price)
    values (v_uid, p_tutor, v_subject, v_msg, p_mode, p_proposed_at, p_duration_minutes, v_price)
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'already_requested');
    when sqlstate 'P0429' then
      return jsonb_build_object('success', false, 'error', 'rate_limited');
  end;

  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(p_tutor, 'formation', 'tutoring_request_received', v_uid,
    'tutoring_request', v_id, jsonb_build_object('student_name', v_name, 'subject', v_subject, 'price', v_price), 'trq:' || v_id::text);
  return jsonb_build_object('success', true, 'id', v_id, 'price', v_price);
end;
$$;

-- Réponse du tuteur : une séance payante doit être payée avant la date
create or replace function public.respond_tutoring_request(
  p_request uuid, p_accept boolean, p_scheduled_at timestamptz default null,
  p_location text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.tutoring_requests;
  v_loc text := nullif(btrim(coalesce(p_location, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
  v_pay_by timestamptz;
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  select * into r from public.tutoring_requests where id = p_request for update;
  if not found or r.tutor_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    return jsonb_build_object('success', false, 'error', 'invalid_note');
  end if;

  select full_name into v_name from public.profiles where id = v_uid;
  if p_accept then
    if p_scheduled_at is null or p_scheduled_at <= now() then
      return jsonb_build_object('success', false, 'error', 'invalid_date');
    end if;
    if v_loc is null or char_length(v_loc) not between 2 and 200 then
      return jsonb_build_object('success', false, 'error', 'invalid_location');
    end if;
    if r.price > 0 then
      if p_scheduled_at < now() + interval '2 hours' then
        return jsonb_build_object('success', false, 'error', 'too_soon_for_paid');
      end if;
      v_pay_by := least(now() + interval '24 hours', p_scheduled_at - interval '1 hour');
    end if;
    update public.tutoring_requests
       set status = 'accepted', scheduled_at = p_scheduled_at, location = v_loc, tutor_note = v_note, responded_at = now(),
           payment_status = case when r.price > 0 then 'unpaid' else 'not_required' end, pay_by = v_pay_by
     where id = r.id;
    perform public.create_notification(r.student_id, 'formation', 'tutoring_request_accepted', v_uid,
      'tutoring_request', r.id,
      jsonb_build_object('tutor_name', v_name, 'subject', r.subject, 'scheduled_at', p_scheduled_at, 'price', r.price, 'pay_by', v_pay_by),
      'tra:' || r.id::text);
  else
    update public.tutoring_requests
       set status = 'declined', tutor_note = v_note, responded_at = now()
     where id = r.id;
    perform public.create_notification(r.student_id, 'formation', 'tutoring_request_declined', v_uid,
      'tutoring_request', r.id, jsonb_build_object('tutor_name', v_name, 'subject', r.subject), 'trd:' || r.id::text);
  end if;
  return jsonb_build_object('success', true);
end;
$$;

-- Annulation : une séance payée annulée donne droit à un remboursement
create or replace function public.cancel_tutoring_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.tutoring_requests;
  v_other uuid;
  v_name text;
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  select * into r from public.tutoring_requests where id = p_request for update;
  if not found or v_uid not in (r.student_id, r.tutor_id) then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if not (r.status = 'accepted' or (r.status = 'pending' and v_uid = r.student_id)) then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  update public.tutoring_requests
     set status = 'cancelled',
         refund_status = case when payment_status = 'paid' then 'due' else refund_status end
   where id = r.id;
  v_other := case when v_uid = r.student_id then r.tutor_id else r.student_id end;
  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(v_other, 'formation', 'tutoring_request_cancelled', v_uid,
    'tutoring_request', r.id,
    jsonb_build_object('name', v_name, 'subject', r.subject, 'refund_due', r.payment_status = 'paid' and v_uid = r.tutor_id),
    'trc:' || r.id::text);
  return jsonb_build_object('success', true, 'refund_due', r.payment_status = 'paid');
end;
$$;

-- Fin de séance : l'élève confirme ; le tuteur seulement 72 h après la séance pour une séance payante
create or replace function public.complete_tutoring_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.tutoring_requests;
  v_other uuid;
  v_name text;
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  select * into r from public.tutoring_requests where id = p_request for update;
  if not found or v_uid not in (r.student_id, r.tutor_id) then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if r.status <> 'accepted' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if r.scheduled_at is null or r.scheduled_at > now() then
    return jsonb_build_object('success', false, 'error', 'too_early');
  end if;
  if r.price > 0 then
    if r.payment_status <> 'paid' then
      return jsonb_build_object('success', false, 'error', 'payment_required');
    end if;
    if v_uid = r.tutor_id and now() < r.scheduled_at + interval '72 hours' then
      return jsonb_build_object('success', false, 'error', 'too_early_for_tutor');
    end if;
  end if;
  update public.tutoring_requests set status = 'completed', completed_at = now() where id = r.id;
  update public.tutor_profiles set sessions_count = sessions_count + 1 where user_id = r.tutor_id;
  v_other := case when v_uid = r.student_id then r.tutor_id else r.student_id end;
  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(v_other, 'formation', 'tutoring_completed', v_uid,
    'tutoring_request', r.id, jsonb_build_object('name', v_name, 'subject', r.subject), 'trk:' || r.id::text);
  return jsonb_build_object('success', true);
end;
$$;

-- Cible de paiement (appelée par l'Edge Function uniquement)
create or replace function public.create_tutoring_payment_target(p_user uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.tutoring_requests;
begin
  select * into r from public.tutoring_requests where id = p_request;
  if not found or r.student_id <> p_user then
    return jsonb_build_object('success', false, 'error', 'request_not_found');
  end if;
  if r.status <> 'accepted' or r.price <= 0 then
    return jsonb_build_object('success', false, 'error', 'not_payable');
  end if;
  if r.payment_status = 'paid' then
    return jsonb_build_object('success', false, 'error', 'already_paid');
  end if;
  if r.pay_by is null or r.pay_by <= now() then
    return jsonb_build_object('success', false, 'error', 'payment_deadline_passed');
  end if;
  return jsonb_build_object('success', true, 'request_id', r.id, 'amount', r.price);
end;
$$;
revoke execute on function public.create_tutoring_payment_target(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_tutoring_payment_target(uuid, uuid) to service_role;

-- Expiration des séances non payées à temps
create or replace function public.expire_unpaid_tutoring()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    with x as (
      update public.tutoring_requests
         set status = 'cancelled'
       where status = 'accepted' and payment_status = 'unpaid' and pay_by < now()
       returning id, student_id, tutor_id, subject)
    select * from x
  loop
    v_n := v_n + 1;
    perform public.create_notification(r.student_id, 'formation', 'tutoring_request_cancelled', null,
      'tutoring_request', r.id, jsonb_build_object('subject', r.subject, 'reason', 'unpaid'), 'trx-s:' || r.id::text);
    perform public.create_notification(r.tutor_id, 'formation', 'tutoring_request_cancelled', null,
      'tutoring_request', r.id, jsonb_build_object('subject', r.subject, 'reason', 'unpaid'), 'trx-t:' || r.id::text);
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.expire_unpaid_tutoring() from public, anon, authenticated;
select cron.schedule('expire-unpaid-tutoring', '*/10 * * * *', 'select public.expire_unpaid_tutoring()');

-- Libération des gains du tuteur à la fin de la séance
create or replace function public.release_tutoring_earnings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.platform_revenue_entries
       set available_at = now() + public.platform_hold_interval('tutoring_commission')
     where kind = 'tutoring_commission' and available_at is null
       and payment_id in (select id from public.payments where tutoring_request_id = new.id);
  end if;
  return null;
end;
$$;
create trigger tutoring_requests_release_earnings after update of status on public.tutoring_requests
  for each row execute function public.release_tutoring_earnings();

-- Admin : remboursements dus
create or replace function public.admin_list_tutoring_refunds_due(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object(
    'success', true,
    'total', (select count(*) from public.tutoring_requests where refund_status = 'due'),
    'requests', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select t.id, t.price as amount, t.subject, t.status, t.scheduled_at, t.paid_at, t.updated_at,
               t.student_id, ps.full_name as student_name, t.tutor_id, pt.full_name as tutor_name
          from public.tutoring_requests t
          join public.profiles ps on ps.id = t.student_id
          join public.profiles pt on pt.id = t.tutor_id
         where t.refund_status = 'due'
         order by t.updated_at, t.id limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;

create or replace function public.admin_mark_tutoring_refunded(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.tutoring_requests;
begin
  if not (public.act_as_admin() and public.mfa_ok()) then
    return public.internal_admin_fail('refund_tutoring', 'tutoring_request', p_request, 'forbidden');
  end if;
  select * into r from public.tutoring_requests where id = p_request for update;
  if not found then
    return public.internal_admin_fail('refund_tutoring', 'tutoring_request', p_request, 'not_found');
  end if;
  if r.refund_status <> 'due' then
    return public.internal_admin_fail('refund_tutoring', 'tutoring_request', p_request, 'no_refund_due');
  end if;
  update public.payments set status = 'refunded' where tutoring_request_id = p_request and status = 'success';
  update public.tutoring_requests set refund_status = 'done' where id = p_request;
  perform public.log_audit('refund_tutoring', 'tutoring_request', p_request, 'success', jsonb_build_object('amount', r.price));
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function
  public.save_tutor_profile(text[], text, text, text, boolean, integer),
  public.request_tutoring(uuid, text, text, text, timestamptz, integer),
  public.admin_list_tutoring_refunds_due(integer, integer), public.admin_mark_tutoring_refunded(uuid)
  from public, anon;
grant execute on function
  public.save_tutor_profile(text[], text, text, text, boolean, integer),
  public.request_tutoring(uuid, text, text, text, timestamptz, integer),
  public.admin_list_tutoring_refunds_due(integer, integer), public.admin_mark_tutoring_refunded(uuid)
  to authenticated;

-- Vues : prix affiché (0 tant que le tutorat payant est désactivé) et champs de paiement
drop view public.tutors_directory;
create view public.tutors_directory with (security_invoker = true) as
select t.user_id, t.subjects, t.bio, t.availability, t.mode,
       case when public.is_flag_enabled('paid_tutoring') then t.hourly_price else 0 end as hourly_price,
       t.rating_avg, t.reviews_count, t.sessions_count, t.active,
       pr.full_name, pr.avatar_url, pr.campus, pr.verified, pr.filiere, pr.niveau,
       pr.university_id, u.short_name as university_short_name
from public.tutor_profiles t
join public.profiles pr on pr.id = t.user_id
left join public.universities u on u.id = pr.university_id
where t.active;
revoke all on public.tutors_directory from anon, authenticated;
grant select on public.tutors_directory to authenticated;

drop view public.tutoring_requests_list;
create view public.tutoring_requests_list with (security_invoker = true) as
select r.id, r.student_id, r.tutor_id, r.subject, r.message, r.mode, r.proposed_at, r.status,
       r.scheduled_at, r.location, r.tutor_note, r.responded_at, r.completed_at, r.created_at,
       r.duration_minutes, r.price, r.payment_status, r.pay_by, r.paid_at, r.refund_status,
       ps.full_name as student_name, ps.avatar_url as student_avatar,
       pt.full_name as tutor_name, pt.avatar_url as tutor_avatar,
       (rv.request_id is not null) as reviewed
from public.tutoring_requests r
join public.profiles ps on ps.id = r.student_id
join public.profiles pt on pt.id = r.tutor_id
left join public.tutor_reviews rv on rv.request_id = r.id;
revoke all on public.tutoring_requests_list from anon, authenticated;
grant select on public.tutoring_requests_list to authenticated;

-- Règlement : branche tutorat
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

-- Revenus : branche tutorat
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
    -- gains du tuteur disponibles à la fin de la séance (voir trigger)
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
  end if;
  return v_n;
end;
$$;
revoke execute on function public.record_revenue_for_payment(uuid) from public, anon, authenticated;
