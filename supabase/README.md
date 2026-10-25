# Backend CampusMarket — amorce (Phase 10)

Ce dossier démarre le branchement du prototype sur un vrai backend Supabase,
à partir des deux documents fournis :
- `CampusMarket_Backend_Hardened_Security_Edition.docx` (architecture cible, 60 sections)
- `CampusMarket_Plan_de_Tests_Complet_E2E_Securite_V2_Enrichi.docx` (plan de tests, 395 écrans)

Le document backend propose une feuille de route en 12 phases (section 37). Ce qui suit
correspond aux **phases 1 à 3** (Fondations, Auth & sécurité — de base —, Profils &
géographie), la **phase 4** (Marketplace — schéma seul, sans upload ni recherche
avancée), la **phase 5** (Commerce — commandes, achats groupés, offres de prix,
réservations, troc), la **phase 6** (Paiements Mobile Money via CamPay, close), le reste
de la **phase 2** (Auth avancée — OTP téléphone, MFA, audit/security logs, RBAC contrôlé,
close), la **phase 7** (Messagerie 1-à-1 temps réel, close), l'**Academy**
(catalogue, modules, progression, certificats, avis, paiement de formation, close) et
les **communautés/groupes/événements** (espaces, modération, signalements, billetterie
avec scan atomique, close) et les **notifications** (close). Restent : annuaire/support,
admin, hardening, production.

## Contenu

```
supabase/
  config.toml                     réglages Auth (MFA TOTP activé, hook SMS documenté)
  migrations/
    0001_extensions_and_roles.sql   RBAC minimal (user_roles, has_role/is_admin/is_staff)
    0002_geo.sql                    countries, universities (annuaire /universites)
    0003_identity.sql               profiles (public) + profile_private + provisioning auto
    0004_marketplace.sql            categories, products, product_media
    0005_commerce.sql               orders (remise en main propre, transitions de statut)
    0006_group_buying.sql           group_purchases, tiers, participants (achats groupés)
    0007_payments.sql               payments, payment_attempts, provider_events, payment_ledger,
                                     machine à états, journal financier append-only
    0008_offers_reservations_exchanges.sql  offres de prix, réservations (anti double-vente), troc
    0009_payments_cron.sql          planification pg_cron/pg_net de payments-reconcile (placeholders à remplir)
    0010_commerce_cron.sql          planification pg_cron d'expire_stale_offers()/expire_stale_reservations()
    0011_auth_hardening.sql         OTP téléphone, audit_logs/security_logs, grant_role/revoke_role (MFA),
                                     détection nouvel appareil, rôle financial_manager
    0012_messaging.sql              conversations, messages, blocage, immuabilité, anti-flood, Storage + Realtime
    0015_notifications.sql          notifications, préférences, file e-mail, dédup, câblage sur les modules
    0016_notifications_cron.sql     cron d'envoi e-mail + purge des notifications lues (secrets via Vault, rien à éditer)
    0017_notifications_wiring.sql   câblage restant : retrait produit, formation, achats groupés, fils d'espace, rappels événement
    0018_directory.sql              flag_emoji sur countries, suggestions d'université (soumission, approbation, rejet)
    0019_support.sql                FAQ (catégories/items), tickets support, messages, pièces jointes, auto-assignation
    0020_admin.sql                  back-office : sanctions réelles, modération, vérification de compte, invitations, stats, audit
    0021_hardening.sql              durcissement : droits minimaux, oracles d'autorisation fermés, limites de débit, OTP atomique, stock, stockage
    0014_communities_events.sql     espaces (communautés/groupes), adhésion public/privé/invitation, posts,
                                     modération, signalements, événements, billets, scan atomique
    0013_academy.sql                cours, modules (contenu séparé), inscriptions, progression, certificats, avis,
                                     généralisation de payments (order_id XOR course_enrollment_id)
  functions/
    .env.example                    liste des secrets à configurer (CamPay, cron, SMS)
    _shared/campay.ts               client CamPay (token, collect, transaction status, vérif. signature JWT)
    _shared/cors.ts                 headers CORS communs aux fonctions publiques
    _shared/sms.ts                  abstraction d'envoi SMS — AUCUN prestataire branché (voir plus bas)
    _shared/email.ts                envoi e-mail — Resend/Brevo/Mailgun au choix (EMAIL_PROVIDER), testé sans réseau réel
    _shared/email.test.mjs          tests de _shared/email.ts (fetch simulé) — voir l'en-tête pour la commande d'exécution
    payments-initiate/              déclenche une demande de paiement (appelée par le front, JWT acheteur)
    payments-webhook/               reçoit les notifications CamPay (public, idempotent, reconfirmation serveur)
    payments-reconcile/             job périodique (cron) — rattrape les webhooks jamais reçus
    notifications-dispatch/         vide la file e-mail (cron) — corps générique, aucun contenu sensible
    push-dispatch/                  vide la file push (cron) — OneSignal ou Web Push, corps générique
    course-checkout-initiate/       équivalent payments-initiate pour l'inscription à une formation payante
    (billets d'événement payants : même pipeline, payments.event_ticket_id — pas de fonction dédiée encore)
    phone-otp-request/              génère et envoie un code de vérification téléphone (6 chiffres, 10 min)
    phone-otp-verify/               vérifie le code, marque profile_private.phone_verified
  seed.sql                          mêmes pays/universités/catégories que le prototype front
  tests/
    smoke_test.sql                  provisioning auto + isolation RLS (profils, annonces)
    orders_rls_test.sql             transitions de statut de commande (paiement, annulation)
    payments_rls_test.sql           isolation paiements, machine à états, immuabilité du journal
    offers_reservations_exchanges_rls_test.sql  négociation, anti double-réservation, troc
    auth_hardening_rls_test.sql     RBAC contrôlé + MFA, logs append-only, anti-verrouillage, anti-fuite OTP
    messaging_rls_test.sql          isolation conversations, blocage, immuabilité messages, anti-flood, Storage
    academy_rls_test.sql            contrôle d'accès module (preview/protégé), progression, certificat, paiement formation
    notifications_rls_test.sql      câblage, dédup, préférences, sécurité non désactivable, exploits (faux, lecture croisée)
    notifications_wiring_rls_test.sql  retrait produit, formation, achats groupés, fils d'espace (portée bornée), rappels
    directory_rls_test.sql          suggestion d'université : soumission, approbation (sigle obligatoire), rejet, garde-fous
    support_rls_test.sql            FAQ, cycle de vie d'un ticket, auto-assignation, immuabilité, pièces jointes, exploit
    community_events_rls_test.sql   adhésion, modération, signalements, capacité, scan de billet, paiement billet
    admin_rls_test.sql              rôles/hiérarchie/MFA, effet des sanctions, colonnes protégées, vérification, invitations, audit
    hardening_rls_test.sql          droits, oracles, limites de débit, stock, avatar, stockage, OTP atomique, rétention
```

## Communautés, groupes, événements — décisions et bugs trouvés en testant

- **Un seul modèle `spaces`** (kind `communaute`/`groupe`), comme le fait déjà le front.
- **Trois paliers de visibilité** : `publique` (visible, adhésion directe), `privee`
  (**découvrable**, adhésion sur demande approuvée par owner/admin), `invitation`
  (totalement invisible tant qu'on n'est pas invité, l'invité accepte lui-même).
  Ma première version rendait `privee` aussi invisible qu'`invitation` : impossible
  alors de demander à rejoindre un espace qu'on ne voit pas. Corrigé.
- **Modération** : masquer/rétablir un post = modérateur de l'espace OU staff ;
  suspendre/supprimer un espace = staff seul ; tout via fonctions `moderate_*`
  journalisées dans `audit_logs`. "Avertir" journalise seulement (l'utilisateur ne
  le voit pas tant que la table `notifications` n'existe pas).
- **Signalements** : table `reports` générique (profil, annonce, message,
  commentaire, espace, formation), `target_id` sans FK (association polymorphe).
- **Billetterie** : `qr_code` opaque (24 octets aléatoires) généré côté base ;
  capacité verrouillée (`FOR UPDATE`, comptant aussi les billets en attente de
  paiement) ; `scan_ticket()` verrouille la ligne du billet, journalise TOUTES les
  tentatives (y compris échecs) dans `ticket_scans`. `payments` a désormais 3
  cibles exclusives (commande | inscription | billet).
  Non fait : signature HMAC du QR (l'identifiant opaque seul suffit à la section 21,
  "et/ou") ; fonction d'initiation de paiement dédiée aux billets.

### Bugs trouvés en testant (dont deux failles réelles)

1. **Récursion RLS** : la policy `select` de `space_members` interrogeait
   `space_members` elle-même → "infinite recursion detected". Corrigé avec des
   fonctions `SECURITY DEFINER` (`is_space_member/admin/moderator`).
2. **Faille d'escalade entre policies UPDATE (la plus importante)** : quand
   plusieurs policies UPDATE permissives coexistent, Postgres combine leurs
   `WITH CHECK` par OR *indépendamment* de la policy dont le `USING` a donné
   accès à la ligne. Un `WITH CHECK` qui ne réaffirme pas *qui* a le droit peut
   donc être détourné. Deux occurrences dans 0014 (épinglage de post, demandes
   d'adhésion), corrigées. **Et une dans `offers` (0008), déjà "validée"** : un
   acheteur pouvait s'auto-accepter sa propre offre initiale (`pending`→`accepted`
   est une transition valide dans l'abstrait) et forcer une vente à son propre
   prix. Le trigger `enforce_offer_status_transition` vérifie maintenant l'identité
   pour chaque transition ; test d'exploit ajouté. Règle à retenir : **les
   triggers de transition, qui voient OLD/NEW et `auth.uid()`, sont l'autorité sur
   qui peut faire quelle transition ; les policies RLS ne sont qu'un filtre grossier.**
   `exchanges` avait la même forme de faille mais était protégé par son trigger
   d'états (audité, pas de changement nécessaire).
3. **Portée de variable** : un `WITH CHECK` sur `spaces` comparait à un sous-select
   `where s.id = id` où `id` se résolvait sur l'alias interne (toujours vrai).
   Remplacé par un trigger de protection des colonnes de modération.
4. Ordre des tables (référence croisée `spaces`/`space_members`), UUID de test
   invalides, assertion sous RLS sur un post masqué : bugs de test/ordre, pas de sécurité.

## Notifications

- **Personne côté client n'écrit une notification** (ni pour soi, ni pour autrui) :
  aucune policy INSERT, et `create_notification()` a son EXECUTE révoqué pour
  `authenticated`/`anon`. Sans ça, n'importe qui pourrait fabriquer une fausse
  alerte "sécurité" ou "support". Un destinataire ne peut modifier que `read_at`
  (trigger).
- **Payload minimal** (≤ 1 Ko) : identifiants et compteur, jamais le contenu d'un
  message ni un motif de modération. Le front en déduit titre, icône et lien à
  partir de `type`. Les e-mails restent volontairement génériques.
- **Déduplication** : au plus une notification NON LUE par (destinataire, clé).
  Cinq messages d'affilée = une notification avec `payload.count = 5`, et un seul
  e-mail. Une fois lue, le message suivant en crée une nouvelle.
- **Préférences** par catégorie et par canal ; sans ligne = défauts (in-app oui,
  e-mail non). `securite` n'est pas désactivable (contrainte CHECK + forcé dans la
  fonction).
- **Robustesse** : `create_notification` avale ses propres erreurs. Perdre une
  notification est acceptable ; faire échouer l'envoi d'un message ou une commande
  parce qu'une notification a planté ne l'est pas.
- **Câblé** : nouveau message (sauf blocage), offres, commandes, certificat,
  demandes d'adhésion/invitations, billet confirmé, sécurité, avertissements de
  modération, **retrait d'annonce**, **inscription à une formation**, **achats
  groupés** (palier atteint/annulé — une expiration sans palier atteint ne
  notifie pas ici, le remboursement intégral porte sa propre notification côté
  service), **fils de discussion d'espace** et **rappels d'événement** (24h
  avant, cron horaire).
- **Choix assumé sur les espaces** : pas de notification sur la simple création
  d'un post (un espace de 5 000 membres enverrait 5 000 lignes par post — fan-out
  non borné). Seuls les FILS DE DISCUSSION notifient : l'auteur du post et les
  commentateurs précédents à un nouveau commentaire — portée bornée par la taille
  de la conversation, pas par celle de l'espace.
- **E-mail** : `_shared/email.ts` implémente trois prestataires REST au choix
  (`EMAIL_PROVIDER=resend|brevo|mailgun`), vérifiés contre leur documentation
  (endpoint, authentification, forme du corps) puis testés avec un `fetch` simulé
  (`_shared/email.test.mjs`, 20 vérifications : configuration manquante, les trois
  formats de requête exacts, classification des erreurs permanentes vs
  transitoires par code HTTP, troncature d'un message d'erreur trop long, timeout
  réseau, parsing de l'expéditeur). Reste à faire : choisir le prestataire, créer
  un compte, vérifier un domaine d'expédition (SPF/DKIM), renseigner
  `EMAIL_API_KEY`/`EMAIL_FROM` (et `MAILGUN_DOMAIN` le cas échéant).
- **Cron sans édition de fichier** : 0009 et 0016 lisent l'URL du projet et les
  secrets des jobs dans **Supabase Vault** à chaque exécution plutôt que dans des
  placeholders codés en dur — aucune valeur réelle ne transite donc par Git.
  Chaque migration crée son secret avec la valeur `REMPLACER_MOI` si absent ; il
  suffit d'aller dans **Project Settings > Vault** du Dashboard et de remplacer
  cette valeur par la vraie (URL Functions du projet, puis les secrets
  `PAYMENTS_RECONCILE_SECRET`/`NOTIFICATIONS_DISPATCH_SECRET` déjà utilisés côté
  Edge Functions). Vérifié avec un stub de `vault` : idempotence de la création
  des secrets, verrouillage réel de `private.cron_secret` pour `authenticated`,
  et construction correcte de l'URL/en-tête envoyés par le job.

### Test de mutation
Un test qui passe du premier coup ne prouve rien. J'ai cassé volontairement trois
protections (rendre `create_notification` appelable par les clients, supprimer le
trigger de protection du contenu, supprimer l'index de déduplication) et vérifié
que `notifications_rls_test.sql` échoue à chaque fois, puis repasse sur la base
saine.

## Annuaire

Pas de section dédiée dans le cahier des charges : `countries`/`universities`
existent depuis 0002 (lecture publique, écriture admin) et couvrent l'essentiel.
Deux trous concrets restaient, identifiés dans le prototype :

- **`flag_emoji`** sur `countries`, pour remplacer la table de correspondance
  codée en dur côté front (`university-directory.ts`). Peuplé dans `seed.sql`
  (pas dans la migration : les pays eux-mêmes n'existent qu'après le seed, qui
  tourne après toutes les migrations — un `UPDATE` dans 0018 ne trouvait donc
  aucune ligne à mettre à jour, trouvé en testant).
- **Suggestions d'université** (`university_suggestions`) : le bouton "Suggérer
  mon université" ne faisait qu'un toast, sans aucune persistance. Cycle complet
  maintenant : soumission par n'importe quel utilisateur, traitement réservé au
  staff via `review_university_suggestion()` (jamais de policy UPDATE
  authenticated, même pour le staff — même principe que les colonnes de
  modération en 0014), approbation ou rejet, notification du suggéreur dans les
  deux cas. Le sigle (`short_name`) est **obligatoire à l'approbation**, jamais
  déduit automatiquement du nom complet (une troncature aurait pu produire un
  résultat absurde ou entrer en collision avec un sigle existant).
- Le reste de l'"annuaire" (activité par campus, compteurs d'annonces/
  événements) est déjà de simples requêtes filtrées sur `products`/`events`
  existants, sans rien de plus à construire côté base.

## Support

Pas de section dédiée dans le cahier des charges non plus (juste listé comme
module dans l'arborescence, section 6) : modélisé à partir du prototype front
(`mock-support.ts`, page admin support).

- **FAQ** : `faq_categories` + `faq_items`, lecture publique du contenu publié,
  écriture staff. Les tickets réutilisent LA MÊME table de catégories que la
  FAQ — le prototype front les partage déjà (`FaqCategory.id == SupportTicket.category`).
- **Tickets** : statut orienté "à qui la balle" plutôt qu'un simple ouvert/fermé —
  `ouvert` (attend le support), `en_attente` (le support vient de répondre,
  attend l'utilisateur), `resolu`, `ferme`. Un message de l'utilisateur rouvre
  automatiquement le ticket ; un ticket fermé n'accepte plus de nouveaux messages
  (il faut en ouvrir un autre, comme la plupart des outils de support).
- **Auto-assignation** : le premier membre du support qui répond à un ticket
  non assigné en devient responsable automatiquement — convention courante des
  outils de support, réassignable ensuite manuellement par le staff
  (`support_tickets_staff_manage`).
- **Deux policies UPDATE volontairement disjointes** (`support_tickets_close_own`
  et `support_tickets_staff_manage`), chacune réaffirmant sa propre condition
  complète (`user_id = auth.uid()` contre `is_staff()`, mutuellement exclusifs) —
  application directe de la leçon sur les WITH CHECK combinés par OR (0014/0008).
  **Vérifié par mutation** : affaiblir le WITH CHECK de `close_own` (retirer
  l'exigence `status = 'ferme'`) fait échouer `support_rls_test.sql`, qui repasse
  sur la base saine une fois la policy restaurée — la même démarche qu'en 0015,
  appliquée ici à une faille de la famille découverte en 0008/0014, pas
  seulement au cas déjà connu.
- **Notification** : l'utilisateur est notifié (catégorie `systeme`) à chaque
  réponse du support, jamais l'inverse (le staff travaille depuis sa file, pas
  depuis des notifications individuelles).
- **Pièces jointes** : bucket privé `support-attachments`, même schéma
  d'autorisation que la messagerie (0012).
- **Non fait** : fermeture automatique d'un ticket `resolu` resté inactif au
  bout de N jours (mentionné comme "à ajouter si le besoin se confirme" dans la
  migration) — un simple job cron comme `expire_stale_reservations`.

## Admin

Un seul fichier, `0020_admin.sql`, mappé sur les 8 pages `/admin/*` du front. Principe :
**toute action admin passe par une fonction `admin_*`** qui vérifie le rôle, vérifie que
l'appelant n'est pas lui-même suspendu, et journalise dans `audit_logs` — **y compris les
refus**, renvoyés en `{success:false, error}` plutôt qu'en exception (une exception annulerait
le log : le piège déjà rencontré en 0011).

| Page front | Fonctions / tables |
|---|---|
| `/admin` | `admin_dashboard_stats()`, `admin_weekly_activity()`, `admin_alerts()` |
| `/admin/utilisateurs` | `admin_list_users()` (recherche, filtre, pagination), `admin_suspend_user`, `admin_ban_user`, `admin_reactivate_user`, `admin_verify_user`, file `admin_list_verifications` + `admin_review_verification` |
| `/admin/annonces` | `admin_set_listing_status()`, `admin_list_reports()`, `admin_handle_report()` |
| `/admin/universites`, `/admin/geographie` | écriture directe par les policies `is_admin()` de 0002 (désormais **auditées par trigger**), vue `cities_overview` |
| `/admin/statistiques` | `admin_signup_growth()`, `admin_weekly_activity()`, `admin_listings_by_category()`, `admin_top_campuses()` (l'export CSV reste côté client) |
| `/admin/support` | `admin_list_support_agents()`, `admin_assign_ticket()`, `admin_ticket_history()` |
| `/admin/parametres` | équipe : `admin_list_team()`, `grant_role`/`revoke_role` (0011) ; invitations : `admin_invite_staff`, `admin_list_invitations`, `admin_revoke_invitation`, `accept_staff_invitation` ; journal : `admin_audit_feed()` |

### Trous existants trouvés en relisant le schéma, et fermés ici
- **`log_audit` / `log_security_event` étaient appelables par n'importe quel client**
  (sur Supabase, toute fonction de `public` reçoit EXECUTE pour `anon`/`authenticated`
  par défaut, donc `/rpc/log_audit` marchait, même sans connexion) : on pouvait forger des
  lignes d'audit et de journal de sécurité au nom de n'importe qui. EXECUTE révoqué.
  Idem pour `expire_stale_offers/reservations/tickets()` et `send_event_reminders()`
  (tâches de cron déclenchables à la demande).
- **Un vendeur dont l'annonce avait été retirée pouvait la remettre en `pending_review`
  lui-même et effacer `moderation_reason`** (`products_update_own` n'interdit que
  `status = 'published'`). Trigger `products_protect_moderation` : `published`, `removed` et
  le motif ne bougent que par `admin_set_listing_status`.
- **Tout membre du staff, support compris, pouvait vérifier un compte ou publier/retirer
  une annonce par UPDATE direct**, sans trace (`profiles_admin_update`, `products_staff_update`).
  Même trigger de protection sur `profiles.verified`.
- **`reports_staff_update` laissait réécrire n'importe quelle colonne d'un signalement**
  (reporter, motif, cible). Policy supprimée : seul `admin_handle_report` change
  statut / traitant / note.
- **La vérification de compte n'avait aucun backend** (écrans 151-160 du front) :
  `verification_requests` + bucket privé `verification-documents` (dossier = id de l'utilisateur).
- **Supprimer une université détachait silencieusement ses étudiants** (`on delete set null`) :
  trigger bloquant, on la désactive (`active = false`).

### Sanctions : un effet réel, pas un drapeau
- `account_restrictions` (table séparée : RLS filtre des lignes, pas des colonnes — un motif posé
  sur `profiles`, publique, aurait été lisible de tous). L'intéressé lit sa sanction, personne
  n'écrit côté client.
- Des policies **RESTRICTIVE** (combinées en ET) sur les 20 tables d'écriture : un compte
  suspendu ou banni ne crée ni annonce, ni commande, ni message, etc. — sans réécrire les
  25 policies déjà validées. Le support et les signalements restent ouverts : on doit
  pouvoir contester.
- Bannissement : en plus `auth.users.banned_until = 'infinity'` (refus de connexion et de
  rafraîchissement) et suppression best-effort de `auth.sessions`. **Le JWT déjà émis reste
  valide jusqu'à son expiration** : ce sont les policies restrictives qui bloquent ses écritures
  immédiatement, pas la session.
- Hiérarchie : on n'agit jamais sur un compte de rang égal ou supérieur ; bannir/lever un
  bannissement/inviter exigent admin **+ session MFA** ; un super_admin seul invite un admin.
  Ni juge ni partie : pas d'approbation de sa propre annonce, pas de traitement d'un signalement
  que l'on a déposé ou qui nous vise, pas d'examen de sa propre vérification.
- Les invitations n'acceptent que si l'e-mail du compte est **confirmé** et identique : sans
  cela, quiconque s'inscrirait avec l'adresse invitée avant son titulaire hériterait du rôle.
- Un modérateur voit les e-mails masqués (`g***@domaine`) ; le contenu d'un message signalé
  n'est jamais exposé dans la file ; le volume Mobile Money n'est visible que d'admin et de
  `financial_manager`.

### Bug trouvé en testant
`log_security_event('account_banned')` échouait : le CHECK de `security_logs` (0011) liste les
types d'événements autorisés. Contrainte recréée avec `account_banned` / `account_unbanned`.
(Deux autres échecs étaient des erreurs de test, pas de SQL : une RLS qui masquait l'id d'une
invitation à l'appelant, et un ordre alphabétique mal attendu.)
Une assertion globale de `auth_hardening_rls_test.sql` (« un seul `role_granted` dans toute la
base ») est devenue fausse dès qu'un autre test légitime en émettait un : elle est désormais
bornée à sa propre cible.

### Test de mutation
Retirer le trigger `products_protect_moderation`, le trigger `profiles_protect_trust`, la policy
restrictive d'insertion sur `products`, ou rendre `log_audit` à nouveau exécutable fait chacun
échouer `admin_rls_test.sql`.

### Limites connues (à savoir avant la prod)
- Testé sur PostgreSQL 16 avec un stub de Supabase : la suppression réelle de `auth.sessions`
  et l'effet de `banned_until` dans GoTrue **ne sont pas vérifiés** en local (la branche
  d'absence de table est couverte, pas la suppression elle-même). À contrôler une fois sur
  le vrai projet.
- **L'e-mail d'invitation n'est pas envoyé** : seule une notification interne part si la personne a
  déjà un compte ; l'administrateur prévient l'invitée. À brancher sur la file e-mail de 0015
  si tu le souhaites.
- Les écritures faites depuis le SQL Editor (`postgres`, sans `auth.uid()`) ne sont pas journalisées
  par `audit_table_change` (c'est voulu, pour ne pas polluer l'audit avec les seeds) ; via l'API,
  même avec `service_role`, elles le sont.
- Les alertes sont calculées à la demande (seuils : 5 signalements/24 h, 10 % d'échecs de
  paiement sur 12 h avec au moins 10 paiements) ; à ajuster selon le trafic réel.

## Durcissement (avant production)

`0021_hardening.sql`, `tests/hardening_rls_test.sql`, `preflight_production.sql`, `PRODUCTION.md`.
Issu d'un audit du schéma 0001-0020 **et** des Edge Functions. Le guide de mise en production
(réglages du tableau de bord, tests de fumée, rotation, incident) est dans `PRODUCTION.md`.

### Ce que l'audit a trouvé, et corrigé
- **Oracles d'autorisation.** `is_admin(uuid)`, `is_staff(uuid)`, `has_role(…, uuid)`, `is_space_member(…, uuid)`,
  `is_blocked(a, b)` étaient des fonctions SECURITY DEFINER appelables via `/rpc/<nom>` par n'importe qui :
  on pouvait lister les administrateurs, savoir qui est membre d'un groupe **privé**, ou qui a bloqué qui.
  Les signatures sont inchangées (les policies y sont liées par OID) ; un client ne reçoit désormais de
  réponse vraie que pour lui-même, le staff et les contextes internes pour les autres.
  Le contexte d'appel se lit dans le GUC `role` (posé par PostgREST), pas dans `current_user`, qui vaut
  toujours le propriétaire à l'intérieur d'une fonction SECURITY DEFINER.
- **Droits de tables.** Sur Supabase, `anon` et `authenticated` reçoivent tous les droits sur chaque table ;
  seule la RLS protège. Or **TRUNCATE ignore la RLS** : le « append-only » d'`audit_logs` ne couvrait que
  UPDATE/DELETE. `anon` est maintenant en lecture seule, uniquement sur les tables qui ont une policy `anon` ;
  plus aucun droit TRUNCATE/REFERENCES/TRIGGER ; les tables de service (`provider_events`, codes OTP, file e-mail)
  n'ont plus aucun droit client ; `ALTER DEFAULT PRIVILEGES` évite que la prochaine migration les rouvre.
- **Fonctions exposées.** `EXECUTE` retiré à `PUBLIC`/`anon` partout, puis rendu aux seuls helpers que les policies
  `anon` évaluent (relevés par `pg_depend`, pas listés à la main). Plus aucune fonction de trigger exécutable.
- **Stock falsifiable.** `products_update_own` laissait le vendeur écrire `reserved_quantity` : le remettre à 0
  permettait de revendre un article déjà réservé (l'anti double-vente de 0008 repose sur ce compteur).
  Idem `views`. Le trigger de 0020 les protège ; les triggers de réservation (DEFINER) continuent d'y écrire.
- **Images d'annonce.** `product_media.storage_path` n'avait aucun bucket ni aucune policy. Bucket `product-media`
  privé, dossier = id du vendeur, lecture seulement pour une annonce **publiée**, et un trigger refuse tout chemin
  hors du dossier du vendeur (sinon « publier » le chemin d'un fichier d'autrui le rendait lisible de tous).
- **Buckets** : taille maximale et types MIME autorisés partout (aucun bucket n'en avait).
- **`avatar_url`** : https uniquement (`javascript:`, `data:`, `http:` refusés), contrainte posée `NOT VALID` puis
  validée : une ancienne ligne hors format ne fait pas échouer la migration, elle est signalée.
- **Limites de débit** par compte sur 14 tables (signalements, tickets, annonces, commandes, réservations, offres,
  espaces, événements, avis, publications, commentaires, vérifications…), sous verrou consultatif pour que des
  insertions parallèles ne passent pas toutes sous le seuil. Les appels internes ne sont jamais limités.
- **OTP téléphone (Edge Functions).** Vérification **non atomique** : lecture de `attempts`, comparaison, puis
  incrément — N requêtes parallèles lisaient toutes `attempts = 0` et contournaient `max_attempts`. Désormais
  `verify_phone_otp` (verrou de ligne, essai compté **avant** la comparaison). Et limite **par numéro** en plus
  de par utilisateur : créer des comptes suffisait pour harceler un numéro par SMS ou gonfler la facture.
- **Webhook de paiement (Edge Function).** (1) Une signature **absente** passait comme « non vérifiée » même
  avec la clé configurée. (2) Un événement falsifié consommait la clé d'idempotence `(provider, external_event_id)`
  de l'événement légitime, qui était ensuite ignoré comme « déjà traité ». (3) Sans `CAMPAY_WEBHOOK_KEY`, l'endpoint
  acceptait tout. Désormais : fail-closed (503 sans clé, sauf `ALLOW_UNSIGNED_WEBHOOKS=true` en sandbox),
  signature absente/invalide → 401 **avant** toute écriture, corps limité à 64 Ko.
- **CORS** : une origine fixe (`ALLOWED_ORIGIN`) au lieu de `*`.
- **En-têtes HTTP** (`src/server.ts`) : CSP, HSTS, `nosniff`, `frame-ancestors 'none'`, Referrer-Policy,
  Permissions-Policy, COOP — sur toute réponse du worker.
- **Rétention** : codes OTP purgés après 24 h, événements de paiement traités après 180 jours (job quotidien).

### Bug trouvé en testant
Dans la policy de lecture des images, `pm.storage_path = name` comparait avec la colonne `name` de **products**
(la sous-requête masque la colonne de `storage.objects`) : aucune image d'annonce n'aurait jamais été servie
aux visiteurs. Corrigé en `objects.name`. Deux autres échecs venaient du test lui-même (UUID non hexadécimaux,
catégorie d'espace absente).

### Effets sur les tests existants
Trois tests supposaient « 0 ligne » là où le client n'a maintenant **aucun droit** (`phone_verification_codes`,
`notification_email_queue`, `provider_events`) : ils acceptent désormais les deux, rien n'étant lisible dans
les deux cas. Les fonctions de test créées après 0021 ne sont plus exécutables par `anon` par défaut
(`grant execute` explicite dans `admin_rls_test.sql`).

### Test de mutation
Sept régressions injectées une à une font chacune échouer `hardening_rls_test.sql` : oracle `is_admin` rouvert,
oracle `is_blocked` rouvert, limite de débit des signalements retirée, contrôle de chemin `product_media` retiré,
TRUNCATE rendu à `authenticated`, `verify_phone_otp` exposé, contrainte d'avatar retirée. Le contrôle
`preflight_production.sql` détecte de même un TRUNCATE client, un bucket public, une fonction DEFINER sans
`search_path`, `log_audit` exposé, un compte de test, un admin sans MFA.

### Limites connues
- **Les Edge Functions modifiées (webhook, OTP, CORS) n'ont pas été exécutées** : seule leur syntaxe TypeScript
  est vérifiée (Deno n'est pas disponible ici). Les fonctions SQL qu'elles appellent, elles, sont testées.
  À tester sur staging avant la production (voir `PRODUCTION.md`, section 5).
- **Changement de comportement à connaître** : sans `CAMPAY_WEBHOOK_KEY`, `payments-webhook` répond désormais 503.
  La réconciliation périodique rattrape les paiements, mais la clé doit être définie avant l'ouverture.
- `current_setting('role')` repose sur le fonctionnement actuel de PostgREST (`SET LOCAL ROLE`). Le test
  `hardening_rls_test.sql` le simule ; à reconfirmer en cas de changement majeur de Supabase.
- CSP avec `'unsafe-inline'` sur les scripts (hydratation SSR et script de thème inline) ; pas de limitation par
  IP ; pas de scan antivirus ; pas de suppression de compte de bout en bout. Détails dans `PRODUCTION.md`, section 7.

## Academy — contrôle d'accès et généralisation des paiements

- **Métadonnées vs contenu** : `course_modules` (titre, durée, position, aperçu
  ou non) est visible dès qu'on peut voir le cours — c'est le sommaire, il doit
  donner envie de s'inscrire. `course_module_content` (media_path/article_content)
  est une table SÉPARÉE, verrouillée : RLS filtre des lignes, jamais des
  colonnes à l'intérieur d'une ligne, donc la seule façon de cacher le contenu
  tout en montrant le titre est de les mettre dans deux tables (même principe
  que `provider_events` vs `payments` en 0007).
- **Médias privés (vidéo/pdf)** : bucket Storage `course-media`, convention de
  chemin `<course_id>/<module_id>/<fichier>`, policies vérifiant aperçu /
  inscription active / staff / instructeur — exactement le mécanisme qui rend
  une URL signée Supabase Storage réellement temporaire et restreinte (section
  19), pas une fonctionnalité à part.
- **Formations payantes** : pas de duplication du pipeline CamPay. `payments.order_id`
  est devenu optionnel, `payments.course_enrollment_id` généralisant la même
  table (`payments_exactly_one_target` : commande XOR inscription).
  `apply_payment_settlement` (0007) gère désormais les deux cibles.
  `course-checkout-initiate` est le pendant de `payments-initiate` pour une
  inscription ; `payments-webhook` n'a pas eu besoin de changer (il ne
  connaît que `payments`/`payment_attempts`, jamais `orders` directement).
  **`orders` (marketplace) n'a pas été touché** — seul `payments`, qui n'a pas
  la sémantique "remise en main propre" qui aurait mal collé aux formations.
- **Progression idempotente** : `module_progress` a pour clé primaire
  `(user_id, module_id)` — un double appel identique ne peut pas créer de
  doublon (`ON CONFLICT DO NOTHING` côté client), exactement l'exigence de la
  section 19.
- **Certificat** : `check_course_completion()` (trigger, SECURITY DEFINER)
  compare le nombre de modules du cours au nombre de modules complétés par
  l'utilisateur et n'émet le certificat que si tous y sont — jamais une
  écriture cliente directe sur `certificates` (aucune policy insert/update
  pour authenticated).

### Deux bugs trouvés en testant (aucun dans le SQL de sécurité lui-même)

1. **Ordre des tables dans la migration** : `course_module_content` référençait
   `course_enrollments` dans sa policy avant que cette table n'existe encore
   plus bas dans le même fichier — `ERROR: relation "course_enrollments" does
   not exist`. Postgres exécute un fichier de migration séquentiellement, une
   référence en avant ne "voit" pas une table qui sera créée plus tard dans le
   même fichier. Corrigé en réordonnant les sections.
2. **Mon test, pas la migration** : une assertion utilisait
   `name like '%/c1/%'` pour repérer le fichier du module aperçu — mais l'ID du
   module est un UUID qui se termine par `...0000c1`, jamais littéralement
   `/c1/`. Le motif ne correspondait à rien, faisant échouer un test qui aurait
   dû passer. Corrigé avec une comparaison exacte sur le chemin complet.

## Messagerie — ce qui est natif Supabase vs ce qui a été construit ici

- **Diffusion temps réel** : native (Supabase Realtime). Ce qui a été fait ici :
  ajouter `messages` et `conversation_states` à la publication
  `supabase_realtime` (0012, idempotent — ignoré proprement si rejoué en local
  hors Supabase). Un message est toujours persisté avant diffusion (c'est
  Realtime qui écoute la table, il n'y a rien d'autre à faire pour respecter
  cette exigence de la section 17).
- **Pièces jointes** : bucket Storage privé `message-attachments` + policies
  `storage.objects` vérifiant l'appartenance à la conversation via le premier
  segment du chemin (`<conversation_id>/<fichier>`). Le frontend doit
  respecter cette convention de nommage à l'upload, sinon la policy ne
  retrouvera pas la conversation et rejettera l'accès.
- **Blocage** : `blocked_users`, vérifié à la fois à la création d'une
  conversation et à l'envoi de chaque message (donc effectif même sur une
  conversation déjà ancienne).
- **Anti-flood** : 20 messages/minute par expéditeur, tous destinataires
  confondus (trigger, invariant structurel plutôt que règle métier — même
  raisonnement que le verrou de stock des réservations, 0008).
- **États envoyé/reçu/lu** : `created_at`/`delivered_at`/`read_at` sur chaque
  message, positionnables uniquement par le destinataire (jamais l'expéditeur)
  et jamais réversibles une fois posés (trigger d'immuabilité, qui interdit
  aussi toute modification du contenu après envoi).
- **Pagination** : la DB fournit les index (`conversation_id, created_at desc`)
  pour un `ORDER BY ... LIMIT` efficace ; l'interdiction de "chargement
  illimité" (section 17) reste une discipline côté requêtes du frontend, pas
  quelque chose d'imposable depuis la base.

### Bug trouvé en testant réellement (encore un, même famille que 0011)

`is_blocked()` n'était pas `SECURITY DEFINER`. Résultat : appelée par la
personne BLOQUÉE (jamais celle qui a posé le blocage), la fonction hérite de
la RLS de l'appelant sur `blocked_users` (`blocker_id = auth.uid()`), qui ne
lui montre que les blocages qu'elle a elle-même posés — jamais celui dont
elle est la cible. `is_blocked()` renvoyait donc systématiquement `false` pour
la personne qu'il fallait justement bloquer, et le test l'a confirmé
(l'utilisateur bloqué arrivait quand même à envoyer son message). Corrigé en
`SECURITY DEFINER`, exactement le même principe que `has_role`/`is_admin`/
`is_staff` en 0001 — et documenté sur la fonction elle-même pour que la
prochaine fonction de ce genre (permission croisée entre deux utilisateurs)
ne retombe pas dans le même piège.

## Auth avancée — ce qui est natif Supabase vs ce qui a été construit ici

Pour éviter toute ambiguïté sur ce qui existe déjà côté plateforme :
- **Authentification elle-même (email/mot de passe, magic link, rotation des
  refresh tokens, récupération de compte par lien à usage unique)** : nativement
  gérée par Supabase Auth (GoTrue). Rien n'a été reconstruit ici — la
  réinventer en SQL serait moins sûr que ce que la plateforme fournit déjà.
- **MFA/TOTP (enrôlement, QR code, codes de récupération)** : natif Supabase
  Auth (activé dans `config.toml`). Ce qui a été construit ici en complément :
  `has_mfa_session()` (0011) qui EXIGE une session aal2 réelle pour
  `grant_role`/`revoke_role` — sans quoi le MFA existerait mais rien ne
  l'imposerait réellement pour les actions sensibles.
- **Vérification d'un numéro camerounais (`profile_private.phone_verified`)** :
  aucun équivalent natif pertinent pour ce cas précis → construit de A à Z
  (`phone_verification_codes` + `phone-otp-request`/`phone-otp-verify`), avec
  la même rigueur que les paiements (hash uniquement, jamais le code en clair,
  anti-abus, expiration, tentatives limitées).
  **Aucun prestataire SMS n'est branché** (`_shared/sms.ts` échoue
  explicitement tant que `SMS_PROVIDER` n'a pas d'implémentation réelle) —
  c'est le même type de trou que l'était la signature CamPay avant
  vérification, sauf qu'ici il n'y a pas encore de piste confirmée : à choisir
  entre Twilio (couverture large, plus cher) et un agrégateur local
  camerounais (Nexah, Nimba SMS — souvent plus fiable/moins cher localement).
- **Attribution de rôle (`user_roles`)** : n'avait aucune policy d'écriture du
  tout depuis 0001 (deny-all total, y compris pour un admin agissant via
  l'API normale). `grant_role`/`revoke_role` (0011) sont désormais les seules
  portes d'entrée : vérification du rôle appelant, MFA obligatoire, anti
  auto-verrouillage (impossible de se retirer soi-même son propre rôle
  admin/super_admin), et journalisation systématique.
- **audit_logs / security_logs** : deux journaux distincts et réellement
  append-only (`UPDATE`/`DELETE` révoqués au niveau `GRANT`, comme
  `payment_ledger`). `security_logs` est encore plus restreint (super_admin
  seulement) car la simple liste des connexions/tentatives MFA est déjà
  sensible.

### Bug trouvé en testant réellement (pas en relisant)

`grant_role`/`revoke_role` journalisaient l'échec PUIS levaient une exception
(`RAISE EXCEPTION`). Ça semblait correct à la lecture, mais Postgres annule
TOUT l'effet d'un appel qui se termine par une exception non rattrapée — y
compris le `INSERT` du log fait juste avant. Résultat : les tentatives
refusées n'étaient jamais journalisées, l'inverse du but recherché. Corrigé en
faisant retourner un résultat structuré (`jsonb {success, error}`) pour tous
les cas "normaux" à auditer, en réservant `RAISE EXCEPTION` aux seules erreurs
d'usage qui n'ont pas besoin de survivre à l'annulation (l'anti
auto-verrouillage). Le test de fumée vérifie maintenant explicitement que les
3 tentatives refusées d'affilée sont bien dans `audit_logs`.


## Paiements Mobile Money — ce qu'il reste à faire côté Cabrel avant la prod

- **Compte marchand CamPay** (sandbox puis prod) : à créer toi-même sur
  https://www.campay.net — c'est une démarche commerciale, je ne peux pas la
  faire à ta place. Une fois fait, renseigne les secrets dans
  `functions/.env.example` (`CAMPAY_APP_USERNAME`, `CAMPAY_APP_PASSWORD`,
  `CAMPAY_WEBHOOK_KEY`, `PAYMENTS_RECONCILE_SECRET`) via le Dashboard Supabase
  ou `supabase secrets set`.
- **Signature du webhook** : ✅ résolu. Le champ `signature` de CamPay est en
  réalité un JWT signé en HS256 avec la clé webhook (confirmé via le SDK Go
  officiel `NdoleStudio/campay-go-sdk`, méthode `ValidateCallback`).
  `_shared/campay.ts` (`verifyWebhookSignature`) le vérifie réellement. Tant
  que `CAMPAY_WEBHOOK_KEY` n'est pas configuré, le webhook continue de
  fonctionner via la reconfirmation server-to-server seule (dégradation
  progressive, pas de blocage en attendant que tu configures la clé).
- **Cron de réconciliation** : script prêt dans `0009_payments_cron.sql`
  (pg_cron + pg_net, toutes les 5 min). Avant de l'exécuter : remplace les
  deux placeholders `<PROJECT_REF>` et `<PAYMENTS_RECONCILE_SECRET>` par les
  vraies valeurs du projet, et active les extensions pg_cron/pg_net depuis
  Dashboard > Database > Extensions si la migration échoue par manque de droits.
- **Préfixes MTN/Orange** : ✅ confirmés (MTN : 67, 68, 650-654 · Orange : 69,
  655-659, source agrégateur DusuPay, cohérent avec l'allocation ART) — déjà
  dans `detectOperator` (`_shared/campay.ts`).

## Comment l'appliquer

Avec la CLI Supabase (`supabase init` déjà fait sur le projet réel) :

```bash
supabase link --project-ref <votre-projet>
supabase db push          # applique les migrations dans l'ordre
supabase db reset         # en local : migrations + seed.sql
```

## Comment c'est validé

Sans accès réseau à un vrai projet Supabase, chaque migration a été exécutée sur un
PostgreSQL 16 local, avec un stub minimal du schéma `auth` (table `auth.users`,
fonction `auth.uid()`, rôles `anon`/`authenticated`) pour se rapprocher de l'environnement
réel. Résultat :
- les 6 migrations + le seed s'appliquent sans erreur, dans l'ordre ;
- `tests/smoke_test.sql` confirme que le trigger de provisioning crée bien
  `profiles` + `profile_private` + le rôle `student` à l'inscription, qu'un
  utilisateur ne peut jamais lire l'email privé d'un autre (isolation RLS), et
  qu'il ne peut pas créer d'annonce au nom d'un autre utilisateur (protection
  anti-usurpation exigée section 44 du document backend, IDOR/mass assignment) ;
- `tests/orders_rls_test.sql` confirme qu'un acheteur ne peut jamais s'auto-valider
  un paiement, et qu'un vendeur ne peut agir sur une commande que dans l'état où
  il est censé intervenir (ex. impossible d'annuler une commande déjà confirmée).
  Ce test a d'abord révélé une erreur dans le test lui-même (confusion entre un
  refus RLS silencieux à 0 ligne et une vraie exception) avant d'être corrigé —
  gardé comme rappel que le silence de RLS sur une ligne hors périmètre n'est pas
  un bug, contrairement à un rejet de WITH CHECK qui lève une vraie erreur.

Le stub de test n'est pas livré dans ce dossier (il simule Supabase, il n'en fait pas
partie) ; `tests/smoke_test.sql` et `tests/orders_rls_test.sql` sont réutilisables tels
quels sur un vrai projet Supabase local via `supabase db reset` puis `psql`.

## Décisions notables

- **profiles / profile_private séparées** (section 43 : éviter les policies trop
  permissives). `profiles` est publique (nécessaire pour afficher vendeurs, membres,
  organisateurs) ; `profile_private` (email, téléphone) n'est jamais lisible par un
  autre utilisateur.
- **Aucune policy INSERT sur `profiles`/`profile_private`** : la création passe
  exclusivement par le trigger `handle_new_user` sur `auth.users`, jamais par confiance
  faite au client (règle non négociable section 36).
- **`user_roles` en lecture seule pour l'utilisateur, écriture nulle côté client** :
  l'attribution de rôle admin/modérateur devra passer par une fonction dédiée ou la
  `service_role`, à livrer avec le prochain morceau (RBAC complet, phase 10 du planning
  métier / phase 2 de la feuille de route backend).
- **Montants en entier (FCFA)**, jamais en flottant, conformément à la section 7.
- **`is_admin()` / `is_staff()` en `SECURITY DEFINER` minimal**, `STABLE`, avec
  `search_path` figé — conforme à la mise en garde section 43 sur l'escalade de
  privilèges par ce type de fonction.
- **`orders` ne passe jamais à `paid` depuis le client** : ce statut n'est écrit que
  par le futur webhook de paiement via la `service_role` (section 47). Les policies
  "authenticated" n'ouvrent que les transitions non financières (annulation par
  l'acheteur, confirmation de remise par le vendeur), chacune ré-affirmant la
  propriété de la ligne pour éviter tout croisement acheteur/vendeur.
- **`group_purchase_participants`** : les montants payés/remboursés restent visibles
  par les autres participants du même groupe avec ce modèle simple (RLS filtre des
  lignes, pas des colonnes) — documenté comme limitation assumée plutôt que caché ;
  une vue publique sans les colonnes financières est la solution si une confidentialité
  stricte des montants devient nécessaire.
- **Calculs métier (frais de service, paliers de prix, remboursement de différence,
  décrémentation de stock) volontairement absents des triggers SQL** : la section 7
  demande de garder la logique complexe dans la couche service, pas dans la base.

## Prochaines étapes suggérées

Dans l'ordre de la feuille de route (section 37) :
1. ~~**Auth avancée**~~ — fait et clos (voir section dédiée plus haut).
   `0011_auth_hardening.sql` : vérification téléphone par OTP, audit_logs +
   security_logs append-only, grant_role/revoke_role (MFA + anti
   auto-verrouillage), détection de nouvel appareil, rôle `financial_manager`.
   Il ne reste qu'une action manuelle côté Cabrel : choisir un prestataire SMS
   et l'implémenter dans `_shared/sms.ts` (même nature de trou que CamPay
   avant vérification, mais ici aucune piste n'est encore confirmée).
2. ~~**Paiements Mobile Money**~~ — fait et clos (0007_payments.sql + 0009_payments_cron.sql
   + functions/payments-*, signature webhook vérifiée réellement, préfixes confirmés).
   Il ne reste que des actions manuelles côté Cabrel (compte marchand CamPay,
   secrets, remplir les placeholders de 0009) — voir la section dédiée plus haut.
3. ~~**Reste du commerce**~~ — fait et clos. Offres de prix, réservations
   (anti double-vente, verrou de ligne) et troc dans
   `0008_offers_reservations_exchanges.sql` ; nettoyage périodique des offres
   et réservations expirées planifié dans `0010_commerce_cron.sql`.
   Trois trous trouvés puis corrigés en relisant à froid :
   - une contre-offre pouvait être créée sans `counter_amount` (RLS + trigger
     l'exigent désormais) ;
   - accepter une offre sur un produit vendu/retiré entre-temps aurait créé
     une commande fantôme (`convert_accepted_offer_to_order` reverrouille et
     revérifie l'annonce avant toute création) ;
   - les offres n'expiraient jamais (`expire_stale_offers()` ajouté, symétrique
     à `expire_stale_reservations()`).
   Les 4 tests de fumée couvrent maintenant ces trois cas.
4. ~~**Messagerie**~~ — fait et clos (voir section dédiée plus haut).
   `0012_messaging.sql` : conversations 1-à-1, blocage, pièces jointes via
   Storage, Realtime branché, anti-flood, immuabilité des messages. Aucune
   action manuelle requise cette fois (Realtime/Storage sont natifs, la
   migration s'en occupe).
5. ~~**Academy**~~ — fait et clos (voir section dédiée plus haut).
   `0013_academy.sql` : catalogue, modules à contenu séparé et protégé,
   inscriptions (gratuites et payantes), progression idempotente, certificats
   automatiques, avis, généralisation de `payments`. Aucune action manuelle
   requise (Storage est natif, comme pour la messagerie).
6. ~~**Communautés/Groupes/Événements**~~ — fait et clos (voir section dédiée).
7. ~~**Notifications**~~ — fait et clos, y compris e-mail (3 prestataires), cron sans
   édition de fichier (Vault), et le câblage restant (voir section dédiée).
8. ~~**Annuaire**~~ — fait et clos (voir section dédiée).
9. ~~**Support**~~ — fait et clos (voir section dédiée).
10. ~~**Admin**~~ — fait et clos (voir section dédiée plus haut) : `0020_admin.sql` +
   `admin_rls_test.sql`. Le backend de tous les modules conçus côté front est maintenant livré.
11. ~~**Hardening**~~ — fait côté base, Edge Functions et en-têtes HTTP (section « Durcissement »). Reste à
   exécuter `PRODUCTION.md` sur staging puis production (réglages Auth, sauvegardes, CAPTCHA, secrets).
12. **Branchement du front sur Supabase** : remplacer les `mock-*` écran par écran
   (`DESIGN_REVIEW_MODE` à `false`), en commençant par auth puis marketplace.
13. **Actions manuelles** : compte CamPay, prestataire SMS, prestataire e-mail, secrets Vault, premier
   `super_admin` (+ un second), et tests E2E du plan de tests.

Le plan de tests (395 écrans) devient exploitable au fur et à mesure que chaque module
est branché : la section 32 (« Tests obligatoires ») et la section 13 (« Parcours E2E
critiques ») du document backend donnent l'ordre de priorité recommandé.
