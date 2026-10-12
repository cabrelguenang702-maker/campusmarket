-- =============================================================================
-- 0013 — Academy / formations. Réf. Backend_Hardened section 19 : catalogue,
-- modules, médias privés (URLs temporaires), inscriptions, progression
-- idempotente, certificat généré seulement si les critères sont satisfaits,
-- contrôle d'accès à chaque module côté serveur, autorisation par statut
-- d'inscription ET paiement pour les formations payantes.
--
-- Le contrôle d'accès par module est fait en séparant MÉTADONNÉES (visibles à
-- quiconque peut voir le cours — titre, durée, position, aperçu ou non) et
-- CONTENU (media_path/article_content — visible seulement si aperçu, inscrit
-- actif, staff ou instructeur) dans deux tables distinctes : Postgres RLS
-- filtre des LIGNES, jamais des colonnes à l'intérieur d'une même ligne.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CATALOGUE
-- -----------------------------------------------------------------------------
create table public.course_categories (
  slug text primary key,
  name text not null,
  sort_order integer not null default 0
);

alter table public.course_categories enable row level security;

create policy "course_categories_select_public"
  on public.course_categories for select
  to authenticated, anon
  using (true);

create policy "course_categories_admin_write"
  on public.course_categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create type public.course_level as enum ('debutant', 'intermediaire', 'avance');
create type public.course_status as enum ('draft', 'pending_review', 'published', 'archived');

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  category_slug text not null references public.course_categories (slug),
  title text not null check (char_length(title) between 3 and 150),
  tagline text check (tagline is null or char_length(tagline) <= 200),
  description text not null check (char_length(description) <= 4000),
  level public.course_level not null,
  -- L'instructeur n'est pas nécessairement un compte de la plateforme (contenu
  -- pouvant être curaté par le staff) : instructor_id est optionnel, les
  -- champs texte sont toujours renseignés pour l'affichage.
  instructor_id uuid references public.profiles (id),
  instructor_name text not null check (char_length(instructor_name) between 2 and 120),
  instructor_role text,
  instructor_bio text check (instructor_bio is null or char_length(instructor_bio) <= 1000),
  price integer not null default 0 check (price >= 0), -- 0 = gratuit
  status public.course_status not null default 'draft',
  -- Caches d'affichage recalculés par trigger (comme reserved_quantity/last_message_preview
  -- ailleurs) : jamais renseignés directement par un client.
  rating_avg numeric(2, 1) not null default 0,
  reviews_count integer not null default 0,
  enrolled_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index courses_status_idx on public.courses (status);
create index courses_category_idx on public.courses (category_slug, status);
create index courses_instructor_idx on public.courses (instructor_id);

create trigger set_courses_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

alter table public.courses enable row level security;

-- Même schéma d'accès que products (0004) : vitrine publique sur le publié,
-- l'auteur voit ses brouillons, le staff voit tout, seul le staff publie
-- (modération de contenu pédagogique avant mise en ligne).
create policy "courses_select_published"
  on public.courses for select
  to authenticated, anon
  using (status = 'published');

create policy "courses_select_own"
  on public.courses for select
  to authenticated
  using (instructor_id = auth.uid());

create policy "courses_staff_select"
  on public.courses for select
  to authenticated
  using (public.is_staff());

create policy "courses_insert_own"
  on public.courses for insert
  to authenticated
  with check (instructor_id = auth.uid() and status in ('draft', 'pending_review'));

create policy "courses_update_own"
  on public.courses for update
  to authenticated
  using (instructor_id = auth.uid())
  with check (instructor_id = auth.uid() and status <> 'published');

create policy "courses_staff_write"
  on public.courses for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- MODULES — métadonnées publiques (dès lors que le cours l'est), contenu
-- séparé et protégé (table suivante).
-- -----------------------------------------------------------------------------
create type public.course_module_kind as enum ('video', 'pdf', 'article');

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 150),
  kind public.course_module_kind not null,
  position smallint not null default 0,
  duration_minutes integer not null check (duration_minutes > 0),
  is_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index course_modules_course_idx on public.course_modules (course_id, position);

create trigger set_course_modules_updated_at
  before update on public.course_modules
  for each row execute function public.set_updated_at();

alter table public.course_modules enable row level security;

create policy "course_modules_select_visible_course"
  on public.course_modules for select
  to authenticated, anon
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.status = 'published'
    )
  );

create policy "course_modules_select_own_or_staff"
  on public.course_modules for select
  to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.courses c where c.id = course_id and c.instructor_id = auth.uid())
  );

create policy "course_modules_write_own_or_staff"
  on public.course_modules for all
  to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.courses c where c.id = course_id and c.instructor_id = auth.uid())
  )
  with check (
    public.is_staff()
    or exists (select 1 from public.courses c where c.id = course_id and c.instructor_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- INSCRIPTIONS — sert à la fois d'intention d'achat (formations payantes,
-- même rôle que orders pour le marketplace) et de justificatif d'accès
-- (formations gratuites : passage direct à 'active'). Le prix est figé au
-- moment de l'inscription et jamais fait confiance au client au-delà de la
-- valeur réelle du cours au moment de l'appel (WITH CHECK ci-dessous).
-- -----------------------------------------------------------------------------
create type public.enrollment_status as enum ('pending_payment', 'active', 'cancelled', 'refunded');

create table public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id),
  user_id uuid not null references public.profiles (id),
  unit_price integer not null check (unit_price >= 0),
  idempotency_key uuid not null unique,
  status public.enrollment_status not null default 'pending_payment',
  enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, user_id)
);

create index course_enrollments_user_idx on public.course_enrollments (user_id, status);
create index course_enrollments_course_idx on public.course_enrollments (course_id, status);

create trigger set_course_enrollments_updated_at
  before update on public.course_enrollments
  for each row execute function public.set_updated_at();

alter table public.course_enrollments enable row level security;

create policy "course_enrollments_select_own"
  on public.course_enrollments for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff()
    or exists (select 1 from public.courses c where c.id = course_id and c.instructor_id = auth.uid())
  );

-- Gratuit → 'active' immédiat ; payant → 'pending_payment' obligatoire (jamais
-- 'active' choisi par le client). unit_price doit correspondre au prix réel du
-- cours au moment de l'appel, jamais une valeur arbitraire du client.
create policy "course_enrollments_insert_self"
  on public.course_enrollments for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and unit_price = (select price from public.courses where id = course_id and status = 'published')
    and (
      (status = 'active' and unit_price = 0)
      or (status = 'pending_payment' and unit_price > 0)
    )
  );

create policy "course_enrollments_cancel_own"
  on public.course_enrollments for update
  to authenticated
  using (user_id = auth.uid() and status = 'pending_payment')
  with check (user_id = auth.uid() and status = 'cancelled');

create or replace function public.enforce_enrollment_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status = 'pending_payment' and new.status in ('active', 'cancelled') then
    return new;
  end if;
  if old.status = 'active' and new.status = 'refunded' then
    return new;
  end if;
  raise exception 'Transition de statut d''inscription invalide : % -> %', old.status, new.status;
end;
$$;

create trigger course_enrollments_status_transition
  before update of status on public.course_enrollments
  for each row execute function public.enforce_enrollment_status_transition();

create or replace function public.finalize_enrollment_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    new.enrolled_at := now();
    update public.courses set enrolled_count = enrolled_count + 1 where id = new.course_id;
  end if;
  return new;
end;
$$;

create trigger course_enrollments_activate
  before insert or update of status on public.course_enrollments
  for each row
  when (new.status = 'active')
  execute function public.finalize_enrollment_activation();

comment on table public.course_enrollments is
  'pending_payment -> active se fait aussi via apply_payment_settlement (0007, étendu ci-dessous) quand le paiement CamPay associé réussit — jamais directement par le client pour une formation payante.';

-- -----------------------------------------------------------------------------
-- CONTENU DES MODULES — table séparée, verrouillée. media_path pointe vers le
-- bucket Storage privé course-media (URLs signées temporaires, section 19) ;
-- article_content est du jsonb en clair (pas de média binaire à protéger).
-- -----------------------------------------------------------------------------
create table public.course_module_content (
  module_id uuid primary key references public.course_modules (id) on delete cascade,
  media_path text,
  article_content jsonb,
  updated_at timestamptz not null default now()
);

create trigger set_course_module_content_updated_at
  before update on public.course_module_content
  for each row execute function public.set_updated_at();

alter table public.course_module_content enable row level security;

create policy "course_module_content_select_authorized"
  on public.course_module_content for select
  to authenticated
  using (
    exists (
      select 1 from public.course_modules m
      join public.courses c on c.id = m.course_id
      where m.id = module_id
        and (
          m.is_preview
          or public.is_staff()
          or c.instructor_id = auth.uid()
          or exists (
            select 1 from public.course_enrollments e
            where e.course_id = c.id and e.user_id = auth.uid() and e.status = 'active'
          )
        )
    )
  );

create policy "course_module_content_write_own_or_staff"
  on public.course_module_content for all
  to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.course_modules m join public.courses c on c.id = m.course_id
      where m.id = module_id and c.instructor_id = auth.uid()
    )
  )
  with check (
    public.is_staff()
    or exists (
      select 1 from public.course_modules m join public.courses c on c.id = m.course_id
      where m.id = module_id and c.instructor_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- PROGRESSION — idempotente par construction : la clé primaire (user_id,
-- module_id) fait qu'un second appel identique ne peut pas créer de doublon
-- (le client fait un upsert / ignore le conflit, jamais d'erreur métier).
-- -----------------------------------------------------------------------------
create table public.module_progress (
  user_id uuid not null references public.profiles (id),
  module_id uuid not null references public.course_modules (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

alter table public.module_progress enable row level security;

create policy "module_progress_select_own"
  on public.module_progress for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- Ne peut marquer un module complété que si réellement inscrit ET actif dans
-- le cours correspondant (section 19, "contrôle des accès à chaque module
-- côté serveur" — vaut aussi pour l'écriture de progression, pas seulement la
-- lecture du contenu).
create policy "module_progress_insert_own"
  on public.module_progress for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.course_modules m
      join public.course_enrollments e on e.course_id = m.course_id
      where m.id = module_id and e.user_id = auth.uid() and e.status = 'active'
    )
  );

-- -----------------------------------------------------------------------------
-- CERTIFICATS — écrits uniquement par le trigger de complétion, jamais par le
-- client (section 19, "généré seulement lorsque les critères sont satisfaits").
-- -----------------------------------------------------------------------------
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id),
  user_id uuid not null references public.profiles (id),
  certificate_code text not null unique,
  issued_at timestamptz not null default now(),
  unique (course_id, user_id)
);

alter table public.certificates enable row level security;

create policy "certificates_select_own"
  on public.certificates for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff()
    or exists (select 1 from public.courses c where c.id = course_id and c.instructor_id = auth.uid())
  );

comment on table public.certificates is
  'Aucune policy insert/update/delete pour authenticated : seul check_course_completion() (SECURITY DEFINER) y écrit.';

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
    values (v_course_id, new.user_id, encode(gen_random_bytes(6), 'hex'))
    on conflict (course_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger module_progress_check_completion
  after insert on public.module_progress
  for each row execute function public.check_course_completion();

-- -----------------------------------------------------------------------------
-- AVIS — un seul par (cours, utilisateur), réservé aux inscrits actifs (avis
-- vérifié, pas un simple visiteur), cache rating_avg/reviews_count maintenu
-- par trigger.
-- -----------------------------------------------------------------------------
create table public.course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id),
  user_id uuid not null references public.profiles (id),
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, user_id)
);

create trigger set_course_reviews_updated_at
  before update on public.course_reviews
  for each row execute function public.set_updated_at();

alter table public.course_reviews enable row level security;

create policy "course_reviews_select_public"
  on public.course_reviews for select
  to authenticated, anon
  using (true);

create policy "course_reviews_insert_enrolled"
  on public.course_reviews for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.course_enrollments e
      where e.course_id = course_id and e.user_id = auth.uid() and e.status = 'active'
    )
  );

create policy "course_reviews_update_own"
  on public.course_reviews for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "course_reviews_delete_own"
  on public.course_reviews for delete
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

create or replace function public.refresh_course_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid := coalesce(new.course_id, old.course_id);
begin
  update public.courses c
    set rating_avg = coalesce((select round(avg(rating)::numeric, 1) from public.course_reviews where course_id = v_course_id), 0),
        reviews_count = (select count(*) from public.course_reviews where course_id = v_course_id)
    where c.id = v_course_id;
  return null;
end;
$$;

create trigger course_reviews_refresh_rating
  after insert or update or delete on public.course_reviews
  for each row execute function public.refresh_course_rating();

-- =============================================================================
-- GÉNÉRALISATION DES PAIEMENTS — une formation payante se règle par le même
-- pipeline CamPay que le marketplace (0007), mais rattaché à une inscription
-- plutôt qu'à une commande : payments.order_id devient optionnel, en exigeant
-- exactement une cible (commande XOR inscription). Ne touche pas au domaine
-- marketplace (orders) lui-même — voir 0005, resté inchangé.
-- =============================================================================
alter table public.payments alter column order_id drop not null;
alter table public.payments add column course_enrollment_id uuid references public.course_enrollments (id);

alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id) = 1);

create unique index payments_course_enrollment_uidx
  on public.payments (course_enrollment_id)
  where course_enrollment_id is not null;

-- Étend apply_payment_settlement (0007) pour gérer aussi les inscriptions.
-- CREATE OR REPLACE : même signature, aucun DROP nécessaire.
create or replace function public.apply_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    if new.order_id is not null then
      update public.orders
        set status = 'paid'
        where id = new.order_id and status = 'pending_payment';

      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'order_not_pending_payment_at_settlement', 'order_id', new.order_id));
      end if;
    else
      update public.course_enrollments
        set status = 'active'
        where id = new.course_enrollment_id and status = 'pending_payment';

      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'enrollment_not_pending_payment_at_settlement', 'course_enrollment_id', new.course_enrollment_id));
      end if;
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);

  return new;
end;
$$;

-- Les deux policies suivantes (0007) faisaient un INNER JOIN sur orders : avec
-- order_id désormais nullable pour les paiements de formation, ce JOIN
-- produisait zéro ligne pour ces paiements (y compris pour le staff). Recréées
-- pour couvrir les deux cibles.
drop policy if exists "payments_select_participant" on public.payments;
create policy "payments_select_participant"
  on public.payments for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
    )
    or exists (
      select 1 from public.course_enrollments e
      where e.id = payments.course_enrollment_id and e.user_id = auth.uid()
    )
    or public.is_staff()
  );

drop policy if exists "payment_attempts_select_buyer" on public.payment_attempts;
create policy "payment_attempts_select_buyer"
  on public.payment_attempts for select
  to authenticated
  using (
    exists (
      select 1 from public.payments p
      left join public.orders o on o.id = p.order_id
      left join public.course_enrollments e on e.id = p.course_enrollment_id
      where p.id = payment_attempts.payment_id
        and (o.buyer_id = auth.uid() or e.user_id = auth.uid() or public.is_staff())
    )
  );

-- -----------------------------------------------------------------------------
-- STOCKAGE DES MÉDIAS DE COURS — bucket privé, policies vérifiant l'accès
-- (aperçu, staff, instructeur, inscrit actif) via les deux premiers segments
-- du chemin (convention <course_id>/<module_id>/<fichier>).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('course-media', 'course-media', false)
on conflict (id) do nothing;

create policy "course_media_select_authorized"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-media'
    and exists (
      select 1 from public.course_modules m
      join public.courses c on c.id = m.course_id
      where c.id::text = (storage.foldername(name))[1]
        and m.id::text = (storage.foldername(name))[2]
        and (
          m.is_preview
          or public.is_staff()
          or c.instructor_id = auth.uid()
          or exists (
            select 1 from public.course_enrollments e
            where e.course_id = c.id and e.user_id = auth.uid() and e.status = 'active'
          )
        )
    )
  );

create policy "course_media_write_staff_or_instructor"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-media'
    and exists (
      select 1 from public.courses c
      where c.id::text = (storage.foldername(name))[1]
        and (public.is_staff() or c.instructor_id = auth.uid())
    )
  );
