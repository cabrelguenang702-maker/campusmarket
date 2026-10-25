
-- Groupes de révision (Campus Academy) : groupes, membres, séances, présences.

create table public.study_groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  university_id uuid references public.universities(id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  subject text not null check (char_length(subject) between 2 and 60),
  description text check (description is null or char_length(description) <= 1000),
  max_members integer not null default 12 check (max_members between 2 and 50),
  member_count integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_group_members (
  group_id uuid not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create unique index study_group_members_one_owner on public.study_group_members (group_id) where role = 'owner';

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  location text check (location is null or char_length(location) <= 200),
  notes text check (notes is null or char_length(notes) <= 1000),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.study_session_rsvps (
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'maybe')),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index study_groups_created_by_idx on public.study_groups (created_by);
create index study_groups_course_idx on public.study_groups (course_id);
create index study_groups_university_idx on public.study_groups (university_id);
create index study_groups_active_idx on public.study_groups (created_at desc) where archived_at is null;
create index study_group_members_user_idx on public.study_group_members (user_id);
create index study_sessions_group_start_idx on public.study_sessions (group_id, starts_at);
create index study_sessions_created_by_idx on public.study_sessions (created_by);
create index study_session_rsvps_user_idx on public.study_session_rsvps (user_id);

-- Droits : rien pour anon, pas de TRUNCATE/REFERENCES/TRIGGER pour authenticated.
revoke all on public.study_groups, public.study_group_members, public.study_sessions, public.study_session_rsvps from anon, authenticated;
grant select, insert, update on public.study_groups to authenticated;
grant select, insert, delete on public.study_group_members to authenticated;
grant select, insert, update, delete on public.study_sessions to authenticated;
grant select, insert, update, delete on public.study_session_rsvps to authenticated;

alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_session_rsvps enable row level security;

-- Fonctions d'aide (SECURITY DEFINER pour éviter la récursion RLS)
create or replace function public.is_study_group_member(p_group_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.study_group_members where group_id = p_group_id and user_id = p_user_id);
$$;

create or replace function public.is_study_group_owner(p_group_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.study_group_members where group_id = p_group_id and user_id = p_user_id and role = 'owner');
$$;

create or replace function public.is_study_session_member(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.study_sessions s
    join public.study_group_members m on m.group_id = s.group_id
    where s.id = p_session_id and m.user_id = p_user_id
  );
$$;

revoke execute on function public.is_study_group_member(uuid, uuid), public.is_study_group_owner(uuid, uuid), public.is_study_session_member(uuid, uuid) from public, anon;
grant execute on function public.is_study_group_member(uuid, uuid), public.is_study_group_owner(uuid, uuid), public.is_study_session_member(uuid, uuid) to authenticated;

-- Triggers : groupes
create or replace function public.study_group_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.member_count := 0;
  new.archived_at := null;
  new.university_id := (select p.university_id from public.profiles p where p.id = new.created_by);
  return new;
end;
$$;

create or replace function public.study_group_provision_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.study_group_members (group_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create or replace function public.protect_study_group_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.study_internal', true) = '1' then
    return new;
  end if;
  if public.is_staff(auth.uid()) then
    return new;
  end if;
  if new.created_by is distinct from old.created_by
     or new.course_id is distinct from old.course_id
     or new.university_id is distinct from old.university_id
     or new.member_count is distinct from old.member_count then
    raise exception 'protected_column' using errcode = 'P0001';
  end if;
  if new.max_members < old.member_count then
    raise exception 'max_members_below_count' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger study_groups_before_insert before insert on public.study_groups
  for each row execute function public.study_group_before_insert();
create trigger study_groups_rate_limit before insert on public.study_groups
  for each row execute function public.enforce_rate_limit('created_by', '5', '86400');
create trigger study_groups_provision_owner after insert on public.study_groups
  for each row execute function public.study_group_provision_owner();
create trigger study_groups_protect before update on public.study_groups
  for each row execute function public.protect_study_group_columns();
create trigger set_study_groups_updated_at before update on public.study_groups
  for each row execute function public.set_updated_at();

-- Triggers : membres
create or replace function public.study_group_member_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g public.study_groups;
  v_owner uuid;
begin
  select * into g from public.study_groups where id = new.group_id for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;
  if new.role = 'owner' then
    return new;
  end if;
  if g.archived_at is not null then
    raise exception 'group_archived' using errcode = 'P0001';
  end if;
  if g.member_count >= g.max_members then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  select user_id into v_owner from public.study_group_members where group_id = new.group_id and role = 'owner' limit 1;
  if v_owner is not null and public.is_blocked(v_owner, new.user_id) then
    raise exception 'group_not_available' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.study_group_member_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_gid uuid;
  v_next uuid;
  v_owner uuid;
  v_title text;
begin
  v_gid := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  perform set_config('app.study_internal', '1', true);
  update public.study_groups
     set member_count = (select count(*) from public.study_group_members where group_id = v_gid)
   where id = v_gid;

  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      select user_id into v_next from public.study_group_members
       where group_id = v_gid order by created_at, user_id limit 1;
      if v_next is not null then
        update public.study_group_members set role = 'owner' where group_id = v_gid and user_id = v_next;
      else
        update public.study_groups set archived_at = coalesce(archived_at, now()) where id = v_gid;
      end if;
    end if;
  elsif new.role = 'member' then
    select m.user_id, g.title into v_owner, v_title
      from public.study_group_members m join public.study_groups g on g.id = m.group_id
     where m.group_id = v_gid and m.role = 'owner' limit 1;
    if v_owner is not null then
      perform public.create_notification(
        v_owner, 'formation', 'study_group_member_joined', new.user_id,
        'study_group', v_gid, jsonb_build_object('group_title', v_title), 'sgj:' || v_gid::text);
    end if;
  end if;
  perform set_config('app.study_internal', '0', true);
  return null;
end;
$$;

create trigger study_group_members_before_insert before insert on public.study_group_members
  for each row execute function public.study_group_member_before_insert();
create trigger study_group_members_rate_limit before insert on public.study_group_members
  for each row execute function public.enforce_rate_limit('user_id', '30', '86400');
create trigger study_group_members_after_change after insert or delete on public.study_group_members
  for each row execute function public.study_group_member_after_change();

-- Triggers : séances
create or replace function public.study_session_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_archived timestamptz;
begin
  select archived_at into v_archived from public.study_groups where id = new.group_id;
  if v_archived is not null then
    raise exception 'group_archived' using errcode = 'P0001';
  end if;
  if new.starts_at < now() - interval '5 minutes' then
    raise exception 'session_in_past' using errcode = 'P0001';
  end if;
  new.cancelled_at := null;
  return new;
end;
$$;

create or replace function public.protect_study_session_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.group_id is distinct from old.group_id or new.created_by is distinct from old.created_by then
    raise exception 'protected_column' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.study_session_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_title text;
begin
  select title into v_title from public.study_groups where id = new.group_id;
  if tg_op = 'INSERT' then
    for r in select user_id from public.study_group_members where group_id = new.group_id and user_id <> new.created_by loop
      perform public.create_notification(
        r.user_id, 'formation', 'study_session_created', new.created_by, 'study_group', new.group_id,
        jsonb_build_object('group_title', v_title, 'session_id', new.id, 'session_title', new.title, 'starts_at', new.starts_at),
        'sgs:' || new.group_id::text);
    end loop;
  elsif old.cancelled_at is null and new.cancelled_at is not null then
    for r in select user_id from public.study_group_members where group_id = new.group_id and user_id <> new.created_by loop
      perform public.create_notification(
        r.user_id, 'formation', 'study_session_cancelled', new.created_by, 'study_group', new.group_id,
        jsonb_build_object('group_title', v_title, 'session_id', new.id, 'session_title', new.title, 'starts_at', new.starts_at),
        'sgc:' || new.id::text);
    end loop;
  end if;
  return null;
end;
$$;

create trigger study_sessions_before_insert before insert on public.study_sessions
  for each row execute function public.study_session_before_insert();
create trigger study_sessions_rate_limit before insert on public.study_sessions
  for each row execute function public.enforce_rate_limit('created_by', '20', '86400');
create trigger study_sessions_protect before update on public.study_sessions
  for each row execute function public.protect_study_session_columns();
create trigger set_study_sessions_updated_at before update on public.study_sessions
  for each row execute function public.set_updated_at();
create trigger study_sessions_notify_insert after insert on public.study_sessions
  for each row execute function public.study_session_notify();
create trigger study_sessions_notify_update after update of cancelled_at on public.study_sessions
  for each row execute function public.study_session_notify();

-- Policies RLS
create policy mfa_required on public.study_groups as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.study_group_members as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.study_sessions as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.study_session_rsvps as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create policy study_groups_select on public.study_groups for select to authenticated
  using (
    (archived_at is null and (select public.is_active_account((select auth.uid()))))
    or public.is_study_group_member(id, (select auth.uid()))
    or (select public.is_staff((select auth.uid())))
  );
create policy study_groups_insert on public.study_groups for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.is_active_account((select auth.uid())))
    and (
      course_id is null
      or exists (
        select 1 from public.course_enrollments e
        where e.course_id = study_groups.course_id
          and e.user_id = (select auth.uid())
          and e.status = 'active'
      )
    )
  );
create policy study_groups_update on public.study_groups for update to authenticated
  using (public.is_study_group_owner(id, (select auth.uid())) or (select public.is_staff((select auth.uid()))))
  with check (public.is_study_group_owner(id, (select auth.uid())) or (select public.is_staff((select auth.uid()))));

create policy study_group_members_select on public.study_group_members for select to authenticated
  using (public.is_study_group_member(group_id, (select auth.uid())) or (select public.is_staff((select auth.uid()))));
create policy study_group_members_join on public.study_group_members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'member'
    and (select public.is_active_account((select auth.uid())))
    and exists (
      select 1 from public.study_groups g
      where g.id = study_group_members.group_id and g.archived_at is null
    )
  );
create policy study_group_members_leave_or_kick on public.study_group_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_study_group_owner(group_id, (select auth.uid()))
    or (select public.is_staff((select auth.uid())))
  );

create policy study_sessions_select on public.study_sessions for select to authenticated
  using (public.is_study_group_member(group_id, (select auth.uid())) or (select public.is_staff((select auth.uid()))));
create policy study_sessions_insert on public.study_sessions for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_study_group_owner(group_id, (select auth.uid())));
create policy study_sessions_update on public.study_sessions for update to authenticated
  using (public.is_study_group_owner(group_id, (select auth.uid())))
  with check (public.is_study_group_owner(group_id, (select auth.uid())));
create policy study_sessions_delete on public.study_sessions for delete to authenticated
  using (public.is_study_group_owner(group_id, (select auth.uid())) or (select public.is_staff((select auth.uid()))));

create policy study_rsvps_select on public.study_session_rsvps for select to authenticated
  using (public.is_study_session_member(session_id, (select auth.uid())) or (select public.is_staff((select auth.uid()))));
create policy study_rsvps_insert on public.study_session_rsvps for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_study_session_member(session_id, (select auth.uid()))
    and exists (
      select 1 from public.study_sessions s
      where s.id = study_session_rsvps.session_id and s.cancelled_at is null
    )
  );
create policy study_rsvps_update on public.study_session_rsvps for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_study_session_member(session_id, (select auth.uid())));
create policy study_rsvps_delete on public.study_session_rsvps for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff((select auth.uid()))));

-- Vues de lecture
create view public.study_groups_overview with (security_invoker = true) as
select
  g.id, g.title, g.subject, g.description, g.course_id, g.university_id,
  g.max_members, g.member_count, g.archived_at, g.created_at,
  c.title as course_title,
  u.short_name as university_short_name,
  u.name as university_name,
  po.full_name as owner_name,
  public.is_study_group_member(g.id, (select auth.uid())) as is_member,
  public.is_study_group_owner(g.id, (select auth.uid())) as is_owner
from public.study_groups g
left join public.courses c on c.id = g.course_id
left join public.universities u on u.id = g.university_id
left join public.study_group_members mo on mo.group_id = g.id and mo.role = 'owner'
left join public.profiles po on po.id = mo.user_id;

create view public.study_group_members_list with (security_invoker = true) as
select m.group_id, m.user_id, m.role, m.created_at as joined_at,
       pr.full_name, pr.avatar_url, pr.campus, pr.verified
from public.study_group_members m
join public.profiles pr on pr.id = m.user_id;

create view public.study_session_rsvps_list with (security_invoker = true) as
select r.session_id, r.user_id, r.status, pr.full_name, pr.avatar_url
from public.study_session_rsvps r
join public.profiles pr on pr.id = r.user_id;

revoke all on public.study_groups_overview, public.study_group_members_list, public.study_session_rsvps_list from anon, authenticated;
grant select on public.study_groups_overview, public.study_group_members_list, public.study_session_rsvps_list to authenticated;
