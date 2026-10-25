-- 0056 — Espaces : un client (propriétaire ou administrateur d'un espace) ne peut plus modifier le type, le créateur ni le nombre de membres.
create or replace function public.protect_space_core_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.kind is distinct from old.kind or new.created_by is distinct from old.created_by or new.member_count is distinct from old.member_count then
      raise exception 'Le type, le créateur et le nombre de membres d''un espace ne se modifient pas';
    end if;
    if coalesce(array_length(new.rules, 1), 0) > 8 then
      raise exception 'Huit règles au maximum';
    end if;
  end if;
  return new;
end;
$$;

create trigger spaces_protect_core before update on public.spaces
  for each row execute function public.protect_space_core_columns();
