-- 0022 — Fonctionnalités présentes dans le front mais absentes du backend :
-- caractéristiques d'annonce, favoris, compteurs, avis vendeur, demandes « Je recherche ».
-- Principe : aucune colonne de compteur n'est inscriptible par l'utilisateur (tables séparées + triggers
-- SECURITY DEFINER), sur le modèle de profiles_protect_trust.

-- 1. Caractéristiques techniques d'une annonce : liste de paires [libellé, valeur].
alter table public.products
  add column specs jsonb not null default '[]'::jsonb,
  add constraint products_specs_shape
    check (jsonb_typeof(specs) = 'array' and jsonb_array_length(specs) <= 12);

-- 2. Compteurs publics par annonce (favoris, vues). Écrits uniquement par triggers / fonction.
create table public.product_stats (
  product_id uuid primary key references public.products(id) on delete cascade,
  favorites_count integer not null default 0 check (favorites_count >= 0),
  views_count integer not null default 0 check (views_count >= 0)
);
alter table public.product_stats enable row level security;
create policy product_stats_select_public on public.product_stats
  for select to anon, authenticated using (true);

-- 3. Favoris
create table public.product_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index product_favorites_product_idx on public.product_favorites (product_id);
alter table public.product_favorites enable row level security;
create policy product_favorites_select_own on public.product_favorites
  for select to authenticated using (user_id = (select auth.uid()));
create policy product_favorites_insert_own on public.product_favorites
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_account()
    and exists (
      select 1 from public.products p
      where p.id = product_favorites.product_id and p.status = 'published' and p.deleted_at is null
    )
  );
create policy product_favorites_delete_own on public.product_favorites
  for delete to authenticated using (user_id = (select auth.uid()));

create function public.tg_product_favorites_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.product_stats (product_id, favorites_count) values (new.product_id, 1)
    on conflict (product_id) do update set favorites_count = public.product_stats.favorites_count + 1;
  else
    update public.product_stats set favorites_count = greatest(favorites_count - 1, 0)
    where product_id = old.product_id;
  end if;
  return null;
end $$;
revoke all on function public.tg_product_favorites_count() from public, anon, authenticated;
create trigger product_favorites_count after insert or delete on public.product_favorites
  for each row execute function public.tg_product_favorites_count();

-- 4. Compteur de vues : une vue comptée par appel d'un utilisateur connecté qui n'est pas le vendeur.
create function public.increment_product_views(p_product_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.product_stats (product_id, views_count)
  select p.id, 1 from public.products p
  where p.id = p_product_id and p.status = 'published' and p.deleted_at is null
    and p.seller_id <> (select auth.uid())
  on conflict (product_id) do update set views_count = public.product_stats.views_count + 1;
$$;
revoke all on function public.increment_product_views(uuid) from public, anon;
grant execute on function public.increment_product_views(uuid) to authenticated;

-- 5. Avis sur un vendeur : uniquement par l'acheteur d'une commande terminée, un avis par commande.
create table public.seller_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  check (seller_id <> reviewer_id)
);
create index seller_reviews_seller_idx on public.seller_reviews (seller_id, created_at desc);
create index seller_reviews_reviewer_idx on public.seller_reviews (reviewer_id);
alter table public.seller_reviews enable row level security;
create policy seller_reviews_select_public on public.seller_reviews
  for select to anon, authenticated using (true);
create policy seller_reviews_insert_buyer on public.seller_reviews
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and public.is_active_account()
    and exists (
      select 1 from public.orders o
      where o.id = seller_reviews.order_id
        and o.buyer_id = (select auth.uid())
        and o.seller_id = seller_reviews.seller_id
        and o.status = 'completed'
    )
  );
create trigger seller_reviews_rate_limit before insert on public.seller_reviews
  for each row execute function public.enforce_rate_limit('reviewer_id', '20', '86400');

-- 6. Statistiques vendeur (note, nombre d'avis, ventes) : lecture publique, écriture par triggers uniquement.
create table public.seller_stats (
  seller_id uuid primary key references public.profiles(id) on delete cascade,
  rating_avg numeric(3,2) not null default 0,
  reviews_count integer not null default 0,
  sales_count integer not null default 0
);
alter table public.seller_stats enable row level security;
create policy seller_stats_select_public on public.seller_stats
  for select to anon, authenticated using (true);

create function public.tg_seller_reviews_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_seller uuid := case when tg_op = 'DELETE' then old.seller_id else new.seller_id end;
begin
  insert into public.seller_stats (seller_id, rating_avg, reviews_count)
  select v_seller, coalesce(round(avg(rating)::numeric, 2), 0), count(*)
  from public.seller_reviews where seller_id = v_seller
  on conflict (seller_id) do update
    set rating_avg = excluded.rating_avg, reviews_count = excluded.reviews_count;
  return null;
end $$;
revoke all on function public.tg_seller_reviews_stats() from public, anon, authenticated;
create trigger seller_reviews_stats after insert or delete on public.seller_reviews
  for each row execute function public.tg_seller_reviews_stats();

create function public.tg_orders_sales_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.seller_stats (seller_id, sales_count) values (new.seller_id, 1)
    on conflict (seller_id) do update set sales_count = public.seller_stats.sales_count + 1;
  end if;
  return null;
end $$;
revoke all on function public.tg_orders_sales_stats() from public, anon, authenticated;
create trigger orders_sales_stats after update of status on public.orders
  for each row execute function public.tg_orders_sales_stats();

-- 7. « Je recherche » : demandes d'achat et réponses des vendeurs.
create type public.wanted_status as enum ('open', 'fulfilled', 'closed');

create table public.wanted_requests (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  budget integer not null check (budget > 0),
  category_slug text not null references public.categories(slug),
  campus text not null,
  city text not null,
  status public.wanted_status not null default 'open',
  responses_count integer not null default 0 check (responses_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wanted_requests_author_idx on public.wanted_requests (author_id);
create index wanted_requests_category_idx on public.wanted_requests (category_slug);
create index wanted_requests_created_idx on public.wanted_requests (created_at desc);
create trigger set_wanted_requests_updated_at before update on public.wanted_requests
  for each row execute function public.set_updated_at();
create trigger wanted_requests_rate_limit before insert on public.wanted_requests
  for each row execute function public.enforce_rate_limit('author_id', '10', '86400');
alter table public.wanted_requests enable row level security;

-- Seuls ces champs sont modifiables par l'auteur ; responses_count reste réservé au trigger.
revoke update on public.wanted_requests from anon, authenticated;
grant update (title, description, budget, category_slug, status) on public.wanted_requests to authenticated;

create policy wanted_requests_select_authenticated on public.wanted_requests
  for select to authenticated using (true);
create policy wanted_requests_insert_own on public.wanted_requests
  for insert to authenticated
  with check (
    author_id = (select auth.uid()) and public.is_active_account()
    and status = 'open' and responses_count = 0
  );
create policy wanted_requests_update_own on public.wanted_requests
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy wanted_requests_delete_own on public.wanted_requests
  for delete to authenticated using (author_id = (select auth.uid()));
create policy wanted_requests_staff_delete on public.wanted_requests
  for delete to authenticated using (public.is_staff());

create table public.wanted_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.wanted_requests(id) on delete cascade,
  responder_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  message text not null check (char_length(message) between 2 and 1000),
  created_at timestamptz not null default now(),
  unique (request_id, responder_id)
);
create index wanted_responses_responder_idx on public.wanted_responses (responder_id);
create index wanted_responses_product_idx on public.wanted_responses (product_id);
create trigger wanted_responses_rate_limit before insert on public.wanted_responses
  for each row execute function public.enforce_rate_limit('responder_id', '30', '86400');
alter table public.wanted_responses enable row level security;

create policy wanted_responses_select_involved on public.wanted_responses
  for select to authenticated
  using (
    responder_id = (select auth.uid())
    or public.is_staff()
    or exists (
      select 1 from public.wanted_requests r
      where r.id = wanted_responses.request_id and r.author_id = (select auth.uid())
    )
  );
create policy wanted_responses_insert_own on public.wanted_responses
  for insert to authenticated
  with check (
    responder_id = (select auth.uid())
    and public.is_active_account()
    and exists (
      select 1 from public.wanted_requests r
      where r.id = wanted_responses.request_id and r.status = 'open'
        and r.author_id <> (select auth.uid())
    )
    and (
      product_id is null
      or exists (
        select 1 from public.products p
        where p.id = wanted_responses.product_id and p.seller_id = (select auth.uid())
      )
    )
  );
create policy wanted_responses_delete_own on public.wanted_responses
  for delete to authenticated using (responder_id = (select auth.uid()));

create function public.tg_wanted_responses_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.wanted_requests set responses_count = responses_count + 1 where id = new.request_id;
  else
    update public.wanted_requests set responses_count = greatest(responses_count - 1, 0) where id = old.request_id;
  end if;
  return null;
end $$;
revoke all on function public.tg_wanted_responses_count() from public, anon, authenticated;
create trigger wanted_responses_count after insert or delete on public.wanted_responses
  for each row execute function public.tg_wanted_responses_count();
