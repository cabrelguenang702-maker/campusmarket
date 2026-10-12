-- 0044 — Le certificat n'était jamais délivré
--
-- check_course_completion() (SECURITY DEFINER, search_path = public) appelait gen_random_bytes() sans schéma, alors que
-- pgcrypto est installé dans `extensions` : à la validation du DERNIER module, l'insertion du certificat échouait et
-- faisait échouer l'enregistrement de la progression (la formation ne pouvait donc jamais être terminée).
create or replace function public.check_course_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_total integer;
  v_completed integer;
begin
  select course_id into v_course_id from public.course_modules where id = new.module_id;

  select count(*) into v_total from public.course_modules where course_id = v_course_id;
  select count(*) into v_completed
    from public.module_progress mp
    join public.course_modules m on m.id = mp.module_id
    where m.course_id = v_course_id and mp.user_id = new.user_id;

  if v_total > 0 and v_completed >= v_total then
    insert into public.certificates (course_id, user_id, certificate_code)
    values (v_course_id, new.user_id, encode(extensions.gen_random_bytes(6), 'hex'))
    on conflict (course_id, user_id) do nothing;
  end if;

  return new;
end;
$$;
