
-- Liste des versements pour l'écran admin (nécessaire pour pouvoir en annuler un).
create or replace function public.admin_list_payouts(
  p_creator uuid default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_finance() then
    return jsonb_build_object('success', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object(
    'success', true,
    'total', (select count(*) from public.creator_payouts where p_creator is null or creator_id = p_creator),
    'payouts', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select p.id, p.creator_id, pr.full_name as creator_name, p.amount, p.provider, p.phone, p.holder_name,
               p.reference, p.note, p.created_at, p.voided_at, p.void_reason
          from public.creator_payouts p left join public.profiles pr on pr.id = p.creator_id
         where p_creator is null or p.creator_id = p_creator
         order by p.created_at desc, p.id limit v_limit offset v_offset) r), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_list_payouts(uuid, integer, integer) from public, anon;
grant execute on function public.admin_list_payouts(uuid, integer, integer) to authenticated;
