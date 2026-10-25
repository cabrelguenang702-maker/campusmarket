-- 0061 — Campus Academy : création et suppression d'un quiz par l'auteur du cours (fonctions contenant des `delete`, appliquées à part).
-- Remplacer les questions d'un quiz sans tentative (save_quiz) et supprimer un quiz sans tentative (delete_quiz). Aucune donnée existante n'est touchée.

create or replace function public.save_quiz(p_course_id uuid, p_quiz_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_quiz_id;
  v_title text := btrim(coalesce(p_data->>'title', ''));
  v_desc text := nullif(btrim(coalesce(p_data->>'description', '')), '');
  v_pass int := coalesce((p_data->>'pass_percent')::int, 60);
  v_max int := nullif(p_data->>'max_attempts', '')::int;
  v_time int := nullif(p_data->>'time_limit_minutes', '')::int;
  v_module uuid := nullif(p_data->>'module_id', '')::uuid;
  v_q jsonb; v_i int := 0; v_opts text[]; v_cor smallint[]; v_has_attempts boolean := false; v_existing public.quizzes;
begin
  if v_uid is null or not public.is_active_account() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  if not public.is_course_author(p_course_id) then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  if char_length(v_title) < 3 or char_length(v_title) > 150 then return jsonb_build_object('success', false, 'error', 'invalid_title'); end if;
  if v_pass < 0 or v_pass > 100 then return jsonb_build_object('success', false, 'error', 'invalid_pass'); end if;
  if v_max is not null and (v_max < 1 or v_max > 50) then return jsonb_build_object('success', false, 'error', 'invalid_attempts'); end if;
  if v_time is not null and (v_time < 1 or v_time > 240) then return jsonb_build_object('success', false, 'error', 'invalid_time'); end if;
  if v_module is not null and not exists (select 1 from public.course_modules where id = v_module and course_id = p_course_id) then return jsonb_build_object('success', false, 'error', 'invalid_module'); end if;

  if v_id is not null then
    select * into v_existing from public.quizzes where id = v_id and course_id = p_course_id for update;
    if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
    v_has_attempts := exists (select 1 from public.quiz_attempts where quiz_id = v_id);
    update public.quizzes set title = v_title, description = v_desc, pass_percent = v_pass, max_attempts = v_max, time_limit_minutes = v_time, module_id = v_module,
      shuffle = coalesce((p_data->>'shuffle')::boolean, true) where id = v_id;
  else
    insert into public.quizzes (course_id, module_id, title, description, pass_percent, max_attempts, time_limit_minutes, shuffle, created_by)
    values (p_course_id, v_module, v_title, v_desc, v_pass, v_max, v_time, coalesce((p_data->>'shuffle')::boolean, true), v_uid) returning id into v_id;
  end if;

  if p_data ? 'questions' then
    if v_has_attempts then return jsonb_build_object('success', false, 'error', 'has_attempts'); end if;
    if jsonb_typeof(p_data->'questions') <> 'array' or jsonb_array_length(p_data->'questions') < 1 or jsonb_array_length(p_data->'questions') > 50 then
      return jsonb_build_object('success', false, 'error', 'invalid_questions');
    end if;
    delete from public.quiz_questions where quiz_id = v_id;
    for v_q in select * from jsonb_array_elements(p_data->'questions') loop
      v_i := v_i + 1;
      select array_agg(btrim(o)) into v_opts from jsonb_array_elements_text(coalesce(v_q->'options', '[]'::jsonb)) o;
      select array_agg(c::smallint) into v_cor from jsonb_array_elements_text(coalesce(v_q->'correct', '[]'::jsonb)) c;
      if char_length(btrim(coalesce(v_q->>'prompt', ''))) < 3 or char_length(btrim(v_q->>'prompt')) > 1000
         or v_opts is null or cardinality(v_opts) not between 2 and 6 or exists (select 1 from unnest(v_opts) o where o = '' or char_length(o) > 300)
         or v_cor is null or exists (select 1 from unnest(v_cor) c where c < 0 or c >= cardinality(v_opts)) or cardinality(v_cor) <> (select count(distinct c) from unnest(v_cor) c) then
        raise exception 'Question % invalide : énoncé (3 à 1 000 caractères), 2 à 6 choix non vides et au moins une bonne réponse valide.', v_i using errcode = 'P0001';
      end if;
      insert into public.quiz_questions (quiz_id, position, prompt, options, correct, explanation)
      values (v_id, v_i, btrim(v_q->>'prompt'), v_opts, v_cor, nullif(btrim(coalesce(v_q->>'explanation', '')), ''));
    end loop;
  end if;
  return jsonb_build_object('success', true, 'quiz_id', v_id);
end;
$$;

create or replace function public.delete_quiz(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q public.quizzes;
begin
  select * into v_q from public.quizzes where id = p_quiz_id for update;
  if not found or not public.is_course_author(v_q.course_id) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if exists (select 1 from public.quiz_attempts where quiz_id = p_quiz_id) then return jsonb_build_object('success', false, 'error', 'has_attempts'); end if;
  delete from public.quizzes where id = p_quiz_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.save_quiz(uuid, uuid, jsonb) from public, anon;
revoke all on function public.delete_quiz(uuid) from public, anon;
grant execute on function public.save_quiz(uuid, uuid, jsonb) to authenticated;
grant execute on function public.delete_quiz(uuid) to authenticated;
