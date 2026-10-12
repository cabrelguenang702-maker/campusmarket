-- Données de DÉMONSTRATION pour Campus Academy (à exécuter à la main, jamais en production).
-- Deux formations publiées, uniquement en articles (aucun fichier à téléverser). Supprimer ensuite :
--   delete from public.courses where instructor_name = 'Équipe CampusMarket (démo)';
do $$
declare
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  m uuid;
begin
  insert into public.courses (id, category_slug, title, tagline, description, level, instructor_name, instructor_role, instructor_bio, price, status, learning_outcomes, requirements)
  values
   (c1, 'bureautique', 'Excel pour étudiants', 'Formules, tableaux et graphiques pour vos exposés et mémoires.',
    'Prenez en main Excel pour organiser vos données, calculer vos statistiques et présenter vos résultats, avec des exemples tirés de la vie universitaire.',
    'debutant', 'Équipe CampusMarket (démo)', 'Formation de démonstration', 'Contenu fictif servant à tester l''application.', 0, 'published',
    array['Saisir et mettre en forme un tableau', 'Utiliser les formules de base', 'Créer un graphique lisible'], array['Un ordinateur avec Excel ou LibreOffice']),
   (c2, 'entrepreneuriat', 'Lancer son projet depuis le campus', 'Transformez une idée en projet viable avec peu de moyens.',
    'Comment valider une idée, trouver ses premiers clients et financer son lancement quand on est étudiant ? Une formation pratique et courte.',
    'debutant', 'Équipe CampusMarket (démo)', 'Formation de démonstration', 'Contenu fictif servant à tester l''application.', 5000, 'published',
    array['Valider une idée auprès de vrais clients', 'Construire un modèle économique simple'], array['Une idée de projet, même vague']);

  insert into public.course_modules (id, course_id, title, kind, position, duration_minutes, is_preview) values (gen_random_uuid(), c1, 'Bienvenue dans Excel', 'article', 0, 6, true) returning id into m;
  insert into public.course_module_content (module_id, article_content) values (m, '[{"type":"p","text":"Excel est un tableur : il range vos données en lignes et en colonnes et calcule pour vous."},{"type":"h","text":"Ce que vous allez faire"},{"type":"list","items":["Saisir des données","Écrire une formule","Tracer un graphique"]},{"type":"callout","text":"Astuce : enregistrez souvent votre fichier."}]'::jsonb);
  insert into public.course_modules (id, course_id, title, kind, position, duration_minutes, is_preview) values (gen_random_uuid(), c1, 'Les formules de base', 'article', 1, 12, false) returning id into m;
  insert into public.course_module_content (module_id, article_content) values (m, '[{"type":"p","text":"Une formule commence toujours par le signe égal."},{"type":"code","text":"=SOMME(B2:B10)\n=MOYENNE(B2:B10)"},{"type":"p","text":"Essayez avec vos propres notes de la semaine."}]'::jsonb);
  insert into public.course_modules (id, course_id, title, kind, position, duration_minutes, is_preview) values (gen_random_uuid(), c1, 'Votre premier graphique', 'article', 2, 10, false) returning id into m;
  insert into public.course_module_content (module_id, article_content) values (m, '[{"type":"p","text":"Sélectionnez vos données puis insérez un graphique en colonnes."},{"type":"callout","text":"Un bon graphique a un titre et des axes nommés."}]'::jsonb);

  insert into public.course_modules (id, course_id, title, kind, position, duration_minutes, is_preview) values (gen_random_uuid(), c2, 'Trouver et tester une idée', 'article', 0, 14, true) returning id into m;
  insert into public.course_module_content (module_id, article_content) values (m, '[{"type":"p","text":"Une bonne idée résout un problème que des gens ont vraiment."},{"type":"list","items":["Parlez à dix clients potentiels","Notez leurs mots exacts","Testez avant de construire"]}]'::jsonb);
  insert into public.course_modules (id, course_id, title, kind, position, duration_minutes, is_preview) values (gen_random_uuid(), c2, 'Le modèle économique', 'article', 1, 12, false) returning id into m;
  insert into public.course_module_content (module_id, article_content) values (m, '[{"type":"p","text":"Combien vous coûte un client, combien vous rapporte-t-il ? Commencez par ces deux chiffres."}]'::jsonb);
end $$;
