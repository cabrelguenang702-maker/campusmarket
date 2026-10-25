-- 0059 — Commandes et paiements (cahier des charges §2) : historique des statuts, litiges structurés, reçu, tableau financier vendeur.
-- * Historique : chaque changement de statut d'une commande est journalisé (trigger), lisible des deux parties et du personnel.
-- * Litiges : l'acheteur ne peut plus passer une commande en « litige » sans motif ni description (trigger) ; le vendeur répond une fois ;
--   le support tranche (acheteur / vendeur). Remboursement : CamPay ne rembourse pas, il est donc suivi (« à rembourser » / « remboursé »)
--   et effectué manuellement par un administrateur.
-- * Reçu : numéro, parties, montants, paiement — pour les commandes réglées.
-- * Tableau vendeur : encaissé, en attente, en litige, par mois, meilleurs articles. Aucun versement automatique n'existe encore.

-- 1. HISTORIQUE DES STATUTS --------------------------------------------------------------------------------------------------------------
create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);
create index order_events_actor_idx on public.order_events (actor_id) where actor_id is not null;
alter table public.order_events enable row level security;
create policy mfa_required on public.order_events as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy order_events_select on public.order_events for select to authenticated using (
  (select public.is_staff())
  or exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
);

create or replace function public.tg_orders_log_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (order_id, status, actor_id) values (new.id, new.status::text, auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.tg_orders_log_status() from public, anon, authenticated;
create trigger orders_log_status after insert or update of status on public.orders for each row execute function public.tg_orders_log_status();

insert into public.order_events (order_id, status, created_at) select id, status::text, created_at from public.orders;

-- 2. LITIGES -----------------------------------------------------------------------------------------------------------------------------
create table public.order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  opened_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('not_received', 'not_as_described', 'damaged', 'no_show', 'other')),
  description text not null check (char_length(description) between 10 and 2000),
  evidence_paths text[] not null default '{}' check (cardinality(evidence_paths) <= 5),
  seller_response text check (char_length(seller_response) <= 2000),
  seller_responded_at timestamptz,
  status text not null default 'open' check (status in ('open', 'resolved_buyer', 'resolved_seller')),
  resolution_note text check (char_length(resolution_note) <= 1000),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  refund_status text not null default 'none' check (refund_status in ('none', 'due', 'done')),
  created_at timestamptz not null default now()
);
create index order_disputes_status_idx on public.order_disputes (status, created_at);
create index order_disputes_opened_by_idx on public.order_disputes (opened_by);
create index order_disputes_resolved_by_idx on public.order_disputes (resolved_by) where resolved_by is not null;
alter table public.order_disputes enable row level security;
create policy mfa_required on public.order_disputes as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy order_disputes_select on public.order_disputes for select to authenticated using (
  (select public.is_staff())
  or exists (select 1 from public.orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
);

-- Plus de litige « nu » : la transition vers `disputed` exige une fiche de litige (créée par open_order_dispute).
create or replace function public.tg_orders_protect_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if new.product_id is distinct from old.product_id or new.buyer_id is distinct from old.buyer_id
     or new.seller_id is distinct from old.seller_id or new.quantity is distinct from old.quantity
     or new.unit_price is distinct from old.unit_price or new.service_fee is distinct from old.service_fee
     or new.total_amount is distinct from old.total_amount or new.idempotency_key is distinct from old.idempotency_key
     or new.reservation_id is distinct from old.reservation_id or new.created_at is distinct from old.created_at then
    raise exception 'Seuls le statut et le motif d''annulation d''une commande peuvent être modifiés.';
  end if;

  if new.status is distinct from old.status and not (
       (old.status in ('pending_payment', 'paid') and new.status = 'cancelled')
    or (old.status = 'paid' and new.status in ('confirmed', 'disputed'))
    or (old.status = 'confirmed' and new.status in ('completed', 'disputed'))
  ) then
    raise exception 'Transition de statut de commande invalide : % -> %', old.status, new.status;
  end if;

  if new.status = 'disputed' and old.status is distinct from 'disputed'
     and not exists (select 1 from public.order_disputes d where d.order_id = new.id) then
    raise exception 'Un litige doit être ouvert avec un motif et une description.';
  end if;
  return new;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-evidence', 'dispute-evidence', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.dispute_evidence_readable(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or public.is_staff()
      or exists (
        select 1 from public.order_disputes d join public.orders o on o.id = d.order_id
        where p_name = any (d.evidence_paths) and o.seller_id = auth.uid()
      );
$$;
create policy dispute_evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'dispute-evidence' and (select public.dispute_evidence_readable(name)));
create policy dispute_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dispute-evidence' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy dispute_evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dispute-evidence' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.open_order_dispute(p_order_id uuid, p_reason text, p_description text, p_evidence text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_desc text := btrim(coalesce(p_description, ''));
  v_ev text[] := coalesce(p_evidence, '{}');
  v_id uuid;
  v_name text;
begin
  if v_uid is null or not public.is_active_account() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.buyer_id <> v_uid then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_order.status not in ('paid', 'confirmed') then return jsonb_build_object('success', false, 'error', 'not_disputable'); end if;
  if p_reason not in ('not_received', 'not_as_described', 'damaged', 'no_show', 'other') then return jsonb_build_object('success', false, 'error', 'invalid_reason'); end if;
  if char_length(v_desc) < 10 or char_length(v_desc) > 2000 then return jsonb_build_object('success', false, 'error', 'invalid_description'); end if;
  if cardinality(v_ev) > 5 or exists (select 1 from unnest(v_ev) e where (storage.foldername(e))[1] is distinct from v_uid::text) then
    return jsonb_build_object('success', false, 'error', 'invalid_evidence');
  end if;
  if exists (select 1 from public.order_disputes where order_id = p_order_id) then return jsonb_build_object('success', false, 'error', 'already_disputed'); end if;

  insert into public.order_disputes (order_id, opened_by, reason, description, evidence_paths) values (p_order_id, v_uid, p_reason, v_desc, v_ev) returning id into v_id;
  update public.orders set status = 'disputed' where id = p_order_id;
  select name into v_name from public.products where id = v_order.product_id;
  perform public.create_notification(v_order.seller_id, 'achat', 'dispute_opened', v_uid, 'order', p_order_id,
    jsonb_build_object('name', v_name), 'dsp:' || v_id::text);
  return jsonb_build_object('success', true, 'dispute_id', v_id);
end;
$$;

create or replace function public.respond_order_dispute(p_dispute_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.order_disputes;
  v_order public.orders;
  v_txt text := btrim(coalesce(p_response, ''));
begin
  if auth.uid() is null then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  select * into v_order from public.orders where id = v_d.order_id;
  if v_order.seller_id <> auth.uid() then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_d.status <> 'open' then return jsonb_build_object('success', false, 'error', 'already_resolved'); end if;
  if v_d.seller_responded_at is not null then return jsonb_build_object('success', false, 'error', 'already_responded'); end if;
  if char_length(v_txt) < 10 or char_length(v_txt) > 2000 then return jsonb_build_object('success', false, 'error', 'invalid_response'); end if;
  update public.order_disputes set seller_response = v_txt, seller_responded_at = now() where id = p_dispute_id;
  perform public.create_notification(v_order.buyer_id, 'achat', 'dispute_response', auth.uid(), 'order', v_order.id, '{}'::jsonb, 'dspr:' || p_dispute_id::text);
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_list_disputes(p_status text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.act_as_support() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('success', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'order_id', d.order_id, 'reason', d.reason, 'description', d.description, 'evidence', d.evidence_paths,
      'seller_response', d.seller_response, 'status', d.status, 'resolution_note', d.resolution_note, 'refund_status', d.refund_status,
      'created_at', d.created_at, 'resolved_at', d.resolved_at, 'product', p.name, 'quantity', o.quantity, 'total', o.total_amount,
      'buyer', b.full_name, 'seller', s.full_name) order by d.created_at desc)
    from public.order_disputes d
    join public.orders o on o.id = d.order_id
    left join public.products p on p.id = o.product_id
    left join public.profiles b on b.id = o.buyer_id
    left join public.profiles s on s.id = o.seller_id
    where p_status is null or p_status = 'all' or (p_status = 'open' and d.status = 'open') or (p_status = 'resolved' and d.status <> 'open') or (p_status = 'refund' and d.refund_status = 'due')
  ), '[]'::jsonb));
end;
$$;

create or replace function public.admin_resolve_dispute(p_dispute_id uuid, p_outcome text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.order_disputes;
  v_order public.orders;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_paid boolean;
begin
  if not public.act_as_support() then return public.internal_admin_fail('resolve_dispute', 'order_dispute', p_dispute_id, 'forbidden'); end if;
  if p_outcome not in ('buyer', 'seller') then return public.internal_admin_fail('resolve_dispute', 'order_dispute', p_dispute_id, 'invalid_outcome'); end if;
  if v_note is null or char_length(v_note) < 5 or char_length(v_note) > 1000 then return public.internal_admin_fail('resolve_dispute', 'order_dispute', p_dispute_id, 'note_required'); end if;
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  if not found then return public.internal_admin_fail('resolve_dispute', 'order_dispute', p_dispute_id, 'not_found'); end if;
  if v_d.status <> 'open' then return public.internal_admin_fail('resolve_dispute', 'order_dispute', p_dispute_id, 'already_resolved'); end if;
  select * into v_order from public.orders where id = v_d.order_id for update;
  if v_order.buyer_id = auth.uid() or v_order.seller_id = auth.uid() then return public.internal_admin_fail('resolve_dispute', 'order_dispute', p_dispute_id, 'conflict_of_interest'); end if;

  v_paid := exists (select 1 from public.payments where order_id = v_order.id and status = 'success');
  update public.order_disputes set status = case p_outcome when 'buyer' then 'resolved_buyer' else 'resolved_seller' end, resolution_note = v_note,
    resolved_by = auth.uid(), resolved_at = now(), refund_status = case when p_outcome = 'buyer' and v_paid then 'due' else 'none' end where id = p_dispute_id;
  if p_outcome = 'buyer' then
    update public.orders set status = 'cancelled', cancel_reason = 'dispute_buyer' where id = v_order.id;
  else
    update public.orders set status = 'completed' where id = v_order.id;
  end if;
  perform public.create_notification(v_order.buyer_id, 'achat', 'dispute_resolved', auth.uid(), 'order', v_order.id, jsonb_build_object('outcome', p_outcome, 'for', 'buyer'), 'dsp-res-b:' || p_dispute_id::text);
  perform public.create_notification(v_order.seller_id, 'achat', 'dispute_resolved', auth.uid(), 'order', v_order.id, jsonb_build_object('outcome', p_outcome, 'for', 'seller'), 'dsp-res-s:' || p_dispute_id::text);
  perform public.log_audit('resolve_dispute', 'order_dispute', p_dispute_id, 'success', jsonb_build_object('outcome', p_outcome));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_mark_dispute_refunded(p_dispute_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.order_disputes;
begin
  if not public.act_as_admin() then return public.internal_admin_fail('refund_dispute', 'order_dispute', p_dispute_id, 'forbidden'); end if;
  select * into v_d from public.order_disputes where id = p_dispute_id for update;
  if not found then return public.internal_admin_fail('refund_dispute', 'order_dispute', p_dispute_id, 'not_found'); end if;
  if v_d.refund_status <> 'due' then return public.internal_admin_fail('refund_dispute', 'order_dispute', p_dispute_id, 'no_refund_due'); end if;
  update public.order_disputes set refund_status = 'done' where id = p_dispute_id;
  perform public.log_audit('refund_dispute', 'order_dispute', p_dispute_id, 'success', '{}'::jsonb);
  return jsonb_build_object('success', true);
end;
$$;

-- 3. REÇU --------------------------------------------------------------------------------------------------------------------------------
create or replace function public.order_receipt(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_o public.orders;
  v_paid_at timestamptz;
  v_prod text;
  v_buyer text;
  v_seller text;
begin
  if auth.uid() is null then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select * into v_o from public.orders where id = p_order_id;
  if not found or (v_o.buyer_id <> auth.uid() and v_o.seller_id <> auth.uid()) then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  select max(updated_at) into v_paid_at from public.payments where order_id = p_order_id and status = 'success';
  if v_paid_at is null then return jsonb_build_object('success', false, 'error', 'not_paid'); end if;
  select name into v_prod from public.products where id = v_o.product_id;
  select full_name into v_buyer from public.profiles where id = v_o.buyer_id;
  select full_name into v_seller from public.profiles where id = v_o.seller_id;
  return jsonb_build_object('success', true, 'receipt', jsonb_build_object(
    'number', 'CM-' || to_char(v_o.created_at, 'YYYYMMDD') || '-' || upper(left(v_o.id::text, 6)),
    'order_id', v_o.id, 'ordered_at', v_o.created_at, 'paid_at', v_paid_at, 'product', v_prod, 'quantity', v_o.quantity,
    'unit_price', v_o.unit_price, 'service_fee', v_o.service_fee, 'total', v_o.total_amount, 'currency', 'XAF',
    'buyer', v_buyer, 'seller', v_seller, 'status', v_o.status, 'viewer_is_buyer', v_o.buyer_id = auth.uid()));
end;
$$;

-- 4. TABLEAU FINANCIER VENDEUR -----------------------------------------------------------------------------------------------------------
create or replace function public.seller_finance_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tot jsonb;
  v_monthly jsonb;
  v_top jsonb;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  select jsonb_build_object(
    'completed', coalesce(sum(unit_price * quantity) filter (where status = 'completed'), 0),
    'pending', coalesce(sum(unit_price * quantity) filter (where status in ('paid', 'confirmed')), 0),
    'disputed', coalesce(sum(unit_price * quantity) filter (where status = 'disputed'), 0),
    'last30', coalesce(sum(unit_price * quantity) filter (where status = 'completed' and updated_at > now() - interval '30 days'), 0),
    'orders_total', count(*), 'orders_completed', count(*) filter (where status = 'completed'),
    'orders_pending', count(*) filter (where status in ('paid', 'confirmed')), 'orders_cancelled', count(*) filter (where status = 'cancelled'),
    'orders_disputed', count(*) filter (where status = 'disputed'))
  into v_tot from public.orders where seller_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'amount', coalesce(x.amount, 0)) order by m.month), '[]'::jsonb) into v_monthly
  from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as m(month)
  left join (select date_trunc('month', updated_at) mo, sum(unit_price * quantity) amount from public.orders where seller_id = v_uid and status = 'completed' group by 1) x on x.mo = m.month;

  select coalesce(jsonb_agg(t order by t.amount desc), '[]'::jsonb) into v_top from (
    select p.name as product, sum(o.unit_price * o.quantity) as amount, sum(o.quantity) as units
    from public.orders o left join public.products p on p.id = o.product_id
    where o.seller_id = v_uid and o.status = 'completed' group by p.name order by 2 desc limit 5) t;

  return jsonb_build_object('success', true, 'totals', v_tot, 'monthly', v_monthly, 'top_products', v_top);
end;
$$;

-- 5. DROITS D'EXÉCUTION ------------------------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('open_order_dispute', 'respond_order_dispute', 'admin_list_disputes', 'admin_resolve_dispute', 'admin_mark_dispute_refunded',
                      'order_receipt', 'seller_finance_summary', 'dispute_evidence_readable')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
