create table public.sponsorship_plans (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 3 and 60),
  days smallint not null check (days between 1 and 90),
  price integer not null check (price between 100 and 500000),
  active boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_sponsorship_plans_updated_at before update on public.sponsorship_plans for each row execute function public.set_updated_at();
alter table public.sponsorship_plans enable row level security;
create policy sponsorship_plans_select on public.sponsorship_plans for select to authenticated using (active or public.is_staff());
create policy mfa_required on public.sponsorship_plans as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

insert into public.sponsorship_plans (label, days, price, active, sort_order) values
  ('Mise en avant 3 jours', 3, 500, false, 1),
  ('Mise en avant 7 jours', 7, 1000, false, 2),
  ('Mise en avant 14 jours', 14, 1800, false, 3);

create table public.listing_sponsorships (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.sponsorship_plans (id) on delete set null,
  plan_label text not null,
  days smallint not null,
  amount integer not null check (amount > 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'cancelled')),
  cancel_reason text,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index listing_sponsorships_product_idx on public.listing_sponsorships (product_id, status, ends_at);
create index listing_sponsorships_user_idx on public.listing_sponsorships (user_id, created_at desc);
create unique index listing_sponsorships_one_pending on public.listing_sponsorships (product_id) where status = 'pending_payment';
alter table public.listing_sponsorships enable row level security;
create policy listing_sponsorships_select on public.listing_sponsorships for select to authenticated using (user_id = (select auth.uid()) or public.is_staff());
create policy mfa_required on public.listing_sponsorships as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

alter table public.payments add column if not exists sponsorship_id uuid references public.listing_sponsorships (id);
create unique index if not exists payments_sponsorship_uidx on public.payments (sponsorship_id) where sponsorship_id is not null;
create policy payments_select_sponsorship on public.payments for select to authenticated
  using (exists (select 1 from public.listing_sponsorships s where s.id = payments.sponsorship_id and s.user_id = auth.uid()));

create or replace function public.sponsored_until(p_product uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(ends_at) from public.listing_sponsorships where product_id = p_product and status = 'active' and ends_at > now()
$$;
revoke all on function public.sponsored_until(uuid) from public;
grant execute on function public.sponsored_until(uuid) to anon, authenticated;

create or replace view public.marketplace_listings with (security_invoker = true) as
 SELECT p.id, p.seller_id, p.category_slug, p.name, p.description, p.price, p.old_price, p.quantity, p.reserved_quantity,
    p.quantity - p.reserved_quantity AS available_quantity, p.condition, p.negotiable, p.campus, p.city, p.status, p.views, p.created_at, p.specs,
    COALESCE(ps.favorites_count, 0) AS favorites_count,
    (COALESCE(ps.favorites_count, 0)::numeric + p.views::numeric / 10.0)::numeric(12,1) AS relevance,
    pr.full_name AS seller_name, pr.campus AS seller_campus, pr.city AS seller_city, pr.avatar_url AS seller_avatar_url, pr.verified AS seller_verified,
    pr.created_at AS seller_since, COALESCE(ss.rating_avg, 0::numeric) AS seller_rating, COALESCE(ss.reviews_count, 0) AS seller_reviews,
    COALESCE(ss.sales_count, 0) AS seller_sales, p.expires_at, p.duration_days,
    public.sponsored_until(p.id) AS sponsored_until
   FROM products p
     JOIN profiles pr ON pr.id = p.seller_id
     LEFT JOIN product_stats ps ON ps.product_id = p.id
     LEFT JOIN seller_stats ss ON ss.seller_id = p.seller_id
  WHERE p.deleted_at IS NULL;

create or replace function public.create_sponsorship_pending(p_user uuid, p_product uuid, p_plan uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_p public.products;
  v_plan public.sponsorship_plans;
  v_pending public.listing_sponsorships;
  v_id uuid;
begin
  select * into v_p from public.products where id = p_product and seller_id = p_user and deleted_at is null;
  if not found then return jsonb_build_object('success', false, 'error', 'listing_not_found'); end if;
  if v_p.status <> 'published' or (v_p.expires_at is not null and v_p.expires_at <= now()) or v_p.quantity - v_p.reserved_quantity <= 0 then
    return jsonb_build_object('success', false, 'error', 'listing_not_sponsorable');
  end if;
  select * into v_plan from public.sponsorship_plans where id = p_plan and active;
  if not found then return jsonb_build_object('success', false, 'error', 'plan_unavailable'); end if;

  select * into v_pending from public.listing_sponsorships where product_id = p_product and status = 'pending_payment' for update;
  if found then
    if v_pending.plan_id = p_plan and v_pending.user_id = p_user then
      return jsonb_build_object('success', true, 'sponsorship_id', v_pending.id, 'amount', v_pending.amount);
    end if;
    if exists (select 1 from public.payments pay join public.payment_attempts a on a.payment_id = pay.id where pay.sponsorship_id = v_pending.id) then
      return jsonb_build_object('success', false, 'error', 'pending_other_plan');
    end if;
    update public.listing_sponsorships set status = 'cancelled', cancel_reason = 'Formule remplacée avant paiement' where id = v_pending.id;
  end if;

  insert into public.listing_sponsorships (product_id, user_id, plan_id, plan_label, days, amount)
  values (p_product, p_user, v_plan.id, v_plan.label, v_plan.days, v_plan.price) returning id into v_id;
  return jsonb_build_object('success', true, 'sponsorship_id', v_id, 'amount', v_plan.price);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'pending_exists');
end;
$$;
revoke all on function public.create_sponsorship_pending(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_sponsorship_pending(uuid, uuid, uuid) to service_role;

create or replace function public.admin_save_sponsorship_plan(p_id uuid, p_label text, p_days integer, p_price integer, p_active boolean, p_sort integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid := p_id;
begin
  if not public.act_as_admin() then return public.internal_admin_fail('save_sponsorship_plan', 'sponsorship_plan', p_id, 'forbidden'); end if;
  if char_length(v_label) < 3 or char_length(v_label) > 60 then return public.internal_admin_fail('save_sponsorship_plan', 'sponsorship_plan', p_id, 'invalid_label'); end if;
  if p_days is null or p_days < 1 or p_days > 90 then return public.internal_admin_fail('save_sponsorship_plan', 'sponsorship_plan', p_id, 'invalid_days'); end if;
  if p_price is null or p_price < 100 or p_price > 500000 then return public.internal_admin_fail('save_sponsorship_plan', 'sponsorship_plan', p_id, 'invalid_price'); end if;
  if v_id is null then
    insert into public.sponsorship_plans (label, days, price, active, sort_order) values (v_label, p_days, p_price, coalesce(p_active, false), coalesce(p_sort, 0)) returning id into v_id;
  else
    update public.sponsorship_plans set label = v_label, days = p_days, price = p_price, active = coalesce(p_active, false), sort_order = coalesce(p_sort, 0) where id = v_id;
    if not found then return public.internal_admin_fail('save_sponsorship_plan', 'sponsorship_plan', p_id, 'not_found'); end if;
  end if;
  perform public.log_audit('save_sponsorship_plan', 'sponsorship_plan', v_id, 'success', jsonb_build_object('days', p_days, 'price', p_price, 'active', coalesce(p_active, false)));
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.admin_cancel_sponsorship(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.listing_sponsorships;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.act_as_moderator() then return public.internal_admin_fail('cancel_sponsorship', 'listing_sponsorship', p_id, 'forbidden'); end if;
  if v_reason is null or char_length(v_reason) < 3 then return public.internal_admin_fail('cancel_sponsorship', 'listing_sponsorship', p_id, 'reason_required'); end if;
  select * into v_s from public.listing_sponsorships where id = p_id for update;
  if not found then return public.internal_admin_fail('cancel_sponsorship', 'listing_sponsorship', p_id, 'not_found'); end if;
  if v_s.status = 'cancelled' then return public.internal_admin_fail('cancel_sponsorship', 'listing_sponsorship', p_id, 'already_cancelled'); end if;
  update public.listing_sponsorships set status = 'cancelled', cancel_reason = v_reason where id = p_id;
  perform public.create_notification(v_s.user_id, 'produit', 'sponsorship_cancelled', auth.uid(), 'product', v_s.product_id,
    jsonb_build_object('reason', v_reason, 'paid', v_s.paid_at is not null), 'spc:' || p_id::text);
  perform public.log_audit('cancel_sponsorship', 'listing_sponsorship', p_id, 'success', jsonb_build_object('paid', v_s.paid_at is not null));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_sponsorship_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return jsonb_build_object('success', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('success', true,
    'active_now', (select count(*) from public.listing_sponsorships where status = 'active' and ends_at > now()),
    'pending', (select count(*) from public.listing_sponsorships where status = 'pending_payment'),
    'paid_count', (select count(*) from public.listing_sponsorships where paid_at is not null),
    'revenue_total', coalesce((select sum(amount) from public.listing_sponsorships where paid_at is not null), 0),
    'revenue_30d', coalesce((select sum(amount) from public.listing_sponsorships where paid_at > now() - interval '30 days'), 0));
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('admin_save_sponsorship_plan', 'admin_cancel_sponsorship', 'admin_sponsorship_summary')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;