-- 0058 — Campus Jobs (cahier des charges §6) : recruteurs, offres, profil professionnel, candidatures.
-- Principes : toute transition d'état passe par une fonction SECURITY DEFINER (jamais d'écriture directe du statut) ; le candidat ne partage
-- son profil professionnel qu'au moment de postuler (instantané figé) ; les notes internes ne sont lisibles que du recruteur ; le personnel
-- ne lit pas les candidatures. Les offres d'un recruteur non vérifié passent par la modération ; celles d'un recruteur vérifié sont publiées.

alter type public.report_target_type add value if not exists 'job_offer';

-- 1. RECRUTEURS --------------------------------------------------------------------------------------------------------------------------
create table public.recruiters (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  organization_name text not null check (char_length(organization_name) between 2 and 150),
  website text check (website is null or website ~* '^https?://[^[:space:]]+$'),
  description text check (char_length(description) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'suspended')),
  status_reason text check (char_length(status_reason) <= 500),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recruiters_reviewed_by_idx on public.recruiters (reviewed_by) where reviewed_by is not null;
create trigger set_recruiters_updated_at before update on public.recruiters for each row execute function public.set_updated_at();

-- 2. OFFRES ------------------------------------------------------------------------------------------------------------------------------
create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references public.recruiters (user_id) on delete cascade,
  kind text not null check (kind in ('stage', 'emploi', 'mission', 'benevolat', 'mentorat')),
  title text not null check (char_length(title) between 5 and 150),
  description text not null check (char_length(description) between 30 and 5000),
  responsibilities text check (char_length(responsibilities) <= 3000),
  skills text[] not null default '{}' check (cardinality(skills) <= 15),
  level text not null default 'tous' check (level in ('debutant', 'intermediaire', 'confirme', 'tous')),
  domain text check (char_length(domain) <= 80),
  country_code char(2) references public.countries (code),
  city text check (char_length(city) <= 100),
  work_mode text not null default 'sur_site' check (work_mode in ('sur_site', 'distant', 'hybride')),
  compensation text check (char_length(compensation) <= 150),
  deadline date,
  questions text[] not null default '{}' check (cardinality(questions) <= 5),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'rejected', 'closed', 'archived', 'suspended')),
  status_reason text check (char_length(status_reason) <= 500),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_offers_recruiter_idx on public.job_offers (recruiter_id, status);
create index job_offers_feed_idx on public.job_offers (published_at desc) where status = 'published';
create index job_offers_country_idx on public.job_offers (country_code) where country_code is not null;
create index job_offers_skills_idx on public.job_offers using gin (skills);
create unique index job_offers_no_duplicate on public.job_offers (recruiter_id, lower(title)) where status in ('pending_review', 'published');
create trigger set_job_offers_updated_at before update on public.job_offers for each row execute function public.set_updated_at();

create or replace function public.protect_job_offer_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status or new.status_reason is distinct from old.status_reason
       or new.published_at is distinct from old.published_at or new.recruiter_id is distinct from old.recruiter_id then
      raise exception 'Le statut d''une offre ne se modifie que par les fonctions prévues (soumission, clôture, modération)';
    end if;
  end if;
  return new;
end;
$$;
create trigger job_offers_protect_columns before update on public.job_offers for each row execute function public.protect_job_offer_columns();

-- 3. PROFIL PROFESSIONNEL (privé : partagé seulement au moment de postuler) -------------------------------------------------------------
create table public.professional_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  headline text check (char_length(headline) <= 120),
  summary text check (char_length(summary) <= 2000),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  education jsonb not null default '[]' check (jsonb_typeof(education) = 'array' and jsonb_array_length(education) <= 10),
  experiences jsonb not null default '[]' check (jsonb_typeof(experiences) = 'array' and jsonb_array_length(experiences) <= 10),
  projects jsonb not null default '[]' check (jsonb_typeof(projects) = 'array' and jsonb_array_length(projects) <= 10),
  portfolio_url text check (portfolio_url is null or portfolio_url ~* '^https?://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_professional_profiles_updated_at before update on public.professional_profiles for each row execute function public.set_updated_at();

-- 4. CANDIDATURES ------------------------------------------------------------------------------------------------------------------------
create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.job_offers (id) on delete cascade,
  applicant_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'received' check (status in ('received', 'reviewing', 'shortlisted', 'interview', 'accepted', 'rejected', 'withdrawn')),
  message text check (char_length(message) <= 3000),
  answers text[] not null default '{}',
  profile_snapshot jsonb,
  cv_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id, applicant_id)
);
create index job_applications_applicant_idx on public.job_applications (applicant_id, created_at desc);
create index job_applications_offer_idx on public.job_applications (offer_id, status);
create trigger set_job_applications_updated_at before update on public.job_applications for each row execute function public.set_updated_at();

create table public.job_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_applications (id) on delete cascade,
  status text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index job_application_events_idx on public.job_application_events (application_id, created_at);
create index job_application_events_actor_idx on public.job_application_events (actor_id) where actor_id is not null;

create table public.job_application_notes (
  application_id uuid primary key references public.job_applications (id) on delete cascade,
  note text not null check (char_length(note) <= 2000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index job_application_notes_by_idx on public.job_application_notes (updated_by) where updated_by is not null;

-- 5. AIDES DE DROIT ----------------------------------------------------------------------------------------------------------------------
create or replace function public.is_active_recruiter(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recruiters r where r.user_id = uid and r.status in ('pending', 'verified'));
$$;

create or replace function public.is_application_recruiter(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.job_applications a
    join public.job_offers o on o.id = a.offer_id
    join public.recruiters r on r.user_id = o.recruiter_id
    where a.id = p_application_id and o.recruiter_id = auth.uid() and r.status in ('pending', 'verified')
  );
$$;

-- 6. RLS ---------------------------------------------------------------------------------------------------------------------------------
alter table public.recruiters enable row level security;
alter table public.job_offers enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.job_applications enable row level security;
alter table public.job_application_events enable row level security;
alter table public.job_application_notes enable row level security;

create policy mfa_required on public.recruiters as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.job_offers as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.professional_profiles as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.job_applications as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.job_application_events as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.job_application_notes as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create policy recruiters_select on public.recruiters for select to authenticated using (
  user_id = (select auth.uid()) or (select public.is_staff()) or status = 'verified'
  or exists (select 1 from public.job_offers o where o.recruiter_id = recruiters.user_id and o.status = 'published')
);

create policy job_offers_select on public.job_offers for select to authenticated using (
  status = 'published' or recruiter_id = (select auth.uid()) or (select public.is_staff())
);
create policy job_offers_insert_draft on public.job_offers for insert to authenticated with check (
  recruiter_id = (select auth.uid()) and status = 'draft' and (select public.is_active_recruiter()) and (select public.is_active_account())
);
create policy job_offers_update_own on public.job_offers for update to authenticated
  using (recruiter_id = (select auth.uid()) and status in ('draft', 'rejected'))
  with check (recruiter_id = (select auth.uid()) and status in ('draft', 'rejected'));
create policy job_offers_delete_draft on public.job_offers for delete to authenticated
  using (recruiter_id = (select auth.uid()) and status = 'draft');

create policy professional_profiles_own on public.professional_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select public.is_active_account()));

create policy job_applications_select on public.job_applications for select to authenticated using (
  applicant_id = (select auth.uid()) or (select public.is_application_recruiter(id))
);
create policy job_application_events_select on public.job_application_events for select to authenticated using (
  exists (select 1 from public.job_applications a where a.id = application_id and a.applicant_id = (select auth.uid()))
  or (select public.is_application_recruiter(application_id))
);
create policy job_application_notes_recruiter on public.job_application_notes for all to authenticated
  using ((select public.is_application_recruiter(application_id)))
  with check ((select public.is_application_recruiter(application_id)) and updated_by = (select auth.uid()));

-- 7. CV (PDF, privé) ---------------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-documents', 'job-documents', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

create or replace function public.job_document_readable(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or exists (
        select 1 from public.job_applications a
        join public.job_offers o on o.id = a.offer_id
        join public.recruiters r on r.user_id = o.recruiter_id
        where a.cv_path = p_name and o.recruiter_id = auth.uid() and r.status in ('pending', 'verified')
      );
$$;
create policy job_documents_select on storage.objects for select to authenticated
  using (bucket_id = 'job-documents' and (select public.job_document_readable(name)));
create policy job_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy job_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 8. FONCTIONS ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.request_recruiter(p_organization text, p_website text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org text := btrim(coalesce(p_organization, ''));
  v_web text := nullif(btrim(coalesce(p_website, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_row public.recruiters;
begin
  if v_uid is null or not public.is_active_account() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  if char_length(v_org) < 2 or char_length(v_org) > 150 then return jsonb_build_object('success', false, 'error', 'invalid_organization'); end if;
  if v_web is not null and v_web !~* '^https?://[^[:space:]]+$' then return jsonb_build_object('success', false, 'error', 'invalid_website'); end if;
  if v_desc is not null and char_length(v_desc) > 2000 then return jsonb_build_object('success', false, 'error', 'invalid_description'); end if;
  select * into v_row from public.recruiters where user_id = v_uid for update;
  if found then
    if v_row.status = 'suspended' then return jsonb_build_object('success', false, 'error', 'suspended'); end if;
    if v_row.status = 'verified' then return jsonb_build_object('success', false, 'error', 'already_verified'); end if;
    update public.recruiters set organization_name = v_org, website = v_web, description = v_desc, status = 'pending', status_reason = null, reviewed_by = null, reviewed_at = null where user_id = v_uid;
  else
    insert into public.recruiters (user_id, organization_name, website, description) values (v_uid, v_org, v_web, v_desc);
  end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_review_recruiter(p_user_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.recruiters;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.act_as_moderator() then return public.internal_admin_fail('review_recruiter', 'recruiter', p_user_id, 'forbidden'); end if;
  if p_status not in ('verified', 'rejected', 'suspended') then return public.internal_admin_fail('review_recruiter', 'recruiter', p_user_id, 'invalid_status'); end if;
  if p_status in ('rejected', 'suspended') and (v_reason is null or char_length(v_reason) < 3) then
    return public.internal_admin_fail('review_recruiter', 'recruiter', p_user_id, 'reason_required');
  end if;
  select * into v_row from public.recruiters where user_id = p_user_id for update;
  if not found then return public.internal_admin_fail('review_recruiter', 'recruiter', p_user_id, 'not_found'); end if;
  if p_user_id = auth.uid() then return public.internal_admin_fail('review_recruiter', 'recruiter', p_user_id, 'cannot_review_own'); end if;

  update public.recruiters set status = p_status, status_reason = v_reason, reviewed_by = auth.uid(), reviewed_at = now() where user_id = p_user_id;
  if p_status in ('suspended', 'rejected') then
    update public.job_offers set status = 'suspended', status_reason = 'Organisation non autorisée' where recruiter_id = p_user_id and status in ('published', 'pending_review');
  end if;
  perform public.create_notification(p_user_id, 'systeme', 'recruiter_' || p_status, auth.uid(), 'recruiter', p_user_id,
    jsonb_build_object('reason', v_reason), 'rec:' || p_user_id::text || ':' || p_status || ':' || extract(epoch from now())::bigint::text);
  perform public.log_audit('review_recruiter', 'recruiter', p_user_id, 'success', jsonb_build_object('status', p_status));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.submit_job_offer(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.job_offers;
  v_rec public.recruiters;
  v_next text;
begin
  if v_uid is null or not public.is_active_account() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_offer from public.job_offers where id = p_offer_id for update;
  if not found or v_offer.recruiter_id <> v_uid then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_offer.status not in ('draft', 'rejected') then return jsonb_build_object('success', false, 'error', 'not_submittable'); end if;
  select * into v_rec from public.recruiters where user_id = v_uid;
  if v_rec.status is null or v_rec.status not in ('pending', 'verified') then return jsonb_build_object('success', false, 'error', 'recruiter_not_allowed'); end if;
  if v_offer.work_mode <> 'distant' and v_offer.country_code is null then return jsonb_build_object('success', false, 'error', 'location_required'); end if;
  if v_offer.deadline is not null and v_offer.deadline < current_date then return jsonb_build_object('success', false, 'error', 'deadline_passed'); end if;
  if (select count(*) from public.job_offers where recruiter_id = v_uid and status in ('pending_review', 'published')) >= 30 then
    return jsonb_build_object('success', false, 'error', 'too_many_offers');
  end if;
  v_next := case when v_rec.status = 'verified' then 'published' else 'pending_review' end;
  begin
    update public.job_offers set status = v_next, status_reason = null, published_at = case when v_next = 'published' then now() else null end where id = p_offer_id;
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'duplicate');
  end;
  return jsonb_build_object('success', true, 'status', v_next);
end;
$$;

create or replace function public.set_job_offer_state(p_offer_id uuid, p_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.job_offers;
begin
  if auth.uid() is null then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_offer from public.job_offers where id = p_offer_id for update;
  if not found or v_offer.recruiter_id <> auth.uid() then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if not (
       (v_offer.status = 'published' and p_state in ('closed', 'draft'))
    or (v_offer.status = 'pending_review' and p_state = 'draft')
    or (v_offer.status in ('closed', 'rejected') and p_state = 'archived')
  ) then return jsonb_build_object('success', false, 'error', 'invalid_transition'); end if;
  update public.job_offers set status = p_state, status_reason = null, published_at = case when p_state = 'draft' then null else published_at end where id = p_offer_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_review_job_offer(p_offer_id uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.job_offers;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next text;
begin
  if not public.act_as_moderator() then return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'forbidden'); end if;
  if p_decision not in ('approve', 'reject', 'suspend', 'restore') then return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'invalid_decision'); end if;
  if p_decision in ('reject', 'suspend') and (v_reason is null or char_length(v_reason) < 3) then
    return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'reason_required');
  end if;
  select * into v_offer from public.job_offers where id = p_offer_id for update;
  if not found then return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'not_found'); end if;
  if not (
       (v_offer.status = 'pending_review' and p_decision in ('approve', 'reject'))
    or (v_offer.status = 'published' and p_decision = 'suspend')
    or (v_offer.status = 'suspended' and p_decision = 'restore')
  ) then return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'invalid_transition'); end if;
  if p_decision in ('approve', 'restore') and not exists (select 1 from public.recruiters where user_id = v_offer.recruiter_id and status in ('pending', 'verified')) then
    return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'recruiter_not_allowed');
  end if;
  v_next := case p_decision when 'approve' then 'published' when 'restore' then 'published' when 'reject' then 'rejected' else 'suspended' end;
  begin
    update public.job_offers set status = v_next, status_reason = case when v_next in ('rejected', 'suspended') then v_reason else null end,
      published_at = case when v_next = 'published' then coalesce(published_at, now()) else published_at end where id = p_offer_id;
  exception when unique_violation then
    return public.internal_admin_fail('review_job_offer', 'job_offer', p_offer_id, 'duplicate');
  end;
  perform public.create_notification(v_offer.recruiter_id, 'systeme', 'job_offer_' || v_next, auth.uid(), 'job_offer', p_offer_id,
    jsonb_build_object('title', v_offer.title, 'reason', v_reason), 'jo:' || p_offer_id::text || ':' || v_next || ':' || extract(epoch from now())::bigint::text);
  perform public.log_audit('review_job_offer', 'job_offer', p_offer_id, 'success', jsonb_build_object('decision', p_decision));
  return jsonb_build_object('success', true, 'status', v_next);
end;
$$;

create or replace function public.apply_to_job(p_offer_id uuid, p_message text, p_answers text[], p_cv_path text, p_share_profile boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.job_offers;
  v_name text;
  v_campus text;
  v_pro public.professional_profiles;
  v_snapshot jsonb := null;
  v_answers text[] := coalesce(p_answers, '{}');
  v_id uuid;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_uid is null or not public.is_active_account() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_offer from public.job_offers where id = p_offer_id and status = 'published';
  if not found then return jsonb_build_object('success', false, 'error', 'offer_unavailable'); end if;
  if v_offer.deadline is not null and v_offer.deadline < current_date then return jsonb_build_object('success', false, 'error', 'deadline_passed'); end if;
  if v_offer.recruiter_id = v_uid then return jsonb_build_object('success', false, 'error', 'own_offer'); end if;
  if not exists (select 1 from public.recruiters where user_id = v_offer.recruiter_id and status in ('pending', 'verified')) then
    return jsonb_build_object('success', false, 'error', 'offer_unavailable');
  end if;
  if exists (select 1 from public.job_applications where offer_id = p_offer_id and applicant_id = v_uid) then
    return jsonb_build_object('success', false, 'error', 'already_applied');
  end if;
  if v_msg is not null and char_length(v_msg) > 3000 then return jsonb_build_object('success', false, 'error', 'message_too_long'); end if;
  if cardinality(v_answers) > cardinality(v_offer.questions) or exists (select 1 from unnest(v_answers) a where char_length(a) > 2000) then
    return jsonb_build_object('success', false, 'error', 'invalid_answers');
  end if;
  if p_cv_path is not null and (storage.foldername(p_cv_path))[1] is distinct from v_uid::text then
    return jsonb_build_object('success', false, 'error', 'invalid_cv');
  end if;
  if (select count(*) from public.job_applications where applicant_id = v_uid and created_at > now() - interval '24 hours') >= 20 then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;

  if coalesce(p_share_profile, false) then
    select * into v_pro from public.professional_profiles where user_id = v_uid;
    select full_name, campus into v_name, v_campus from public.profiles where id = v_uid;
    v_snapshot := jsonb_build_object('name', v_name, 'campus', v_campus);
    if v_pro.user_id is not null then
      v_snapshot := v_snapshot || jsonb_build_object('headline', v_pro.headline, 'summary', v_pro.summary, 'skills', to_jsonb(v_pro.skills),
        'education', v_pro.education, 'experiences', v_pro.experiences, 'projects', v_pro.projects, 'portfolio_url', v_pro.portfolio_url);
    end if;
  end if;

  insert into public.job_applications (offer_id, applicant_id, message, answers, profile_snapshot, cv_path)
  values (p_offer_id, v_uid, v_msg, v_answers, v_snapshot, p_cv_path) returning id into v_id;
  insert into public.job_application_events (application_id, status, actor_id) values (v_id, 'received', v_uid);
  perform public.create_notification(v_offer.recruiter_id, 'systeme', 'job_application_received', v_uid, 'job_offer', p_offer_id,
    jsonb_build_object('title', v_offer.title), 'ja:' || v_id::text);
  return jsonb_build_object('success', true, 'application_id', v_id);
end;
$$;

create or replace function public.withdraw_job_application(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_app public.job_applications;
begin
  select * into v_app from public.job_applications where id = p_application_id for update;
  if not found or auth.uid() is null or v_app.applicant_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_app.status in ('accepted', 'rejected', 'withdrawn') then return jsonb_build_object('success', false, 'error', 'not_withdrawable'); end if;
  update public.job_applications set status = 'withdrawn' where id = p_application_id;
  insert into public.job_application_events (application_id, status, actor_id) values (p_application_id, 'withdrawn', auth.uid());
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.set_application_status(p_application_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_app public.job_applications;
  v_offer public.job_offers;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_application_recruiter(p_application_id) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if p_status not in ('reviewing', 'shortlisted', 'interview', 'accepted', 'rejected') then return jsonb_build_object('success', false, 'error', 'invalid_status'); end if;
  if v_note is not null and char_length(v_note) > 2000 then return jsonb_build_object('success', false, 'error', 'note_too_long'); end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.status = 'withdrawn' then return jsonb_build_object('success', false, 'error', 'withdrawn'); end if;
  if v_app.status in ('accepted', 'rejected') then return jsonb_build_object('success', false, 'error', 'already_decided'); end if;
  if v_app.status = p_status then return jsonb_build_object('success', false, 'error', 'same_status'); end if;
  select * into v_offer from public.job_offers where id = v_app.offer_id;

  update public.job_applications set status = p_status where id = p_application_id;
  insert into public.job_application_events (application_id, status, actor_id) values (p_application_id, p_status, auth.uid());
  if v_note is not null then
    insert into public.job_application_notes (application_id, note, updated_by) values (p_application_id, v_note, auth.uid())
    on conflict (application_id) do update set note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform public.create_notification(v_app.applicant_id, 'systeme', 'job_application_update', auth.uid(), 'job_offer', v_app.offer_id,
    jsonb_build_object('title', v_offer.title, 'status', p_status), 'jau:' || p_application_id::text || ':' || p_status);
  return jsonb_build_object('success', true);
end;
$$;

-- 9. DROITS D'EXÉCUTION ------------------------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('request_recruiter', 'admin_review_recruiter', 'submit_job_offer', 'set_job_offer_state', 'admin_review_job_offer', 'apply_to_job',
                      'withdraw_job_application', 'set_application_status', 'is_active_recruiter', 'is_application_recruiter', 'job_document_readable')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- 10. VUE DE LECTURE ---------------------------------------------------------------------------------------------------------------------
create or replace view public.job_offers_feed with (security_invoker = true) as
select o.id, o.recruiter_id, o.kind, o.title, o.description, o.responsibilities, o.skills, o.level, o.domain, o.country_code, o.city, o.work_mode,
       o.compensation, o.deadline, o.questions, o.status, o.status_reason, o.published_at, o.created_at,
       r.organization_name, r.website as organization_website, r.description as organization_description, (r.status = 'verified') as organization_verified,
       exists (select 1 from public.job_applications a where a.offer_id = o.id and a.applicant_id = auth.uid()) as has_applied
from public.job_offers o
join public.recruiters r on r.user_id = o.recruiter_id;
grant select on public.job_offers_feed to authenticated;

-- 11. CLÔTURE AUTOMATIQUE DES OFFRES ÉCHUES ----------------------------------------------------------------------------------------------
select cron.schedule('close-expired-job-offers', '15 0 * * *', $cron$update public.job_offers set status = 'closed' where status = 'published' and deadline is not null and deadline < current_date$cron$);
