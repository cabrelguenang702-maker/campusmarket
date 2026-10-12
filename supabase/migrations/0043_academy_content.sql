-- 0043 — Campus Academy : catalogue exploitable
--
-- * course_categories : les six catégories du catalogue (table vide jusqu'ici, donc aucun cours ne pouvait exister)
-- * courses.learning_outcomes / courses.requirements : « Ce que vous apprendrez » et « Prérequis » de la fiche
-- * course_module_content.article_content : tableau de blocs [{type: h|p|callout|code|list, text?, items?}]
-- * correctif : la politique d'insertion des avis comparait e.course_id à lui-même (toujours vrai) : toute personne
--   inscrite à UNE formation pouvait noter N'IMPORTE LAQUELLE. Elle compare maintenant à la formation notée.

insert into public.course_categories (slug, name, sort_order) values
  ('design', 'Design', 1),
  ('developpement', 'Développement', 2),
  ('mathematiques', 'Mathématiques', 3),
  ('entrepreneuriat', 'Entrepreneuriat', 4),
  ('bureautique', 'Bureautique', 5),
  ('marketing', 'Marketing', 6)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

alter table public.courses
  add column if not exists learning_outcomes text[] not null default '{}'
    check (cardinality(learning_outcomes) <= 12),
  add column if not exists requirements text[] not null default '{}'
    check (cardinality(requirements) <= 12);

alter table public.course_module_content
  drop constraint if exists course_module_content_article_is_array;
alter table public.course_module_content
  add constraint course_module_content_article_is_array
  check (article_content is null or jsonb_typeof(article_content) = 'array');

drop policy if exists course_reviews_insert_enrolled on public.course_reviews;
create policy course_reviews_insert_enrolled on public.course_reviews for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.course_enrollments e
      where e.course_id = course_reviews.course_id
        and e.user_id = (select auth.uid())
        and e.status = 'active'
    )
  );
