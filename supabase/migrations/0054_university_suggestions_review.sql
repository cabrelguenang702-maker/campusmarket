-- 0054 — Universités : traitement des suggestions et écriture des catalogues sous double authentification
--
--   * Les étudiants peuvent suggérer une université (university_suggestions) et le tableau de bord signale celles en
--     attente, mais AUCUNE règle ne permettait de les traiter : le personnel pouvait les lire sans pouvoir les approuver ni
--     les refuser. admin_review_university_suggestion comble ce manque : administrateur uniquement (comme l'écriture sur
--     `universities`), motif de refus facultatif, création de l'université à l'approbation (le sigle, obligatoire et unique
--     par pays, est saisi par l'admin car la suggestion n'en porte pas), notification de la personne, journal d'audit.
--   * countries et universities sont des catalogues publics, exclus du verrou « double authentification » de 0039 : un
--     administrateur dont le compte est protégé par double authentification pouvait les modifier avec une session simple.
--     Les écritures (pas les lectures) exigent désormais mfa_ok(), comme le reste de l'administration.

drop policy if exists countries_write_mfa_insert on public.countries;
drop policy if exists countries_write_mfa_update on public.countries;
drop policy if exists countries_write_mfa_delete on public.countries;
create policy countries_write_mfa_insert on public.countries as restrictive for insert to authenticated with check ((select public.mfa_ok()));
create policy countries_write_mfa_update on public.countries as restrictive for update to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy countries_write_mfa_delete on public.countries as restrictive for delete to authenticated using ((select public.mfa_ok()));

drop policy if exists universities_write_mfa_insert on public.universities;
drop policy if exists universities_write_mfa_update on public.universities;
drop policy if exists universities_write_mfa_delete on public.universities;
create policy universities_write_mfa_insert on public.universities as restrictive for insert to authenticated with check ((select public.mfa_ok()));
create policy universities_write_mfa_update on public.universities as restrictive for update to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy universities_write_mfa_delete on public.universities as restrictive for delete to authenticated using ((select public.mfa_ok()));

create or replace function public.admin_review_university_suggestion(
  p_suggestion_id uuid, p_approve boolean, p_short_name text default null, p_student_count integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.university_suggestions;
  v_short text := nullif(trim(coalesce(p_short_name, '')), '');
  v_uni uuid;
begin
  if not public.act_as_admin() then
    return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'forbidden');
  end if;
  if not public.mfa_ok() then
    return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'mfa_required');
  end if;
  select * into s from public.university_suggestions where id = p_suggestion_id for update;
  if not found then
    return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'not_found');
  end if;
  if s.status <> 'pending' then
    return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'already_reviewed');
  end if;

  if p_approve then
    if v_short is null or char_length(v_short) < 2 or char_length(v_short) > 20 then
      return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'short_name_required');
    end if;
    if p_student_count is not null and p_student_count < 0 then
      return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'invalid_student_count');
    end if;
    if exists (select 1 from public.universities where country_code = s.country_code
                and (lower(short_name) = lower(v_short) or lower(name) = lower(s.name))) then
      return public.internal_admin_fail('review_university_suggestion', 'university_suggestion', p_suggestion_id, 'duplicate');
    end if;
    insert into public.universities (name, short_name, city, country_code, student_count)
    values (s.name, v_short, s.city, s.country_code, p_student_count)
    returning id into v_uni;
    update public.university_suggestions set status = 'approved', handled_by = auth.uid(), resulting_university_id = v_uni where id = s.id;
    perform public.create_notification(s.suggested_by, 'systeme', 'university_suggestion_approved', null, 'university', v_uni,
      jsonb_build_object('name', s.name), 'us:ok:' || s.id);
  else
    update public.university_suggestions set status = 'rejected', handled_by = auth.uid() where id = s.id;
    perform public.create_notification(s.suggested_by, 'systeme', 'university_suggestion_rejected', null, 'university_suggestion', s.id,
      jsonb_build_object('name', s.name), 'us:ko:' || s.id);
  end if;

  perform public.log_audit('review_university_suggestion', 'university_suggestion', s.id, 'success',
    jsonb_build_object('to', case when p_approve then 'approved' else 'rejected' end, 'university_id', v_uni));
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_review_university_suggestion(uuid, boolean, text, integer) from public, anon;
grant execute on function public.admin_review_university_suggestion(uuid, boolean, text, integer) to authenticated;
