-- 0060 — Campus Academy (cahier des charges §5.4 et §5.6) — la création/suppression par l auteur est dans 0061 : quiz corrigés côté serveur, historique des tentatives, objectifs, badges à règles explicites.
-- Principes :
--  * Les bonnes réponses et explications ne quittent JAMAIS la base avant la remise d'une tentative : `quiz_questions` n'est lisible que de l'auteur
--    du cours et du personnel ; l'étudiant reçoit les questions par `start_quiz_attempt` (sans corrigé) et le corrigé par `submit_quiz_attempt`.
--  * Les écritures passent par des fonctions (save_quiz, set_quiz_status, delete_quiz) : aucune politique d'écriture directe.
--  * Les quiz et badges sont des indicateurs d'apprentissage, pas des qualifications officielles. Les résultats sont strictement privés
--    (aucun partage n'existe).

-- 1. TABLES ------------------------------------------------------------------------------------------------------------------------------
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  module_id uuid references public.course_modules (id) on delete set null,
  title text not null check (char_length(title) between 3 and 150),
  description text check (char_length(description) <= 1000),
  pass_percent smallint not null default 60 check (pass_percent between 0 and 100),
  max_attempts smallint check (max_attempts between 1 and 50),
  time_limit_minutes smallint check (time_limit_minutes between 1 and 240),
  shuffle boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quizzes_course_idx on public.quizzes (course_id, status);
create index quizzes_module_idx on public.quizzes (module_id) where module_id is not null;
create index quizzes_created_by_idx on public.quizzes (created_by) where created_by is not null;
create trigger set_quizzes_updated_at before update on public.quizzes for each row execute function public.set_updated_at();

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  position smallint not null,
  prompt text not null check (char_length(prompt) between 3 and 1000),
  options text[] not null check (cardinality(options) between 2 and 6),
  correct smallint[] not null check (cardinality(correct) >= 1),
  explanation text check (char_length(explanation) <= 1000),
  unique (quiz_id, position)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  question_order uuid[] not null default '{}',
  answers jsonb,
  correct_count smallint,
  total smallint,
  score_percent smallint check (score_percent between 0 and 100),
  passed boolean,
  timed_out boolean not null default false
);
create index quiz_attempts_user_idx on public.quiz_attempts (user_id, started_at desc);
create index quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id, user_id);
create unique index quiz_attempts_one_open on public.quiz_attempts (quiz_id, user_id) where submitted_at is null;

create table public.learning_goals (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  weekly_lessons smallint not null default 3 check (weekly_lessons between 0 and 50),
  weekly_quizzes smallint not null default 1 check (weekly_quizzes between 0 and 50),
  updated_at timestamptz not null default now()
);
create trigger set_learning_goals_updated_at before update on public.learning_goals for each row execute function public.set_updated_at();

create table public.badge_definitions (
  code text primary key,
  title text not null,
  description text not null,
  rule_text text not null,
  sort_order smallint not null default 0
);
create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_code text not null references public.badge_definitions (code) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);
create index user_badges_code_idx on public.user_badges (badge_code);

insert into public.badge_definitions (code, title, description, rule_text, sort_order) values
  ('first_lesson', 'Premier pas', 'Vous avez terminé votre première leçon.', 'Terminer 1 leçon (module marqué comme terminé).', 1),
  ('lessons_10', 'Régulier', 'Dix leçons terminées.', 'Terminer 10 leçons au total.', 2),
  ('first_quiz_passed', 'Quiz réussi', 'Vous avez réussi un premier quiz.', 'Atteindre ou dépasser le seuil de réussite d''un quiz.', 3),
  ('quizzes_5_passed', 'Entraînement soutenu', 'Cinq quiz différents réussis.', 'Réussir 5 quiz différents.', 4),
  ('perfect_score', 'Sans faute', 'Un quiz réussi à 100 %.', 'Obtenir 100 % à un quiz d''au moins 3 questions.', 5),
  ('course_completed', 'Formation terminée', 'Vous avez terminé une formation entière.', 'Terminer tous les modules d''une formation (certificat délivré).', 6),
  ('streak_7', 'Sept jours de suite', 'Une activité d''apprentissage sept jours consécutifs.', 'Terminer une leçon ou rendre un quiz 7 jours consécutifs (fuseau de Douala).', 7);

-- 2. DROITS ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.is_course_author(p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.courses c where c.id = p_course_id and c.instructor_id = auth.uid()) or public.is_admin();
$$;

create or replace function public.can_take_course_quiz(p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_course_author(p_course_id)
      or exists (select 1 from public.course_enrollments e where e.course_id = p_course_id and e.user_id = auth.uid() and e.status = 'active');
$$;

alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.learning_goals enable row level security;
alter table public.badge_definitions enable row level security;
alter table public.user_badges enable row level security;

create policy mfa_required on public.quizzes as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.quiz_questions as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.quiz_attempts as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.learning_goals as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_required on public.user_badges as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

create policy quizzes_select on public.quizzes for select to authenticated using (
  (status = 'published' and (select public.can_take_course_quiz(course_id))) or (select public.is_course_author(course_id))
);
create policy quiz_questions_author on public.quiz_questions for select to authenticated using (
  exists (select 1 from public.quizzes q where q.id = quiz_id and (select public.is_course_author(q.course_id)))
);
create policy quiz_attempts_own on public.quiz_attempts for select to authenticated using (user_id = (select auth.uid()));
create policy learning_goals_own on public.learning_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select public.is_active_account()));
create policy badge_definitions_read on public.badge_definitions for select to authenticated using (true);
create policy user_badges_own on public.user_badges for select to authenticated using (user_id = (select auth.uid()));

-- 3. BADGES ------------------------------------------------------------------------------------------------------------------------------
create or replace function public.award_badges(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lessons int; v_passed int; v_perfect boolean; v_certs int; v_streak boolean; v_code text; v_title text;
begin
  select count(*) into v_lessons from public.module_progress where user_id = p_user;
  select count(distinct quiz_id) into v_passed from public.quiz_attempts where user_id = p_user and passed;
  select exists (select 1 from public.quiz_attempts where user_id = p_user and score_percent = 100 and total >= 3 and passed) into v_perfect;
  select count(*) into v_certs from public.certificates where user_id = p_user;
  select coalesce(max(run), 0) >= 7 into v_streak from (
    select count(*) as run from (
      select d, d - (row_number() over (order by d))::int as grp from (
        select (completed_at at time zone 'Africa/Douala')::date as d from public.module_progress where user_id = p_user
        union
        select (submitted_at at time zone 'Africa/Douala')::date from public.quiz_attempts where user_id = p_user and submitted_at is not null
      ) days
    ) g group by grp
  ) runs;

  for v_code in
    select c from (values
      ('first_lesson', v_lessons >= 1), ('lessons_10', v_lessons >= 10), ('first_quiz_passed', v_passed >= 1), ('quizzes_5_passed', v_passed >= 5),
      ('perfect_score', v_perfect), ('course_completed', v_certs >= 1), ('streak_7', v_streak)
    ) as t(c, ok) where ok
  loop
    if not exists (select 1 from public.user_badges where user_id = p_user and badge_code = v_code) then
      insert into public.user_badges (user_id, badge_code) values (p_user, v_code) on conflict do nothing;
      select title into v_title from public.badge_definitions where code = v_code;
      perform public.create_notification(p_user, 'formation', 'badge_earned', null, 'badge', null, jsonb_build_object('title', v_title), 'badge:' || p_user::text || ':' || v_code);
    end if;
  end loop;
end;
$$;

create or replace function public.tg_award_badges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_badges(new.user_id);
  return null;
end;
$$;
create trigger module_progress_award_badges after insert on public.module_progress for each row execute function public.tg_award_badges();
create trigger certificates_award_badges after insert on public.certificates for each row execute function public.tg_award_badges();

create or replace function public.set_quiz_status(p_quiz_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q public.quizzes;
begin
  if p_status not in ('draft', 'published') then return jsonb_build_object('success', false, 'error', 'invalid_status'); end if;
  select * into v_q from public.quizzes where id = p_quiz_id for update;
  if not found or not public.is_course_author(v_q.course_id) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if p_status = 'published' and not exists (select 1 from public.quiz_questions where quiz_id = p_quiz_id) then return jsonb_build_object('success', false, 'error', 'no_questions'); end if;
  update public.quizzes set status = p_status where id = p_quiz_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.load_quiz_for_edit(p_quiz_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q public.quizzes;
begin
  select * into v_q from public.quizzes where id = p_quiz_id;
  if not found or not public.is_course_author(v_q.course_id) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  return jsonb_build_object('success', true, 'quiz', to_jsonb(v_q), 'has_attempts', exists (select 1 from public.quiz_attempts where quiz_id = p_quiz_id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('prompt', prompt, 'options', to_jsonb(options), 'correct', to_jsonb(correct), 'explanation', explanation) order by position)
      from public.quiz_questions where quiz_id = p_quiz_id), '[]'::jsonb));
end;
$$;

create or replace function public.quiz_stats(p_quiz_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q public.quizzes;
begin
  select * into v_q from public.quizzes where id = p_quiz_id;
  if not found or not public.is_course_author(v_q.course_id) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  return jsonb_build_object('success', true,
    'attempts', (select count(*) from public.quiz_attempts where quiz_id = p_quiz_id and submitted_at is not null),
    'learners', (select count(distinct user_id) from public.quiz_attempts where quiz_id = p_quiz_id and submitted_at is not null),
    'avg_score', (select round(avg(score_percent)) from public.quiz_attempts where quiz_id = p_quiz_id and submitted_at is not null),
    'pass_rate', (select round(100.0 * count(*) filter (where passed) / nullif(count(*), 0)) from public.quiz_attempts where quiz_id = p_quiz_id and submitted_at is not null));
end;
$$;

-- 5. ÉTUDIANT : PASSER UN QUIZ -----------------------------------------------------------------------------------------------------------
create or replace function public.grade_quiz_attempt(p_attempt public.quiz_attempts, p_answers jsonb, p_timed_out boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_quiz public.quizzes;
  v_qs record; v_sel smallint[]; v_review jsonb := '[]'::jsonb; v_ok int := 0; v_total int := 0; v_score int; v_pass boolean; v_is boolean;
begin
  select * into v_quiz from public.quizzes where id = p_attempt.quiz_id;
  for v_qs in select * from public.quiz_questions where quiz_id = p_attempt.quiz_id order by position loop
    v_total := v_total + 1;
    select coalesce(array_agg(distinct x::smallint order by x::smallint), '{}') into v_sel
      from jsonb_array_elements_text(coalesce(p_answers->(v_qs.id::text), '[]'::jsonb)) x where x ~ '^[0-9]{1,3}$' and (case when x ~ '^[0-9]{1,3}$' then x::int end) < cardinality(v_qs.options);
    v_is := v_sel = (select array_agg(distinct c order by c) from unnest(v_qs.correct) c);
    if v_is then v_ok := v_ok + 1; end if;
    v_review := v_review || jsonb_build_object('question_id', v_qs.id, 'prompt', v_qs.prompt, 'options', to_jsonb(v_qs.options), 'selected', to_jsonb(v_sel),
      'correct', to_jsonb(v_qs.correct), 'explanation', v_qs.explanation, 'is_correct', v_is);
  end loop;
  v_score := case when v_total = 0 then 0 else round(100.0 * v_ok / v_total)::int end;
  v_pass := (v_score >= v_quiz.pass_percent) and not p_timed_out;
  update public.quiz_attempts set submitted_at = now(), answers = p_answers, correct_count = v_ok, total = v_total, score_percent = v_score, passed = v_pass, timed_out = p_timed_out where id = p_attempt.id;
  perform public.award_badges(p_attempt.user_id);
  return jsonb_build_object('score', v_score, 'passed', v_pass, 'correct_count', v_ok, 'total', v_total, 'timed_out', p_timed_out, 'pass_percent', v_quiz.pass_percent, 'review', v_review);
end;
$$;

create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.quizzes;
  v_open public.quiz_attempts;
  v_used int;
  v_id uuid;
  v_order uuid[];
begin
  if v_uid is null or not public.is_active_account() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_quiz from public.quizzes where id = p_quiz_id;
  if not found or v_quiz.status <> 'published' or not public.can_take_course_quiz(v_quiz.course_id) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;

  select * into v_open from public.quiz_attempts where quiz_id = p_quiz_id and user_id = v_uid and submitted_at is null for update;
  if found then
    if v_quiz.time_limit_minutes is not null and now() > v_open.started_at + make_interval(mins => v_quiz.time_limit_minutes) + interval '60 seconds' then
      perform public.grade_quiz_attempt(v_open, '{}'::jsonb, true);   -- tentative abandonnée hors délai : notée à zéro
    else
      v_id := v_open.id; v_order := v_open.question_order;
    end if;
  end if;

  if v_id is null then
    select count(*) into v_used from public.quiz_attempts where quiz_id = p_quiz_id and user_id = v_uid;
    if v_quiz.max_attempts is not null and v_used >= v_quiz.max_attempts then return jsonb_build_object('success', false, 'error', 'no_attempts_left'); end if;
    select array_agg(id order by case when v_quiz.shuffle then random() end, position) into v_order from public.quiz_questions where quiz_id = p_quiz_id;
    if v_order is null then return jsonb_build_object('success', false, 'error', 'no_questions'); end if;
    insert into public.quiz_attempts (quiz_id, user_id, question_order) values (p_quiz_id, v_uid, v_order) returning id into v_id;
  end if;

  return jsonb_build_object('success', true, 'attempt_id', v_id, 'time_limit_minutes', v_quiz.time_limit_minutes,
    'started_at', (select started_at from public.quiz_attempts where id = v_id), 'title', v_quiz.title, 'pass_percent', v_quiz.pass_percent,
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', to_jsonb(q.options), 'multiple', cardinality(q.correct) > 1) order by array_position(v_order, q.id))
                  from public.quiz_questions q where q.quiz_id = p_quiz_id));
end;
$$;

create or replace function public.submit_quiz_attempt(p_attempt_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a public.quiz_attempts;
  v_quiz public.quizzes;
  v_late boolean;
  v_res jsonb;
begin
  select * into v_a from public.quiz_attempts where id = p_attempt_id for update;
  if not found or v_a.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_a.submitted_at is not null then return jsonb_build_object('success', false, 'error', 'already_submitted'); end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then return jsonb_build_object('success', false, 'error', 'invalid_answers'); end if;
  select * into v_quiz from public.quizzes where id = v_a.quiz_id;
  v_late := v_quiz.time_limit_minutes is not null and now() > v_a.started_at + make_interval(mins => v_quiz.time_limit_minutes) + interval '60 seconds';
  v_res := public.grade_quiz_attempt(v_a, coalesce(p_answers, '{}'::jsonb), v_late);
  return jsonb_build_object('success', true) || v_res;
end;
$$;

-- 6. TABLEAU DE PROGRESSION --------------------------------------------------------------------------------------------------------------
create or replace function public.my_learning_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_week date := (date_trunc('week', now() at time zone 'Africa/Douala'))::date;
  v_goal public.learning_goals;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_goal from public.learning_goals where user_id = v_uid;
  return jsonb_build_object('success', true,
    'lessons_completed', (select count(*) from public.module_progress where user_id = v_uid),
    'quizzes_attempted', (select count(*) from public.quiz_attempts where user_id = v_uid and submitted_at is not null),
    'quizzes_passed', (select count(distinct quiz_id) from public.quiz_attempts where user_id = v_uid and passed),
    'avg_score', (select round(avg(score_percent)) from public.quiz_attempts where user_id = v_uid and submitted_at is not null),
    'week_lessons', (select count(*) from public.module_progress where user_id = v_uid and (completed_at at time zone 'Africa/Douala')::date >= v_week),
    'week_quizzes', (select count(*) from public.quiz_attempts where user_id = v_uid and submitted_at is not null and (submitted_at at time zone 'Africa/Douala')::date >= v_week),
    'goal_lessons', coalesce(v_goal.weekly_lessons, 3), 'goal_quizzes', coalesce(v_goal.weekly_quizzes, 1),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('course_id', c.id, 'title', c.title,
        'total', (select count(*) from public.course_modules m where m.course_id = c.id),
        'done', (select count(*) from public.module_progress mp join public.course_modules m on m.id = mp.module_id where m.course_id = c.id and mp.user_id = v_uid),
        'last_activity', (select max(mp.completed_at) from public.module_progress mp join public.course_modules m on m.id = mp.module_id where m.course_id = c.id and mp.user_id = v_uid))
        order by c.title) from public.course_enrollments e join public.courses c on c.id = e.course_id where e.user_id = v_uid and e.status = 'active'), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('slug', cc.slug, 'name', cc.name, 'attempts', x.n, 'avg_score', x.avg_score) order by cc.name)
        from (select c.category_slug as slug, count(*) as n, round(avg(a.score_percent)) as avg_score
              from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id join public.courses c on c.id = q.course_id
              where a.user_id = v_uid and a.submitted_at is not null group by c.category_slug) x join public.course_categories cc on cc.slug = x.slug), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('day', g.d, 'count', coalesce(a.n, 0)) order by g.d)
        from (select s.t::date as d from generate_series(((now() at time zone 'Africa/Douala')::date - 13)::timestamp, (now() at time zone 'Africa/Douala')::date::timestamp, interval '1 day') as s(t)) g
        left join (select d, count(*) n from (
          select (completed_at at time zone 'Africa/Douala')::date d from public.module_progress where user_id = v_uid
          union all select (submitted_at at time zone 'Africa/Douala')::date from public.quiz_attempts where user_id = v_uid and submitted_at is not null) u group by d) a on a.d = g.d), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'title', b.title, 'description', b.description, 'rule', b.rule_text, 'awarded_at', ub.awarded_at) order by b.sort_order)
        from public.badge_definitions b left join public.user_badges ub on ub.badge_code = b.code and ub.user_id = v_uid), '[]'::jsonb));
end;
$$;

-- 7. DROITS D'EXÉCUTION ------------------------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('is_course_author', 'can_take_course_quiz', 'award_badges', 'tg_award_badges', 'set_quiz_status', 'load_quiz_for_edit',
                      'quiz_stats', 'grade_quiz_attempt', 'start_quiz_attempt', 'submit_quiz_attempt', 'my_learning_summary')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname not in ('award_badges', 'tg_award_badges', 'grade_quiz_attempt') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
