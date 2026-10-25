
-- Tutorat entre étudiants (gratuit pour l'instant ; hourly_price prêt pour le payant).
-- Pour activer le payant plus tard : alter table public.tutor_profiles drop constraint tutor_profiles_free_only;

create table public.tutor_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  subjects text[] not null check (cardinality(subjects) between 1 and 8),
  bio text check (bio is null or char_length(bio) <= 500),
  availability text check (availability is null or char_length(availability) <= 300),
  mode text not null default 'both' check (mode in ('online', 'in_person', 'both')),
  hourly_price integer not null default 0 check (hourly_price >= 0),
  active boolean not null default true,
  rating_avg numeric(3,2) not null default 0,
  reviews_count integer not null default 0,
  sessions_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tutor_profiles_free_only check (hourly_price = 0)
);

create table public.tutoring_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null check (char_length(subject) between 2 and 60),
  message text check (message is null or char_length(message) <= 500),
  mode text not null check (mode in ('online', 'in_person')),
  proposed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  scheduled_at timestamptz,
  location text check (location is null or char_length(location) <= 200),
  tutor_note text check (tutor_note is null or char_length(tutor_note) <= 300),
  responded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (student_id <> tutor_id)
);

create table public.tutor_reviews (
  request_id uuid primary key references public.tutoring_requests(id) on delete cascade,
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now()
);

create unique index tutoring_requests_one_open on public.tutoring_requests (student_id, tutor_id) where status in ('pending', 'accepted');
create index tutoring_requests_student_idx on public.tutoring_requests (student_id, created_at desc);
create index tutoring_requests_tutor_idx on public.tutoring_requests (tutor_id, status);
create index tutor_reviews_tutor_idx on public.tutor_reviews (tutor_id, created_at desc);
create index tutor_reviews_student_idx on public.tutor_reviews (student_id);
create index tutor_profiles_active_idx on public.tutor_profiles (rating_avg desc) where active;

-- Droits : lecture seule pour les clients ; toutes les écritures passent par les fonctions ci-dessous.
revoke all on public.tutor_profiles, public.tutoring_requests, public.tutor_reviews from anon, authenticated;
grant select on public.tutor_profiles, public.tutoring_requests, public.tutor_reviews to authenticated;

alter table public.tutor_profiles enable row level security;
alter table public.tutoring_requests enable row level security;
alter table public.tutor_reviews enable row level security;

create policy mfa_required on public.tutor_profiles as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.tutoring_requests as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.tutor_reviews as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create policy tutor_profiles_select on public.tutor_profiles for select to authenticated
  using (
    (active and (select public.is_active_account((select auth.uid()))))
    or user_id = (select auth.uid())
    or (select public.is_staff((select auth.uid())))
  );
create policy tutoring_requests_select on public.tutoring_requests for select to authenticated
  using (
    student_id = (select auth.uid())
    or tutor_id = (select auth.uid())
    or (select public.is_staff((select auth.uid())))
  );
create policy tutor_reviews_select on public.tutor_reviews for select to authenticated
  using ((select public.is_active_account((select auth.uid()))) or (select public.is_staff((select auth.uid()))));

-- Triggers
create trigger set_tutor_profiles_updated_at before update on public.tutor_profiles
  for each row execute function public.set_updated_at();
create trigger set_tutoring_requests_updated_at before update on public.tutoring_requests
  for each row execute function public.set_updated_at();
create trigger tutoring_requests_rate_limit before insert on public.tutoring_requests
  for each row execute function public.enforce_rate_limit('student_id', '10', '86400');

create or replace function public.enforce_tutoring_status_transition()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'declined', 'cancelled'))
      or (old.status = 'accepted' and new.status in ('cancelled', 'completed'))
    ) then
      raise exception 'invalid_status_transition' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger tutoring_requests_status_guard before update of status on public.tutoring_requests
  for each row execute function public.enforce_tutoring_status_transition();

-- Fonctions
create or replace function public.save_tutor_profile(
  p_subjects text[], p_bio text, p_availability text, p_mode text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_subjects text[];
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_avail text := nullif(btrim(coalesce(p_availability, '')), '');
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
  if coalesce(p_active, true) and not exists (select 1 from public.profiles where id = v_uid and verified) then
    return jsonb_build_object('success', false, 'error', 'verification_required');
  end if;

  insert into public.tutor_profiles (user_id, subjects, bio, availability, mode, active)
  values (v_uid, v_subjects, v_bio, v_avail, p_mode, coalesce(p_active, true))
  on conflict (user_id) do update
    set subjects = excluded.subjects, bio = excluded.bio, availability = excluded.availability,
        mode = excluded.mode, active = excluded.active;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.request_tutoring(
  p_tutor uuid, p_subject text, p_message text, p_mode text, p_proposed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t public.tutor_profiles;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_id uuid;
  v_name text;
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

  begin
    insert into public.tutoring_requests (student_id, tutor_id, subject, message, mode, proposed_at)
    values (v_uid, p_tutor, v_subject, v_msg, p_mode, p_proposed_at)
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'already_requested');
    when sqlstate 'P0429' then
      return jsonb_build_object('success', false, 'error', 'rate_limited');
  end;

  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(p_tutor, 'formation', 'tutoring_request_received', v_uid,
    'tutoring_request', v_id, jsonb_build_object('student_name', v_name, 'subject', v_subject), 'trq:' || v_id::text);
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

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
    update public.tutoring_requests
       set status = 'accepted', scheduled_at = p_scheduled_at, location = v_loc, tutor_note = v_note, responded_at = now()
     where id = r.id;
    perform public.create_notification(r.student_id, 'formation', 'tutoring_request_accepted', v_uid,
      'tutoring_request', r.id,
      jsonb_build_object('tutor_name', v_name, 'subject', r.subject, 'scheduled_at', p_scheduled_at),
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
  update public.tutoring_requests set status = 'cancelled' where id = r.id;
  v_other := case when v_uid = r.student_id then r.tutor_id else r.student_id end;
  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(v_other, 'formation', 'tutoring_request_cancelled', v_uid,
    'tutoring_request', r.id, jsonb_build_object('name', v_name, 'subject', r.subject), 'trc:' || r.id::text);
  return jsonb_build_object('success', true);
end;
$$;

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
  update public.tutoring_requests set status = 'completed', completed_at = now() where id = r.id;
  update public.tutor_profiles set sessions_count = sessions_count + 1 where user_id = r.tutor_id;
  v_other := case when v_uid = r.student_id then r.tutor_id else r.student_id end;
  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(v_other, 'formation', 'tutoring_completed', v_uid,
    'tutoring_request', r.id, jsonb_build_object('name', v_name, 'subject', r.subject), 'trk:' || r.id::text);
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.review_tutor(p_request uuid, p_rating integer, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.tutoring_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_name text;
begin
  if v_uid is null or not public.is_active_account(v_uid) or not public.mfa_ok() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  select * into r from public.tutoring_requests where id = p_request;
  if not found or r.student_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if r.status <> 'completed' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    return jsonb_build_object('success', false, 'error', 'invalid_rating');
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    return jsonb_build_object('success', false, 'error', 'invalid_comment');
  end if;
  begin
    insert into public.tutor_reviews (request_id, tutor_id, student_id, rating, comment)
    values (r.id, r.tutor_id, v_uid, p_rating, v_comment);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_reviewed');
  end;
  update public.tutor_profiles tp
     set rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.tutor_reviews where tutor_id = r.tutor_id), 0),
         reviews_count = (select count(*) from public.tutor_reviews where tutor_id = r.tutor_id)
   where tp.user_id = r.tutor_id;
  select full_name into v_name from public.profiles where id = v_uid;
  perform public.create_notification(r.tutor_id, 'formation', 'tutor_review_received', v_uid,
    'tutoring_request', r.id, jsonb_build_object('student_name', v_name, 'rating', p_rating), 'trv:' || r.id::text);
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function
  public.save_tutor_profile(text[], text, text, text, boolean),
  public.request_tutoring(uuid, text, text, text, timestamptz),
  public.respond_tutoring_request(uuid, boolean, timestamptz, text, text),
  public.cancel_tutoring_request(uuid),
  public.complete_tutoring_request(uuid),
  public.review_tutor(uuid, integer, text)
  from public, anon;
grant execute on function
  public.save_tutor_profile(text[], text, text, text, boolean),
  public.request_tutoring(uuid, text, text, text, timestamptz),
  public.respond_tutoring_request(uuid, boolean, timestamptz, text, text),
  public.cancel_tutoring_request(uuid),
  public.complete_tutoring_request(uuid),
  public.review_tutor(uuid, integer, text)
  to authenticated;

-- Vues de lecture
create view public.tutors_directory with (security_invoker = true) as
select t.user_id, t.subjects, t.bio, t.availability, t.mode, t.hourly_price,
       t.rating_avg, t.reviews_count, t.sessions_count, t.active,
       pr.full_name, pr.avatar_url, pr.campus, pr.verified, pr.filiere, pr.niveau,
       pr.university_id, u.short_name as university_short_name
from public.tutor_profiles t
join public.profiles pr on pr.id = t.user_id
left join public.universities u on u.id = pr.university_id
where t.active;

create view public.tutoring_requests_list with (security_invoker = true) as
select r.id, r.student_id, r.tutor_id, r.subject, r.message, r.mode, r.proposed_at, r.status,
       r.scheduled_at, r.location, r.tutor_note, r.responded_at, r.completed_at, r.created_at,
       ps.full_name as student_name, ps.avatar_url as student_avatar,
       pt.full_name as tutor_name, pt.avatar_url as tutor_avatar,
       (rv.request_id is not null) as reviewed
from public.tutoring_requests r
join public.profiles ps on ps.id = r.student_id
join public.profiles pt on pt.id = r.tutor_id
left join public.tutor_reviews rv on rv.request_id = r.id;

create view public.tutor_reviews_list with (security_invoker = true) as
select rv.request_id, rv.tutor_id, rv.rating, rv.comment, rv.created_at,
       pr.full_name as student_name, pr.avatar_url as student_avatar
from public.tutor_reviews rv
join public.profiles pr on pr.id = rv.student_id;

revoke all on public.tutors_directory, public.tutoring_requests_list, public.tutor_reviews_list from anon, authenticated;
grant select on public.tutors_directory, public.tutoring_requests_list, public.tutor_reviews_list to authenticated;
