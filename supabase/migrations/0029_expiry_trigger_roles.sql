-- 0029 — Le trigger d'expiration (0028) figeait expires_at pour tout le monde, y compris le staff et les fonctions
-- d'administration. On ne protège que les rôles clients (authenticated, anon) ; postgres et service_role, et donc
-- les fonctions SECURITY DEFINER d'admin, peuvent ajuster l'échéance (prolongation exceptionnelle, correction).
create or replace function public.tg_products_expiry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then new.expires_at := null; end if;
    return new;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    new.expires_at := now() + make_interval(days => new.duration_days);
  elsif current_user in ('authenticated', 'anon') then
    new.expires_at := old.expires_at;
    if old.status = 'published' then new.duration_days := old.duration_days; end if;
  end if;
  return new;
end $$;
