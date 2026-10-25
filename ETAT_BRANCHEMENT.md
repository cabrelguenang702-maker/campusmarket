# CampusMarket — état du branchement front ↔ Supabase (livraison intermédiaire v28)

Cette livraison est un **point d'étape**, pas la version finale : une partie des écrans lit et écrit dans Supabase, le reste
tourne encore sur des données de démonstration (mocks). **Rien n'a été compilé** (pas de réseau dans l'environnement de
travail) : seules la syntaxe des fichiers TypeScript et la résolution des imports ont été vérifiées. Premier réflexe : `npm install && npm run build`,
puis corriger les erreurs de types éventuelles. `src/routeTree.gen.ts` se régénère tout seul au premier `npm run dev`/`build`
(des routes ont été ajoutées, par exemple `/admin/securite`).

## Base de données (projet Supabase kxkxrephkyfpcuanlxen)
Migrations 0001–0021 d'origine + **0022 à 0053 ajoutées ici, déjà appliquées** sur le projet et testées avec de vrais rôles
(`set role authenticated` + JWT simulé). Pour un nouveau projet, les rejouer dans l'ordre.

| N° | Contenu |
|----|---------|
| 0022 | Favoris, avis vendeur, statistiques vendeur, demandes « Je recherche » (+ réponses), compteurs par trigger, caractéristiques d'annonce |
| 0023 | **Restauration des droits par défaut de Supabase sur `public`** (perdus au `DROP SCHEMA` : sans elle `authenticated` n'avait aucun droit) |
| 0024 | Un seul compteur de vues (`products.views`) |
| 0025 | Vue `marketplace_listings` (annonce + vendeur + stats, tri/filtre/pagination côté serveur) |
| 0026 | Alerte « me prévenir si disponible », favoris d'annonces vendues/archivées conservés |
| 0027 | L'acheteur peut refuser une contre-offre |
| 0028–0029 | Durée d'annonce (15/30/60 j), échéance posée à la validation, expiration automatique (cron horaire) |
| 0030 | « Suivre un vendeur » + compteur d'abonnés |
| 0031 | Buckets hérités rendus privés avec limites ; `avatars` conservé avec ses policies |
| 0032 | Notification automatique quand une annonce correspond à une demande « Je recherche » |
| 0033 | Photos d'une annonce publiée non modifiables sans nouvelle validation |
| 0034 | **Intégrité des commandes** : prix, frais, vendeur, réservation et stock fixés par la base (l'acheteur pouvait fixer le total) |
| 0035 | Cycle de vie des commandes : le vendeur confirme la remise, l'acheteur clôture ou ouvre un litige ; colonnes protégées |
| 0036–0037 | Messagerie : vue `my_conversations`, suppression de l'historique pour soi, désarchivage automatique |
| 0038 | Profil et sécurité : `profiles.filiere`/`niveau`, bucket `avatars` **public** (l'URL est copiée dans annonces et messages), `known_devices.label`, `record_login` (4 args), `my_login_history()`, `log_my_security_event()` |
| 0039 | **Double authentification imposée par la base** : `mfa_ok()`, `assert_mfa()`, politique RESTRICTIVE `mfa_required` sur toutes les tables à RLS (sauf catalogues publics) et sur `storage.objects` ; `admin_reset_user_mfa()` |
| 0040 | Visibilité (`profiles.discoverable`, `profile_private.allow_stranger_messages`), désactivation (`profiles.deactivated_at`, `deactivate_my_account`, `reactivate_my_account`), `export_my_data()`, `is_active_account` étendu |
| 0041 | Correctif : trois politiques qui se lisaient elles-mêmes (récursion avec 0039) remplacées par des déclencheurs / une fonction |
| 0042 | `search_path` fixé sur les déclencheurs et fonctions de session |
| 0043 | Campus Academy : six catégories (la table était vide), `courses.learning_outcomes` / `requirements`, `article_content` = tableau, **avis : politique corrigée** (toute personne inscrite à une formation pouvait noter n'importe laquelle) |
| 0044 | **Certificat jamais délivré** : `check_course_completion` appelait `gen_random_bytes` hors de son `search_path` → échec à la validation du dernier module |
| 0045 | Communautés et groupes : sept catégories (table vide), cible de signalement `post`, **hiérarchie des rôles** (un modérateur pouvait exclure un admin, un admin rétrograder le propriétaire, le propriétaire partir en laissant l'espace sans responsable), **publications protégées** (un modérateur pouvait réécrire le texte d'un autre), vues `space_posts_feed` / `space_members_list`, bucket privé `space-media` |
| 0046 | Droit d'exécution manquant sur la fonction des politiques du bucket `space-media` (tout envoi d'image échouait) |
| 0047 | Messages d'erreur des déclencheurs d'espaces affichables tels quels (code P0001) |
| 0048 | **Faille achats groupés** : n'importe quel utilisateur pouvait s'inscrire comme participant sans payer (et faire monter le compteur jusqu'à l'objectif). Politique supprimée ; compteur `participant_count` par déclencheur ; statut `reached` automatique ; conditions et paliers verrouillés dès qu'une personne a rejoint ; un seul groupe actif par produit |
| 0049 | Le vendeur organisateur voit la liste de ses participants |
| 0050 | Événements : cinq catégories (table vide), `events.program`, **impasse corrigée** (une personne dont le paiement avait expiré ou qui avait annulé son billet ne pouvait plus JAMAIS se réinscrire : unicité limitée aux billets actifs), plus de billet sur un événement terminé, l'organisateur ne peut plus fausser `tickets_sold`, baisser la capacité sous les places prises, changer le prix une fois des billets émis ni rouvrir un événement annulé |
| 0051 | **Aide et support** : consigne ce qui avait été appliqué sur le projet sans fichier (garde de `enforce_ticket_immutability`, `create_support_ticket`, les 20 questions de la FAQ) ; **nouveau** : limite de 30 messages / heure par demandeur (les messages de ticket n'avaient aucune limite), pièce jointe obligatoirement dans le dossier de son ticket, réponse FAQ « Publier une annonce » corrigée (l'annonce passe par la modération) |
| 0052 | **Achats groupés** : participation sans paiement (`join_group_purchase`), retrait (`leave_group_purchase`), création validée côté base (`create_group_purchase` : stock ≥ objectif, 1 à 5 paliers strictement décroissants sous le prix de l'annonce, échéance 1 h à 30 jours ; l'insertion directe est refusée), passage en phase de paiement à l'objectif atteint (prix final figé, place réservée 48 h pour chaque participant), commande au prix du palier (`orders.group_purchase_id`, prix imposé par la base), blocage de 48 h (`group_buy_blocks`) pour qui se retire ou ne paie pas, déblocage à 500 F (`group_buy_unblocks`, nouvelle cible de `payments`), tâche planifiée `process_group_purchases` toutes les 10 min |
| 0053 | **Support côté personnel** : le personnel ne peut plus écrire `assigned_to` / `last_message_*` directement (assignation uniquement via `admin_assign_ticket`, qui vérifie l'agent et journalise) ; un message du personnel ne rouvre plus en silence un ticket fermé (refus tant qu'il n'est pas rouvert) ; passages de/vers « résolu » et « fermé » journalisés ; `admin_ticket_history` renvoie assignations et changements de statut |

## Écrans branchés sur la base
Marketplace (filtres, tri, pagination), fiche produit (offres, alerte, signalement, contact, vues), publication et
modification d'annonce (photos réelles, statut `pending_review`), favoris, accueil, boutique vendeur (avis, abonnement),
« Mes annonces » (profil), « Je recherche », achat + paiement Mobile Money (CamPay), « Mes achats » / « Mes ventes »
(+ offres reçues), messagerie complète (temps réel, pièces jointes, blocage), notifications (centre, menu, préférences),
compteurs de la barre latérale, écran MFA du back-office (`/admin/securite`), **profil** (en-tête et chiffres réels, modification,
photo, e-mail avec confirmation, aperçu public), **vérification d'identité** (envoi des justificatifs, statut en attente /
vérifié / refusé avec motif), **paramètres** (apparence, mot de passe, appareils connus et historique, déconnexion des autres
appareils, utilisateurs bloqués), **formations** (catalogue, filtres, fiche, inscription gratuite, paiement des formations payantes,
lecteurs vidéo/PDF/article, progression, avis, certificat), **événements** (liste, fiche, création, billet gratuit, billet payant, billet électronique à QR code réel, contrôle d'entrée par caméra ou saisie, onglet du profil), **communautés et groupes** (listes, recherche, création, détail, rejoindre /
demander / quitter, publications avec image, réactions, commentaires, épinglage, suppression, signalement, membres, rôles, demandes
d'adhésion, onglets « Mes communautés / Mes groupes » du profil), **tableau de bord et statistiques du back-office** (`/admin`, `/admin/statistiques`), **utilisateurs, vérifications, annonces et signalements du back-office** (`/admin/utilisateurs`, `/admin/annonces`), **support côté personnel** (`/admin/support` : liste filtrée, réponse avec pièce jointe, assignation, résolu/fermé/rouvrir, historique), **aide et support** (FAQ publique, création de ticket avec capture, conversation, pièces jointes, fermeture), **achats groupés** (rejoindre, se retirer, payer au prix du palier, créer, annuler, déblocage), **universités** (annuaire avec recherche et filtres région / pays / ville, fiche d'une
université avec ses annonces et ses événements à venir).

## Encore sur des données de démonstration
Onboarding/inscription (paiement), le reste du back-office admin (universités et géographie, sécurité, paramètres/équipe et invitations : les fonctions de base existent déjà dans la migration 0020, il reste à brancher les écrans). `mock-admin.ts` et `mock-support.ts` ne sont plus importés nulle part : fichiers morts, supprimables.

## Aide et support (v24)
- **FAQ** : lue en base (`faq_categories`, `faq_items`), visible sans connexion, recherche et filtre par catégorie côté navigateur. Le contenu se gère en base (écran admin à venir).
- **Tickets** : « Nouveau ticket » appelle `create_support_ticket` (ticket + premier message en une opération, jamais de ticket vide) ; une capture ou un PDF (10 Mo, JPG/PNG/WebP/PDF) part ensuite comme second message. Conversation avec pièces jointes (URL signées d'1 h), rafraîchie toutes les 20 s (pas de temps réel).
- **Statuts** : `ouvert` (le support doit répondre), `en_attente` (à vous de répondre), `resolu` (décidé par le personnel ; répondre rouvre le ticket), `ferme`. Le demandeur ne peut que **fermer** son ticket, et c'est définitif (la base refuse toute écriture sur un ticket fermé) : le bouton « Marquer comme résolu » de la maquette est devenu « Fermer le ticket », le bouton « Rouvrir » a disparu.
- Limites imposées par la base : 5 tickets et 30 messages par heure et par personne (le personnel n'est pas limité).
- La notification « Réponse du support » ouvre maintenant le ticket concerné.
- Retiré car sans équivalent : indicateur « écrit… ». Non fait : notification des demandeurs à la fermeture, assignation visible côté demandeur.
- **Non testé de bout en bout depuis le front** (non compilé) ; la base a été testée avec de vrais rôles (création, pièce jointe hors dossier refusée, limite, fermeture, ticket d'autrui invisible).

## Universités (v23)
- Aucune migration : les tables `universities` et `countries` (avec `region` et `flag_emoji`) existaient et sont lisibles sans connexion.
- Les régions, pays et villes des filtres sont déduits des universités actives de la base (plus de listes écrites en dur).
- L'activité d'un campus (annonces, événements) est rattachée par le **sigle** de l'université (`short_name`), seule information stockée
  sur une annonce ou un événement. Le sigle n'est unique que par pays : deux universités de pays différents portant le même sigle
  mélangeraient leurs chiffres.
- Correction liée : la création d'événement proposait comme campus ceux qui avaient déjà des annonces (liste vide sans annonce) ; elle propose
  maintenant les universités actives.
- `lib/university-directory.ts` ne sert plus qu'aux écrans d'administration (Universités et Géographie), à brancher avec l'admin.

## Événements (v22)
- **QR code réel** : générateur écrit sans dépendance (`src/lib/qr.ts`), validé par décodage OpenCV (17 cas, versions 1 à 10, accents compris).
  Le billet contient `CMT:<jeton de 48 caractères>` ; à l'entrée, le scan lit ce jeton et appelle `scan_ticket` (verrou en base : deux
  scans simultanés ne passent jamais tous les deux).
- **Scan par caméra** : API `BarcodeDetector` du navigateur (Chrome, Edge, Android, Safari récent). Sinon message clair + saisie manuelle
  + bouton « Contrôler » dans la liste. Non testé sur appareil ici.
- **Billet payant** : nouvelle Edge Function `event-checkout-initiate` (déployée, même schéma que `course-checkout-initiate`), billet
  « en attente » 15 min puis « valide » à la confirmation CamPay (trigger existant). Non testée de bout en bout (pas de clés CamPay ici).
- **Annulation / remboursement** : l'annulation d'un billet ou d'un événement payant ne rembourse rien automatiquement (le projet ne sait
  pas rembourser) ; l'interface le dit et renvoie vers le support. Les participants ne sont pas notifiés de l'annulation d'un événement.
- Retiré : affiche (la table n'a pas de colonne image), « Télécharger » le billet (remplacé par « Imprimer »).
- Les fichiers `lib/mock-events.ts` ne servent plus qu'aux écrans Universités et Admin.

## Pays d'inscription : 54 pays africains (v33)
- Liste fournie le 14/10/2026 (54 États) chargée dans `countries` (migration `0057`, déjà appliquée) : code ISO, indicatif, région (classification ONU), drapeau. Les 12 pays d'origine gardent leurs moyens de paiement ; les 42 autres n'en ont aucun tant que le prestataire n'y est pas configuré (à régler dans Admin > Géographie). « Congo » et « RD Congo » portent désormais les noms de la liste.
- L'écran de choix du pays affiche le drapeau et « Paiement Mobile Money bientôt disponible » quand aucun moyen n'est configuré. Aucune université n'existe encore hors des pays d'origine : l'étape université propose déjà « suggérer une université » (file de validation de l'admin).
- Rappel : seul le Cameroun reçoit les SMS (`SMS_SUPPORTED_COUNTRIES`) et CamPay n'encaisse qu'en XAF : pour les autres pays, l'inscription et la navigation marchent, pas le paiement.

## Écart avec le cahier des charges v1.0 du 14/10/2026 (audit à confirmer ensemble)
Légende : ✔ fait · ◐ partiel · ✖ à faire.
- **1. Marketplace** : catégories ✔ (gestion admin des catégories ✖) ; publication, brouillon/pause/clôture, modération avec motif ◐ (vérifier le motif de refus montré au vendeur) ; recherche, filtres, tri ✔ (recherche en langage naturel ✖, P3) ; marché par campus ✔ (point de rendez-vous ✖) ; favoris et alertes ✔ ; négociation ✔ ; commandes ◐ (historique des statuts avec acteur ✖) ; évaluations ✔ ; vérification et signalements ✔ ; limites pour comptes récents ◐.
- **2. Paiements** : CamPay Mobile Money, confirmation serveur par webhook, historique/ledger ✔ ; reçus ✖ ; remboursements ✖ (CamPay ne rembourse pas : à trancher) ; litiges ◐ (statut « litige » seulement : pas de motif, pièces, responsable) ; détection des risques ✖ ; tableau financier vendeur ✖.
- **3. Réseau social** : espaces, fil, publications, réactions, commentaires, modération, événements, notifications ✔ ; abonnements (`profile_follows`) ◐ ; partage d'annonces dans un fil ✖ ; groupes par faculté/filière ◐ (groupes génériques).
- **4. Academy** : catalogue, cours, modules, progression, avis, certificats ✔ ; quiz et examens blancs ✖ ; groupes de révision/tutorat ◐ (via groupes) ; badges ✖ ; assistant IA ✖.
- **5. Campus Jobs** : ✖ entièrement (offres, recruteurs, profil professionnel, candidatures, vérification des recruteurs).
- **9. Monétisation** : frais de service 2 % ✔ ; abonnements vendeurs ◐ ; achats groupés avec déblocage ✔ ; formations payantes ✔ ; annonces sponsorisées ✖ ; publicité ✖ ; premium ✖ ; partenariats établissements ✖ ; rapports de revenus ◐ (statistiques admin).
- **Priorisation du document** : P0/P1 (fondations, marketplace, commandes) largement couverts ; le plus gros écart est P2 Campus Jobs (nouveau domaine), puis reçus/remboursements/litiges (P1) et quiz (P2).
- **Décisions du §12 encore ouvertes** : pays de lancement (Cameroun d'abord ?), moyens de paiement hors Cameroun, remboursements, livraison/remise, qui commissionne (vendeur ou acheteur), règles de modération, publicité/abonnements, IA.

## Communautés et groupes : compléments (v32)
- Migration `0056` (appliquée, testée) : déclencheur `spaces_protect_core` : un client ne peut plus modifier le type, le créateur ni le nombre de membres d'un espace, ni dépasser 8 règles. Les politiques d'édition existaient déjà (0014/0045).
- **Modifier sa publication** : entrée « Modifier » dans le menu ⋯ de l'auteur (texte seulement, l'image ne change pas). Impossible tant que la publication est épinglée (règle de la base) : désépinglez d'abord.
- **Réglages de l'espace** (bouton « Réglages » pour propriétaire et administrateurs) : nom, description, catégorie, confidentialité, règles.
- **Invitations** : « Inviter des personnes » sur la page Membres (recherche parmi les personnes qui acceptent d'être trouvées) ; l'invité voit un encadré Accepter / Refuser sur la liste des communautés et des groupes et sur la page de l'espace, et reçoit une notification.
- Nouveaux fichiers : `lib/api/spaces-manage.ts`, `components/community/{SpaceSettingsDialog,InvitePeopleDialog,InvitationsBanner}.tsx` ; modifiés : `PostCard.tsx`, `MembersList.tsx`, `SpacePages.tsx`.
- Limite : une invitation ne peut pas être annulée par l'administrateur une fois envoyée (la base ne l'autorise pas) ; l'invité peut la refuser.

## Inscription payante : mise en attente (décision v31)
- Décision : pas de frais d'inscription pour le moment, dans aucun pays. L'étape « Paiement » reste retirée du parcours (`REGISTRATION_PAYMENT_ENABLED = false` dans `src/lib/config.ts`) : e-mail, code, université puis compte créé, gratuitement.
- Activation prévue plus tard depuis l'espace admin, avec un prix configurable (par pays ou global). Rien n'est appliqué en base ni déployé.
- Préparé, NON appliqué : `supabase/_prepared/0055_registration_fee.sql` (colonne `profiles.registration_paid_at`, table `registration_payments`, cible de paiement « inscription » dans `payments`, règlement dans `apply_payment_settlement`, refus de publier/commander/écrire tant que non réglé, personnel exempté). Montant codé à 1 000 F dans cette version : à remplacer par un réglage admin avant application. Reste à écrire alors : Edge Function d'encaissement, branchement de l'écran `/inscription/paiement` (encore maquette, `mock-data`), bascule du drapeau.
- À savoir : les paiements CamPay sont en XAF (`payments.currency = 'XAF'`), donc un tarif vraiment multi-pays suppose d'autres devises ou un autre agrégateur.

## Paramètres, équipe, invitations, audit, sécurité (v30)
- Aucune nouvelle migration : s'appuie sur `grant_role`/`revoke_role` (0011) et `admin_invite_staff`, `admin_revoke_invitation`, `accept_staff_invitation`, `admin_list_team`, `admin_list_invitations`, `admin_audit_feed` (0020). Testé en base (rôle réel, session sécurisée simulée) : invitation, doublon refusé, acceptation, ajout/retrait de rôle, journal.
- `/admin/parametres` : onglets Équipe & rôles (ajout/retrait de rôles, administrateurs réservés aux super-administrateurs, pas d'auto-retrait), Invitations (liste, révocation), Journal d'audit (pagination « Voir plus »).
- `/invitation-equipe/<id>` (côté invité) : bouton « Accepter » ; l'e-mail du compte doit être confirmé et identique à l'invitation.
- `/admin/securite` : double authentification + lien vers appareils/historique/mot de passe (déjà branchés dans le profil).
- Retirés (aucun support en base, ne plus simuler) : interrupteur « 2FA obligatoire pour tous » et « Révoquer les sessions » du back-office.
- Limite connue : l'e-mail d'invitation n'est pas envoyé ; l'invité reçoit une notification interne s'il a déjà un compte, sinon l'administrateur le prévient.
- La notification d'invitation mène à `/invitation-equipe/<id>` (corrigé dans `notifications.ts` du zip complet v33).
- Plus aucun import de `mock-admin`/`mock-support` : `src/lib/mock-admin.ts` et `src/lib/mock-support.ts` peuvent être supprimés.

## Universités, suggestions et géographie côté administration (v29)
- Migration `0054_university_suggestions_review.sql` : écriture des tables `countries` et `universities` verrouillée par la double authentification (`mfa_ok()`), fonction `admin_review_university_suggestion` (administrateurs seulement ; erreurs : forbidden, mfa_required, not_found, already_reviewed, short_name_required, invalid_student_count, duplicate), notifications d'approbation et de refus au suggéreur.
- `/admin/universites` : onglets Universités et Suggestions (`?onglet=suggestions`), recherche, filtre, ajout, modification, activation, suppression (refusée par la base s'il y a des étudiants : on désactive).
- `/admin/geographie` : onglet Pays (code, nom, indicatif, région, moyens de paiement ; suppression bloquée tant que des universités y sont rattachées) et onglet Villes (déduites des universités, actives/total). Lecture seule pour le personnel non administrateur.
- Fichiers : `lib/api/admin-geo.ts`, `components/admin/UniversityFormDialog.tsx`, `routes/_admin.admin.universites.index.tsx`, `routes/_admin.admin.geographie.index.tsx`.
- Vérifié : migration testée en base ; écrans vérifiés en syntaxe seulement (pas de compilation complète ici : lancez `npm run build`).

## Tableau de bord et statistiques (v28)
- **`/admin`** : compteurs réels (étudiants, universités actives, annonces publiées, événements publiés, tickets ouverts, signalements en attente) cliquables vers l'écran concerné ; **volume Mobile Money 30 j visible seulement des administrateurs et du responsable financier** (la base renvoie null aux autres, la carte disparaît) ; activité des 7 derniers jours (fuseau de Douala) ; alertes calculées à la demande (pic de signalements sur un profil, taux d'échec de paiement élevé, suggestions d'université en attente) ; signalements à traiter. Rafraîchi chaque minute. Chaque bloc a son propre état d'erreur : un bloc en panne ne masque pas les autres.
- **`/admin/statistiques`** : croissance des inscriptions (cumul sur 6 mois), activité de la semaine, annonces publiées par catégorie, top 8 des campus, avec « Pas encore de données » quand il n'y a rien. **Export CSV** de ces quatre séries (séparateur « ; », accents lisibles dans Excel, valeurs neutralisées contre l'injection de formule).
- Les chiffres comptent les annonces **publiées** (pas les brouillons, ni celles en attente de validation ou retirées).
- **Testé en base avec de vrais rôles** : les six fonctions s'exécutent (7 jours, 6 mois, 7 catégories) ; modérateur : volume null ; responsable financier : volume renvoyé. **Non testé** : les écrans (non compilés) et l'allure des graphiques avec des données réelles (la base de test est vide).

## Utilisateurs, vérifications, annonces et signalements (v27)
- **`/admin/utilisateurs`, onglet Comptes** : recherche (350 ms de délai) et filtre actif / suspendu / banni, pagination de 25. Suspendre et bannir exigent un **motif** (3 à 500 caractères, conservé dans le journal d'audit) ; bannir, lever un bannissement et « vérifier à la main » sont réservés aux **administrateurs** et le bannissement exige une session avec double authentification (la base répond sinon « mfa_required », affiché clairement). Personne n'agit sur son propre compte ni sur un rang égal ou supérieur. Les modérateurs voient l'e-mail masqué (`t***@domaine`).
- **Onglet Vérifications** : jusqu'ici les étudiants pouvaient envoyer un justificatif mais **aucun écran ne permettait de le traiter**. File des demandes en attente (plus anciennes d'abord), ouverture du recto/verso par lien temporaire de 10 minutes (dossier privé), Approuver, ou Refuser avec motif (montré à l'étudiant, qui est notifié dans les deux cas).
- **`/admin/annonces`** : onglets **À valider** (nouvelles annonces, pastille du nombre), Publiées, Retirées, Signalements. Approuver ; remettre en attente et retirer exigent un motif ; une annonce retirée se rétablit « en attente » (jamais directement publiée) ; un modérateur ne modère pas ses propres annonces. Le texte de l'ancienne maquette (« signalée ») est abandonné.
- **Signalements** : à traiter / clos ; Prendre en charge, Traiter, Rejeter avec note facultative. « Traité » **ne retire pas le contenu** : l'action sur l'annonce ou le compte se fait depuis leurs écrans. Limite : les 100 signalements les plus récents sont chargés (le tri de la base met les ouverts d'abord).
- **Testé en base avec de vrais rôles** : modérateur voit la file, retrait sans motif refusé, approuver puis approuver deux fois refusé, retrait avec motif, rétablissement, vendeur refusé sur sa propre annonce, étudiant refusé, e-mail masqué pour le modérateur et complet pour l'admin, suspension (motif trop court refusé), modérateur refusé pour bannir mais autorisé à réactiver un suspendu, vérification (refus sans motif refusé, approbation, double approbation refusée, profil vérifié). **Non testé** : les écrans (non compilés), l'ouverture réelle d'un justificatif et le bannissement avec double authentification.

## Support côté personnel (v26)
- `/admin/support` lit les vrais tickets : filtres À traiter / En attente / Résolus / Fermés / Tous, recherche par sujet ou nom, rafraîchissement automatique toutes les 20 s (12 s dans la conversation ouverte).
- Réponse au demandeur (texte et/ou pièce jointe JPG/PNG/WebP/PDF 10 Mo) : le ticket passe « en attente du demandeur », est auto-assigné à l'agent s'il ne l'est pas, et le demandeur reçoit une notification.
- Assignation par la liste des agents (`admin_list_support_agents`), réservée au rôle support et aux administrateurs ; boutons Marquer résolu / Fermer / Rouvrir ; historique interne (assignations et changements de statut).
- Un ticket fermé ne reçoit plus de message de personne ; pour y répondre, le rouvrir.
- **À trancher** : tout le personnel (modérateurs compris) lit et répond aux tickets (politiques de 0019, via `is_staff`). Seule l'assignation est limitée au rôle support. Restreindre la lecture au rôle support serait une modification des politiques (la fonction `act_as_support` existe déjà).
- **Testé en base avec de vrais rôles** : agent voit le ticket, première réponse → « en attente » + auto-assignation, assignation directe refusée, assignation à un non-agent refusée, résolu / rouvert par le demandeur / fermé, agent refusé sur un ticket fermé puis rouvert, historique lisible par le personnel et refusé à l'étudiant. **Non testé** : l'écran (non compilé).
- Les messages d'erreur rédigés par le front passent maintenant par `UserFacingError` (sans cela, `friendlyError` les remplaçait par le texte générique).

## Achats groupés (v25)
- **Rejoindre** = s'engager au prix du palier courant, **sans payer** : rien n'est débité, donc rien à rembourser (le paiement CamPay ne sait qu'encaisser).
- **Objectif atteint** : le groupe passe en « atteint », le prix final (palier atteint) est figé et identique pour tous ; chaque participant est notifié, sa place est réservée **48 h**, et il paie par une commande normale (`/produit/<id>/acheter?groupe=<id>`, quantité 1, prix imposé par la base).
- **Échéance sans objectif**, annulation par le vendeur ou annonce retirée : le groupe se clôt, personne n'a rien payé, aucun blocage. Un participant dont la place ne peut plus être réservée (stock pris entre-temps par un achat classique) est libéré sans blocage.
- **Blocage de 48 h** : qui se retire (même avant l'objectif), annule sa commande de groupe ou ne paie pas dans les 48 h ne peut plus **rejoindre un achat groupé** pendant 48 h. Les achats classiques ne sont pas concernés. **Lever le blocage : 500 F** par Mobile Money (Edge Function `group-unblock-initiate`, même circuit CamPay ; le montant vient de la base).
  À confirmer : le blocage vise les achats groupés, pas tout le compte (une seule ligne à changer dans `join_group_purchase` pour l'étendre).
- **Créer** : depuis la page `/produit/<id>/achat-groupe` du vendeur (lien « Proposer en achat groupé » sur la fiche). **Annuler** : tant que le groupe est actif.
- Un participant qui a payé ne peut plus se retirer (aucun remboursement automatique) : il passe par le support.
- La page de paiement d'un achat groupé n'affiche pas l'ancien « 30 minutes » : la réservation dure jusqu'à l'échéance de 48 h.
- **Testé en base avec de vrais rôles** : création refusée (palier ≥ prix, objectif > stock, insertion directe), vendeur et doublon refusés, objectif atteint → prix final 8 000 F + 3 réservations, commande au prix du palier malgré un prix truqué côté client (8 160 F frais compris), non-participant refusé, payé non retirable, retrait → blocage 48 h, délai dépassé → expiré + blocage, paiement de 500 F → blocage levé, groupe sans objectif → expiré sans blocage.
- **Non testé** : le front (non compilé), l'Edge Function `group-unblock-initiate` (déployée ; la copie déployée embarque `cors.ts` et `campay.ts` à plat alors que le dépôt les importe depuis `../_shared`, comme les autres fonctions) et le paiement CamPay réel.

## Communautés et groupes (v20)
- Un seul code pour les deux (`components/community/SpacePages.tsx`), les six routes sont de fines enveloppes. `kind` = communaute | groupe.
- **Les publications ne sont lisibles que par les membres**, même dans un espace public (politique de la base) : un visiteur voit la
  description, les règles et un bouton « Rejoindre ». Espace privé : « Demander à rejoindre », validée dans l'onglet Membres par un administrateur.
- **Rôles** : propriétaire > administrateur > modérateur > membre. Le menu de chaque membre n'affiche que ce que la hiérarchie autorise
  (le propriétaire nomme les administrateurs ; un administrateur nomme/retire les modérateurs ; chacun exclut ses subordonnés). La base le
  vérifie aussi : l'interface n'est pas la seule barrière.
- **Création** : bouton « Créer » (limite de 5 par jour imposée par la base). Le créateur devient propriétaire.
- Retirés car sans équivalent en base : « N en ligne », nombre de « membres actifs », partage autre que la copie du lien.
- Signalement d'une publication ou d'un espace : écrit dans `reports` (motif générique) ; le traitement relève du back-office.
- Non faits : modification d'une publication par son auteur, modification des paramètres d'un espace (nom, règles), invitations.

## Formations (v19)
- **Contenu** : aucun cours n'existe tant qu'on n'en crée pas. Il n'y a pas d'écran formateur/admin pour ça (hors périmètre) : créer les
  lignes `courses` / `course_modules` / `course_module_content` (SQL ou dashboard). `supabase/seed_academy_demo.sql` crée deux cours de
  démonstration en articles (à lancer à la main, jamais en production).
- **Vidéos et PDF** : déposer le fichier dans le bucket privé `course-media` sous `<course_id>/<module_id>/<fichier>` puis renseigner
  `course_module_content.media_path`. Les lecteurs utilisent une URL signée d'1 h. Articles : `article_content` = `[{type: h|p|callout|code|list, text, items}]`.
- **Inscription gratuite** : testée. **Formation payante** : passe par l'Edge Function `course-checkout-initiate` (déjà dans le dépôt) et
  CamPay ; elle demande les mêmes secrets que le paiement des produits et n'a pas pu être testée de bout en bout ici.
- **Certificat** : numéro `CM-<code>` ; le faux QR code et le faux lien « vérifiable en ligne » ont été retirés (aucune page publique de
  vérification n'existe). À décider : une page publique `/verification/<code>` + une fonction qui ne renvoie que nom, formation et date.
- Retirés car sans équivalent en base : sous-titres, vitesse/±10 s du faux lecteur vidéo (le lecteur natif du navigateur les remplace),
  lecture automatique du module suivant, bouton « Partager ».

## Double authentification, visibilité, désactivation, export (v18)
- **2FA étudiants** : activable dans Paramètres › Sécurité (application d'authentification, QR code). Une fois activée, la connexion
  affiche une étape « code » et **la base refuse tout accès aux données tant que le code n'est pas saisi** (jeton aal1). L'activation
  déconnecte les autres appareils. Pas de codes de secours (Supabase n'en propose pas) : téléphone perdu →
  `select public.admin_reset_user_mfa('<uuid>', 'motif')` depuis un compte admin en aal2 (pas encore d'écran admin pour ça).
- **Visibilité** : « apparaître dans la recherche de personnes » et « messages privés d'inconnus » (appliqué par la base : sans annonce du
  destinataire et sans abonnement, la conversation est refusée). Les acheteurs peuvent toujours écrire à propos d'une annonce.
  Les réglages « profil visible », « campus visible », « dernière connexion » n'existent pas : le profil est public par construction.
- **Désactivation** : demande le mot de passe ; profil, annonces et demandes disparaissent pour les autres, plus de publication ni de message ;
  commandes en cours inchangées ; réactivation à tout moment en se reconnectant (écran « compte désactivé »). Aucune suppression automatique.
- **Export** : fichier JSON de toutes les données personnelles (3 par heure). Les messages reçus d'autres personnes n'y figurent pas.
- Limite connue : les fonctions SECURITY DEFINER du personnel (grant_role, moderate_*, etc.) gardent leurs propres contrôles
  (rôle + aal2) ; seules les tables, le stockage et les fonctions « mon compte » sont couvertes par `mfa_required`.

## Toujours non faits (retirés de l'interface plutôt que simulés)
- **Alertes de connexion par e-mail** et **déconnexion d'un seul appareil** : impossibles sans Edge Function (Supabase n'expose pas les sessions).
- **Langue** : interface en français uniquement. **Prénom/nom/date de naissance** séparés : pas en base (`full_name` seul).
- **Suppression définitive du compte** : sur demande au support.
- `record_login` est appelé à la connexion (après le code si 2FA) ; la détection de « nouvel appareil » n'envoie pas encore de notification.

## À savoir avant de tester
- **Vercel refusait `npm install`** (faille XSS dans `@tanstack/start-server-core` 1.169.17, imposée en version exacte par `@tanstack/react-start`) : `package.json` force désormais `~1.169.39` via `overrides` et l'entrée verrouillée a été retirée de `package-lock.json` pour que npm la résolve de nouveau. Non rejoué ici (pas d'accès au registre) : si Vercel bloque encore, lancer `npm update @tanstack/react-start @tanstack/react-router @tanstack/router-plugin` puis valider `package-lock.json`. `bun.lock` n'a pas été touché.
- Les avatars déjà envoyés dans l'ancien bucket privé ne s'afficheront pas : aucun n'existait (l'envoi n'était pas branché).
- **Les annonces publiées passent par la modération** : statut `pending_review` ; un admin doit les valider.
- **Frais de service 2 %** repris de la maquette (`order_service_fee`, migration 0034) : à confirmer.
- **Aucun versement au vendeur** n'est prévu en base (seulement le journal des paiements).
- Pas de présence « en ligne » ni de notifications push (rien en base).
- Preflight : 1 contrôle en échec tant qu'il n'y a pas de `super_admin` ; il faut aussi activer le MFA de ce compte
  (`/admin/securite`) et reporter les secrets d'Edge Functions (`PAYMENTS_RECONCILE_SECRET`, `NOTIFICATIONS_DISPATCH_SECRET`,
  `CAMPAY_WEBHOOK_KEY`, `ALLOWED_ORIGIN`). Voir `supabase/PRODUCTION.md`.
- Bucket orphelins `listing-media`, `chat-attachments`, `formation-content` : fermés et vides, supprimables depuis le dashboard.

## v34 — Campus Jobs (cahier des charges §6)
**Base de données (migration 0058, appliquée et testée)** : `recruiters`, `job_offers`, `professional_profiles`, `job_applications`, `job_application_events`, `job_application_notes`, bucket privé `job-documents` (CV PDF 5 Mo), vue `job_offers_feed`, clôture automatique des offres échues (pg_cron).
- Les statuts ne changent que par fonctions : `request_recruiter`, `admin_review_recruiter`, `submit_job_offer`, `set_job_offer_state`, `admin_review_job_offer`, `apply_to_job`, `withdraw_job_application`, `set_application_status`.
- Recruteur vérifié → offre publiée directement ; sinon relecture par la modération. Suspension d'un recruteur → ses offres sont suspendues.
- Confidentialité : le profil professionnel est privé ; une copie figée est transmise à la candidature seulement si le candidat le choisit. Le personnel ne lit PAS les candidatures ; les notes internes ne sont lisibles que du recruteur ; le CV n'est lisible que du candidat et du recruteur de l'offre.
- Limites : 20 candidatures/jour, 30 offres actives par recruteur, pas de doublon de titre.

**Écrans** : `/emplois` (offres + filtres), `/emplois/$id` (détail + candidature), `/emplois/candidatures` (suivi + historique + retrait), `/emplois/profil`, `/emplois/recruteur` (demande, offres, candidatures, décisions + notes), `/admin/emplois` (recruteurs et offres). Notifications branchées.
**À faire côté Jobs** : signalement d'une offre (type `job_offer` ajouté à l'énumération, écran non branché), recommandations d'offres, statistiques recruteur.
**Après récupération** : `routeTree.gen.ts` se régénère au `npm run build` / `npm run dev` (nouvelles routes).

## v35 — Commandes et paiements (cahier des charges §2)
**Migration 0059 (appliquée et testée en base avec de vrais rôles)** :
- **Historique des statuts** : table `order_events` alimentée par trigger (reprise des commandes existantes), lisible des deux parties et du personnel.
- **Litiges structurés** : `order_disputes` (motif, description, jusqu'à 5 pièces dans le bucket privé `dispute-evidence`, réponse unique du vendeur, décision motivée, suivi du remboursement). Le passage en « litige » n'est plus possible sans fiche (trigger) : fonctions `open_order_dispute`, `respond_order_dispute`, `admin_list_disputes`, `admin_resolve_dispute` (support ; refusé si le support est partie), `admin_mark_dispute_refunded` (administrateur seulement).
- Décision pour l'acheteur → commande annulée + remboursement « à effectuer » ; pour le vendeur → commande terminée.
- **Reçu** : `order_receipt` (numéro CM-AAAAMMJJ-XXXXXX, parties, montants, date de paiement), réservé aux deux parties et aux commandes payées.
- **Tableau vendeur** : `seller_finance_summary` (terminé, en attente, en litige, 30 jours, 6 mois, meilleurs articles).
**Écrans** : « Suivi » sur chaque commande (historique + litige + reçu), fenêtre « Signaler un problème » avec preuves, `/profil/recu/$id` (imprimable / PDF), `/profil/finances`, `/admin/litiges`. Notifications branchées.
**Limites assumées** : CamPay ne rembourse pas → le remboursement reste manuel (suivi dans l'écran admin) ; aucun versement automatique au vendeur n'existe (écran vendeur le dit explicitement) ; pas encore de détection des risques (§2) ni de remboursement avant expédition.

## v36 — Campus Academy : quiz, progression, badges (cahier des charges §5)
**Migration 0060 (appliquée et testée en base avec de vrais rôles)** : `quizzes`, `quiz_questions`, `quiz_attempts`, `learning_goals`, `badge_definitions` (7 badges, règle écrite), `user_badges`.
- Les bonnes réponses ne sont lisibles que par l'auteur du cours et le personnel ; l'étudiant ne les reçoit qu'avec la correction, après remise.
- Correction 100 % serveur (`start_quiz_attempt`, `submit_quiz_attempt`) : reprise d'une tentative ouverte, nombre de tentatives max, durée limitée (60 s de tolérance, tentative hors délai = non réussie), question à choix multiples juste seulement si toutes les bonnes réponses (et rien d'autre) sont cochées.
- Quiz réservés aux inscrits actifs, à l'auteur et aux admins. Fuseau « Africa/Douala », semaine du lundi.
- Badges attribués par trigger (leçon terminée, quiz réussi, certificat) + notification `badge_earned`. Ils sont privés : ni partage ni classement.
- `my_learning_summary` : totaux, objectifs de la semaine, progression par formation, moyenne par domaine, activité sur 14 jours (corrigée par la migration `0060b` : `generate_series` sur timestamps).
**Migration 0061 (NON appliquée)** : `save_quiz` et `delete_quiz` (création/modification/suppression d'un quiz par l'auteur). Le fichier contient des `delete from` et l'outil d'application automatique les refuse : à coller dans le SQL Editor de Supabase. Sans elle, l'éditeur de quiz ne peut pas enregistrer (le reste de l'Academy fonctionne).
**Écrans** : section « Quiz » sur la page d'une formation, `/formations/$id/quiz/$quizId` (chrono, remise automatique, correction détaillée), `/formations/$id/quiz-editeur/$quizId` (auteur ; `nouveau` pour créer), `/progression` (objectifs modifiables, activité, domaines, badges avec règles).
**Non fait** : groupes de révision / tutorat (§5.5), assistant IA (§5.7), sauvegarde des réponses en cours de quiz (une reprise redonne les mêmes questions, sans les réponses cochées).
**Après récupération** : `routeTree.gen.ts` se régénère au build.

## v37 — Monétisation : base de données (migrations 0062 à 0070) et écran admin « Finances »
**Base (appliquée sur le projet Supabase kxkxrephkyfpcuanlxen, testée avec de vrais rôles ; les fichiers SQL correspondants ne sont PAS encore dans `supabase/migrations/`, voir « À finir » ci-dessous)** :
- **0062** groupes de révision : `study_groups`, `study_group_members`, `study_sessions`, `study_session_rsvps` (+ vues `study_groups_overview`, `study_group_members_list`, `study_session_rsvps_list`).
- **0063** tutorat : `tutor_profiles`, `tutoring_requests`, `tutor_reviews`, fonctions `save_tutor_profile`, `request_tutoring`, `respond_tutoring_request`, `cancel_tutoring_request`, `complete_tutoring_request`, `review_tutor` ; vues `tutors_directory`, `tutoring_requests_list`, `tutor_reviews_list`. Devenir tuteur exige un profil vérifié.
- **0064** frais et revenus : `platform_fee_settings` (frais acheteur 2 %, commissions vendeur/formation/événement/tutorat à 0 %, déblocage 500 F), `platform_revenue_entries` (écritures créées par trigger à chaque paiement réussi, écriture inverse au remboursement), `admin_get_fee_settings`, `admin_save_fee_setting`, `admin_revenue_summary`, `admin_revenue_entries`, `admin_backfill_revenue`. `order_service_fee()` et `group_buy_unblock_fee()` lisent désormais les réglages.
- **0065** correction : les paiements de mises en avant étaient refusés (contrainte `payments_exactly_one_target`) et jamais réglés ; branche `sponsorship` ajoutée dans `apply_payment_settlement` (périodes enchaînées, annulation au remboursement). Les 3 formules de mise en avant sont activées.
- **0066** versements et interrupteurs : `payout_accounts`, `creator_payouts`, `save_payout_account`, `my_earnings`, `admin_creator_balances`, `admin_record_payout`, `admin_void_payout` ; gains disponibles à la clôture de la commande, après un délai réglable pour les formations, à la fin de l'événement ou de la séance ; `platform_flags` (`paid_tutoring`, `paid_registration`, désactivés) ; un litige marqué remboursé passe le paiement à « remboursé » et annule le revenu.
- **0067** Boutique Premium : `seller_plans` (3 formules de départ **inactives**, prix indicatifs 2 500 / 6 500 / 24 000 F à ajuster), `seller_subscriptions`, `is_premium_seller`, `premium_seller_ids`, exemption de la commission vendeur, `my_seller_subscription`, `admin_save_seller_plan`, `admin_list_seller_subscriptions`, `admin_cancel_seller_subscription` ; Edge Function `subscription-checkout-initiate`.
- **0068** tutorat payant (derrière `paid_tutoring`) : prix horaire, prix figé à la demande, paiement après acceptation (échéance 24 h, cron `expire-unpaid-tutoring` toutes les 10 min), séance payée annulée = remboursement dû (`admin_list_tutoring_refunds_due`, `admin_mark_tutoring_refunded`), l'élève confirme la fin de séance (le tuteur seulement 72 h après) ; Edge Function `tutoring-checkout-initiate`.
- **0069** inscription payante (derrière `paid_registration`, **remplace** `_prepared/0055_registration_fee.sql` qui ne doit plus être appliqué) : `registration_fees` par pays, `account_registrations`, pays déduit du téléphone vérifié, un compte en attente de paiement n'est pas « actif » (`is_active_account`), équipe exemptée, `get_registration_pricing` (public), `my_registration`, `admin_save_registration_fee`, `admin_list_registration_fees`, `admin_list_registrations`, `admin_exempt_registration` ; Edge Function `registration-checkout-initiate`. Désactiver l'interrupteur libère les comptes en attente.
- **0070** `admin_list_payouts` (historique des versements pour l'écran admin).
- **Aide aux études** : action `study` ajoutée à l'Edge Function `campus-copilot` (déployée en v7, Gemini) : modes `explain`, `summarize`, `quiz`, `chat`, contexte de formation facultatif, 20 requêtes/jour/étudiant ; conversations non sauvegardées côté serveur.

**Écrans (cette livraison)** : `/admin/finances` (entrée « Finances » du menu, visible des administrateurs et du responsable financier), 4 onglets :
- **Revenus** : période 7/30/90 jours, revenu net avec comparaison à la période précédente, volume traité, remboursé, transactions, courbe par jour, tableau par type, part des créateurs, détail paginé filtrable, export CSV.
- **Versements** : soldes à verser / en attente / déjà versé par créateur (compte Mobile Money affiché), enregistrement d'un versement (l'argent est envoyé à la main, l'écran n'en envoie pas), annulation motivée, historique.
- **Remboursements** : séances de tutorat payées puis annulées, à marquer remboursées (renvoi vers « Litiges » pour les commandes).
- **Frais & réglages** (modifiables par les administrateurs seulement) : interrupteurs tutorat payant / inscription payante avec confirmation, frais et commissions (pourcentage, montant fixe, délai avant versement), tarifs d'inscription par pays (54 pays, recherche), formules Boutique Premium (création, modification, activation).
- Fichiers : `src/lib/api/admin-finance.ts`, `src/components/admin/finance/*`, `src/routes/_admin.admin.finances.index.tsx`, `src/components/layout/AdminShell.tsx`.

**Non vérifié** : ces écrans n'ont **pas été compilés ni lancés** (aucune dépendance installable dans cet environnement) ; une vérification partielle de syntaxe n'a rien signalé de bloquant. `routeTree.gen.ts` se régénère au build. Aucun paiement CamPay réel, aucun appel réel à Gemini.

**Écrans encore à écrire (la base est prête)** : groupes de révision, tutorat (annuaire, profil tuteur, demandes, paiement), aide aux études, « Mes gains » et compte de versement (profil), page Boutique Premium, branchement de `/inscription/paiement` (puis `REGISTRATION_PAYMENT_ENABLED`), versements de commission vendeur.

**À finir** : télécharger dans le dépôt les migrations 0062 à 0070 et les fonctions `campus-copilot`, `sponsorship-checkout-initiate`, `subscription-checkout-initiate`, `tutoring-checkout-initiate`, `registration-checkout-initiate` (déployées mais absentes du dépôt) en suivant `supabase/EXPORT_DEPUIS_SUPABASE.md` ; appliquer 0061 dans le SQL Editor.

## v38 — Groupes de révision (écrans utilisateur)
Branchés sur la migration 0062 (aucune nouvelle migration) :
- `/revision` (lien « Groupes de révision » depuis la page Formations) : onglets Découvrir / Mes groupes, recherche (nom, matière, formation), cartes avec places restantes, création d'un groupe (nom, matière, description, 2 à 50 places, formation liée facultative parmi les formations suivies).
- `/revision/$id` : rejoindre / quitter ; membres et séances visibles des membres seulement ; séances à venir avec réponses « J'y vais » / « Peut-être » (liste des participants), séances passées ou annulées repliées ; le lien d'une séance en ligne (https) s'ouvre dans un nouvel onglet ; outils de la propriétaire ou du propriétaire : programmer / annuler une séance (les membres sont notifiés), modifier, archiver, retirer un membre. Quand le propriétaire part, le rôle passe au membre le plus ancien ; le dernier membre archive le groupe (règles de la base).
- Fichiers : `src/lib/api/study-groups.ts`, `src/components/study/*` (GroupCard, GroupFormDialog, SessionDialog), `src/routes/_app.revision.index.tsx`, `src/routes/_app.revision.$id.index.tsx`, lien ajouté dans `src/routes/_app.formations.index.tsx`.
- **Non vérifié** : pas compilé ni lancé (même limite que v37). Les messages d'erreur des règles de la base (`group_full`, `session_in_past`, etc.) sont traduits dans `studyError`.
- **Écrans encore à écrire (base prête)** : tutorat (annuaire, profil tuteur, demandes, paiement), aide aux études (action `study` de `campus-copilot`), « Mes gains » et compte de versement, page Boutique Premium, branchement de `/inscription/paiement`.

## v39 — Tutorat (écrans utilisateur)
Branchés sur les migrations 0063 et 0068 et sur l'Edge Function `tutoring-checkout-initiate` (aucune nouvelle migration) :
- `/tutorat` (lien « Tutorat » depuis la page Formations), 3 onglets (`?onglet=demandes|profil`) :
  - **Trouver un tuteur** : annuaire (recherche matière / nom / filière, filtre de mode), cartes avec note, nombre d'avis, prix ou « Gratuit ».
  - **Mes demandes** : demandes reçues (tuteur) et envoyées (élève) avec leur statut. Tuteur : accepter (date + lieu ou lien) ou refuser, annuler, clôturer. Élève : payer, confirmer la fin de séance, noter, annuler.
  - **Mon profil tuteur** : matières (8 max), présentation, disponibilités, mode, visibilité, prix horaire (le champ n'apparaît que si l'interrupteur `paid_tutoring` est activé). Un profil vérifié est exigé : l'écran renvoie vers `/profil/verification`.
- `/tutorat/$id` : fiche d'un tuteur (matières, présentation, disponibilités, avis) et « Demander une séance » (matière, mode, durée, créneau souhaité, message ; le prix affiché est une estimation, la base fige le prix réel).
- **Paiement** : `usePaymentProcess` accepte désormais `kind: "tutoring" | "subscription" | "registration"` (fonctions `tutoring-`, `subscription-`, `registration-checkout-initiate`) ; la séance payante se règle dans le même circuit Mobile Money que les autres achats (`PaymentFlow`). Les kinds `subscription` et `registration` sont prêts pour les écrans à venir.
- **Règles reprises de la base** : séance payante à au moins 2 h dans le futur ; 24 h pour payer (annulation automatique sinon) ; l'élève confirme la fin de séance, le tuteur seulement 72 h après l'heure prévue ; séance payée annulée = remboursement en cours (traité par l'administration, onglet Remboursements de `/admin/finances`).
- Fichiers : `src/lib/api/tutoring.ts`, `src/components/tutoring/*` (Stars, TutorCard, RequestDialog, TutorProfileForm, RequestDialogs, RequestsList), `src/routes/_app.tutorat.index.tsx`, `src/routes/_app.tutorat.$id.index.tsx`, `src/lib/api/payments.ts` (kinds ajoutés), lien dans `src/routes/_app.formations.index.tsx`.
- **Non vérifié** : pas compilé ni lancé (même limite que v37 et v38) ; aucun paiement CamPay réel.
- **Écrans encore à écrire (base prête)** : aide aux études (action `study` de `campus-copilot`), « Mes gains » et compte de versement, page Boutique Premium, branchement de `/inscription/paiement` (puis `REGISTRATION_PAYMENT_ENABLED`).

## v40 — Aide aux études (écran utilisateur)
Branché sur l'action `study` de l'Edge Function `campus-copilot` (déployée en v7, Gemini 2.5 Flash ; aucune nouvelle migration) :
- `/aide-etudes` (bouton « Aide aux études » depuis la page Formations), 4 modes : **Expliquer** et **Questions** (conversation suivie, l'historique est renvoyé à chaque message, 10 tours maximum côté serveur), **Résumer** (texte collé, 5 à 8 points clés), **Quiz** (3, 5, 8 ou 10 questions à 4 choix, correction affichée à l'écran avec explications et score).
- Cours concerné facultatif : liste des formations suivies activement (le serveur ajoute le titre et le plan au contexte).
- Limites reprises du serveur : message de 8 000 caractères maximum, 20 demandes par jour et par étudiant, budget global partagé ; chaque code d'erreur (`rate_limited_user`, `rate_limited_global`, `quota_exceeded`, `quiz_generation_failed`, `copilot_not_configured`) a son message en français.
- Rien n'est enregistré côté serveur ni en base : la conversation et le quiz disparaissent en quittant l'écran.
- Fichiers : `src/lib/api/study-assistant.ts`, `src/components/study/StudyQuiz.tsx`, `src/routes/_app.aide-etudes.tsx`, lien ajouté dans `src/routes/_app.formations.index.tsx`.
- **Non vérifié** : pas compilé ni lancé (même limite que v37 à v39) ; aucun appel réel à Gemini n'a été testé. `routeTree.gen.ts` se régénère au build.
- **Écrans encore à écrire (base prête)** : « Mes gains » et compte de versement, page Boutique Premium, branchement de `/inscription/paiement` (puis `REGISTRATION_PAYMENT_ENABLED`).
- **À finir** : télécharger migrations 0062 à 0070 et les 5 Edge Functions (`supabase/EXPORT_DEPUIS_SUPABASE.md`), appliquer 0061.

## v41 — Mes gains et compte de versement (écran utilisateur)
Branché sur la migration 0066 (fonctions `my_earnings` et `save_payout_account`, aucune nouvelle migration) :
- `/profil/gains` (liens depuis l'onglet « Mes ventes » du profil et depuis le tableau financier) :
  - **3 soldes** calculés par la base : Disponible, En attente (commande non clôturée, délai avant versement, événement ou séance à venir), Déjà versé.
  - **Compte de versement** : MTN Mobile Money ou Orange Money, numéro au format international (+237…), nom du titulaire ; numéro masqué à l'affichage, modification possible ; alerte si des gains sont disponibles sans compte renseigné.
  - **Versements reçus** (20 derniers, avec référence) et **dernières écritures** (30 : vente, formation, événement, tutorat ; montant, commission, net, date de disponibilité ; les remboursements apparaissent en négatif).
- Les versements sont enregistrés à la main par l'équipe finance (`/admin/finances`, onglet Versements) : l'écran n'envoie jamais d'argent. L'ancien message « versement automatique pas disponible » du tableau financier est remplacé par un renvoi vers Mes gains.
- La base exige un compte actif et la double authentification validée (`mfa_ok`) : sinon l'écran affiche un message clair.
- Fichiers : `src/lib/api/earnings.ts`, `src/routes/_app.profil.gains.tsx`, `src/components/profile/ProfileTabs.tsx`, `src/routes/_app.profil.finances.tsx`.
- **Non vérifié** : pas compilé ni lancé ; aucun test avec un vrai compte créateur. `routeTree.gen.ts` se régénère au build.
- **Écrans encore à écrire (base prête)** : page Boutique Premium, branchement de `/inscription/paiement` (puis `REGISTRATION_PAYMENT_ENABLED`).

## v42 — Boutique Premium (écran utilisateur)
Branché sur la migration 0067 et l'Edge Function `subscription-checkout-initiate` (aucune nouvelle migration) :
- `/boutique-premium` (lien depuis l'onglet « Mes ventes » du profil) : état de l'abonnement (actif avec date de fin et jours restants, ou paiement en attente), ce que comprend Premium (badge, exemption de la commission vendeur, périodes enchaînées), formules actives lues dans `seller_plans` (libellé, durée, prix ; le prix est celui de la base), bouton Choisir / Prolonger, historique des 10 derniers abonnements.
- **Paiement** : `SubscribeDialog` réutilise `PaymentFlow` et `usePaymentProcess` (kind `subscription`) ; l'abonnement n'est actif que quand la base a enregistré le paiement. Une formule choisie à la place d'une autre en attente remplace la précédente (règle de la base).
- **Badge Premium** : affiché sur la page boutique d'un vendeur (`/boutique/$id`) via `premium_seller_ids`. Pas encore affiché sur les cartes d'annonces ni la fiche produit.
- Tant qu'aucune formule n'est activée dans `/admin/finances` (Frais & réglages), la page affiche « Aucune formule pour l'instant » : les 3 formules de départ sont inactives.
- Fichiers : `src/lib/api/premium.ts`, `src/components/premium/SubscribeDialog.tsx`, `src/routes/_app.boutique-premium.tsx`, `src/routes/_app.boutique.$id.tsx` (badge), `src/components/profile/ProfileTabs.tsx` (lien).
- **Non vérifié** : pas compilé ni lancé ; aucun paiement CamPay réel. `routeTree.gen.ts` se régénère au build.
- **Écran encore à écrire (base prête)** : branchement de `/inscription/paiement` (puis `REGISTRATION_PAYMENT_ENABLED`).

## v43 — Paiement de l'inscription (dernier écran maquette branché)
Branché sur la migration 0069 (`my_registration`, `account_registrations`, drapeau `paid_registration`) et l'Edge Function `registration-checkout-initiate` (aucune nouvelle migration).
- **Le commutateur est dans la base, plus dans le code** : la constante `REGISTRATION_PAYMENT_ENABLED` est supprimée. L'admin active « Inscription payante » dans `/admin/finances` (Frais & réglages) et fixe un tarif actif par pays. Drapeau inactif ou pays sans tarif : le compte est « exempt », parcours inchangé (4 étapes).
- **Si le drapeau est actif** : un nouveau compte est `pending_payment`, donc non actif (la base refuse tout). Le tarif n'est connu qu'après vérification du téléphone (le pays se déduit de l'indicatif).
- `/inscription/paiement` : lit `my_registration` ; tarif connu → `PaymentFlow` (Mobile Money, `usePaymentProcess` kind `registration`) ; tarif inconnu (téléphone non vérifié) → renvoi vers `/inscription/telephone` ; rien à payer → renvoi vers `/inscription/compte-cree`. Plus de barre d'étapes 5/5 (l'écran est hors barre).
- `RequireRegistration` (dans `routes/_app.tsx`) renvoie vers `/inscription/paiement` tout compte `pending_payment` qui tente d'ouvrir l'application. Garde d'interface seulement ; en cas d'erreur de lecture elle laisse passer.
- L'étape Université décide de la suite d'après `my_registration` ; la page « Compte créé » affiche « Inscription réglée » seulement si `status = paid`.
- Fichiers : `src/lib/api/registration.ts`, `src/components/auth/RequireRegistration.tsx`, `src/routes/_auth.inscription.paiement.tsx`, `_auth.inscription.universite.tsx`, `_auth.inscription.compte-cree.tsx`, `_app.tsx`, `src/lib/config.ts`, `src/lib/mock-data.ts` (constante factice retirée).
- **Non vérifié** : pas compilé ni lancé ; aucun paiement CamPay réel ; **non testé : la vérification du téléphone par SMS pour un compte `pending_payment`** (si la fonction SMS exige un compte actif, le parcours se bloque : à tester avant d'activer le drapeau). Aucun SMS provider n'est configuré tant que `SMS_PROVIDER` n'est pas défini.
- **Piège à connaître avant d'activer le drapeau** : un compte qui saute la vérification du téléphone (`PHONE_VERIFICATION_REQUIRED = false`) reste `pending_payment` sans tarif, donc bloqué jusqu'à vérification. L'écran l'explique et renvoie vers la vérification.
- **Plus aucun écran maquette connu** dans cette liste. Reste : retrait des `StateSwitcher`/mocks et fichiers morts (`mock-admin`, `mock-support`), migrations 0062 à 0070 + 5 Edge Functions à télécharger, 0061 à lancer, build + test réel de bout en bout (inscription, MFA, super_admin, paiements).

## v44 — Nettoyage des maquettes
- **Supprimés** : `lib/mock-data.ts`, `lib/mock-events.ts`, `lib/mock-social.ts`, `lib/university-directory.ts` (aucun écran de l'app ne les utilisait plus), le composant `StateSwitcher` et la constante `DESIGN_REVIEW_MODE` (variable `VITE_DESIGN_REVIEW` retirée de `.env.example`, `env.d.ts` et `FRONT_BRANCHEMENT.md`), la page de démonstration `/design-system` et `components/design-system/` (elle ne vivait que de données de maquette ; le bouton « Voir le design system » de la page 404 est retiré). `mock-admin` et `mock-support` n'existaient déjà plus.
- **Déplacé** : la navigation (`mainNav`, `secondaryNav`, `NavItem`) est dans `src/lib/navigation.ts`. Les types `Country` et `Stock` viennent de `lib/api/geo.ts` et `lib/domain.ts`. `AuthPage` n'a plus de props `states` / `onStateChange`.
- **`src/routeTree.gen.ts` supprimé** : il était périmé (il ne connaissait ni `/aide-etudes`, ni `/profil/gains`, ni `/boutique-premium`, et pointait vers la page `/design-system` supprimée). Il est régénéré automatiquement au premier `npm run dev` ou `npm run build`.
- Vérifié : aucun import `@/…` ne pointe vers un fichier absent. **Non vérifié** : pas de build réel.
- Si vous voulez garder la page de démonstration du design system, elle est dans le zip v43.

## v45 — Edge Functions dans le dépôt, migration 0061 appliquée, analyse de sécurité (21/10/2026)
- **Edge Functions ajoutées à `supabase/functions/`** (copiées à l'identique du code déployé ; imports `../_shared/…`) : `sponsorship-checkout-initiate`, `subscription-checkout-initiate`, `tutoring-checkout-initiate`, `registration-checkout-initiate`. `campus-copilot` (version 7 en ligne) garde son propre dossier `_shared/` (`cors.ts` avec `jsonResponse`, `rate-limit.ts`). Le `_shared/campay.ts` du dépôt (210 lignes) est plus complet que la copie embarquée en ligne (≈ 65 lignes) mais expose les mêmes `collect` et `detectOperator`. Rien n'a été redéployé : le code en ligne n'a pas changé.
- **Migration 0061 appliquée** sur le projet `kxkxrephkyfpcuanlxen` (fonctions `save_quiz` et `delete_quiz`, additive, aucune donnée touchée). Droits vérifiés : exécutable par les utilisateurs connectés, pas par `anon`.
- **Erreur de numérotation corrigée** : l'inscription payante est la migration **0069** (et non 0068, qui est le tutorat payant).
- **Migrations 0062 à 0070** : toujours à télécharger avec le CLI (`supabase migration fetch`). Le SQL est lisible en ligne (≈ 200 Ko) mais n'a pas été retranscrit à la main pour éviter tout écart.
- **Analyse de sécurité Supabase (conseiller)** — rien de bloquant, à connaître :
  - `act_as_*`, `grant_role`, `revoke_role` appelables par un utilisateur connecté : vérifié, sans danger (booléens pour les règles d'accès ; changement de rôle réservé aux admins, super_admin pour les rôles sensibles, double authentification exigée, journalisé).
  - 139 fonctions `SECURITY DEFINER` appelables par les utilisateurs connectés : attendu (ce sont les RPC de l'app) ; chacune contrôle les droits à l'intérieur. À échantillonner pendant les tests de rôles.
  - 6 tables avec sécurité de ligne activée mais sans politique (`account_registrations`, `creator_payouts`, `payout_accounts`, `platform_flags`, `platform_revenue_entries`, `registration_fees`) : voulu, l'accès passe uniquement par les RPC.
  - **Protection contre les mots de passe compromis désactivée** (Authentification > Mots de passe, réglage du tableau de bord Supabase) : à activer vous-même.
  - 15 fonctions sans `search_path` fixé et l'extension `citext` dans le schéma public : avertissements mineurs, non corrigés.
  - Fonctions lisibles sans connexion (`anon`) : `get_registration_pricing`, `is_account_hidden`, `is_premium_seller`, `is_staff`, `premium_seller_ids`, `sponsored_until`. `premium_seller_ids` sert au badge Premium des pages boutique publiques ; `is_staff(uid)` permet de savoir si un identifiant est du personnel (fuite mineure).

## v46 — Notifications push (OneSignal ou Web Push natif)
- **Migration 0071 appliquée en ligne** (21/10/2026) : tables `push_subscriptions` et `notification_push_queue` (sécurité de ligne activée ; la file est fermée aux clients), fonctions `register_push_subscription` / `remove_push_subscription` (utilisateurs connectés uniquement, 10 appareils maximum), déclencheur `notifications_enqueue_push` sur `notifications` (avale ses erreurs ; `create_notification` n'est PAS modifiée). Droits vérifiés après coup.
- **Fichiers** : `supabase/migrations/0071_push_notifications.sql`, `supabase/functions/push-dispatch/index.ts` (**écrite, NON déployée** : elle attend vos clés), `public/sw.js` (Web Push natif), `public/OneSignalSDKWorker.js` (OneSignal), `src/lib/push.ts`, `src/components/settings/PushSettings.tsx` (carte dans Paramètres > Notifications, masquée tant que le push n'est pas configuré), `src/lib/auth.tsx` (détache l'appareil à la déconnexion), `src/server.ts` (politique de sécurité : ouvre `cdn.onesignal.com` et `*.onesignal.com` seulement si `VITE_PUSH_PROVIDER=onesignal`), `.env.example` et `supabase/functions/.env.example`, `src/env.d.ts`, `supabase/README.md`, **`supabase/PUSH_SETUP.md`** (guide complet : clés, déploiement, planification, tests, limites).
- **Un seul fournisseur à la fois** (`VITE_PUSH_PROVIDER` côté application = `PUSH_PROVIDER` côté fonctions). Le push suit le réglage « Dans l'app » par catégorie. Texte générique, aucun contenu de message chez un tiers.
- **Non vérifié** : jamais exécuté (aucune clé, aucun appareil, pas de build). Le format de l'API OneSignal (`POST /notifications?c=push`, en-tête `Authorization: Key …`, `include_aliases.external_id`) a été confirmé dans leur documentation ; les noms exacts du SDK web v16 (`OneSignalDeferred`, `login`, `User.PushSubscription.optIn`) et l'usage de `npm:web-push@3.6.7` sous Deno restent à essayer. Le champ `idempotency_key` envoyé à OneSignal est à confirmer à l'essai.

## v47 — Pages légales (brouillons à faire valider par un juriste)
- **Nouvelles pages publiques** (visibles avant l'inscription, connecté ou non, sans garde d'accès) : `/conditions`, `/confidentialite`, `/mentions-legales`, dans un layout `_legal` (`src/routes/_legal*.tsx`, `src/components/layout/LegalLayout.tsx`, gabarit `src/components/legal/LegalDoc.tsx` avec sommaire).
- **Liens branchés** : le formulaire d'inscription (cases « conditions d'utilisation » et « politique de confidentialité », ouverts dans un nouvel onglet pour ne pas perdre le formulaire), le pied de page des écrans d'authentification, un pied de page dans l'application (`AppShell`), et le pied de page des pages légales (`LegalLinks`). Plus aucun de ces liens ne pointe vers `/aide`.
- **Textes adaptés à CampusMarket** (marketplace, paiements Mobile Money via CamPay avec encaissement puis reversement, formations, tutorat, groupes, événements, assistant d'étude IA, Premium et sponsoring, modération, export des données, base hébergée en UE-Irlande, prestataires), mais **ce sont des brouillons**.
- **Où compléter** : `src/lib/legal.ts` (identité de l'éditeur, adresse, immatriculation, contacts, hébergeur, droit applicable, juridiction, âge minimum). Tant qu'une valeur reste entre crochets `[...]`, elle s'affiche en surbrillance jaune sur la page. Les passages `[À VALIDER…]` / `[À COMPLÉTER…]` sont dans les fichiers `_legal.*.tsx` (délais de reversement, remboursements, durées de conservation, transferts, autorité de protection des données, etc.).
- **Mise en ligne** : après relecture par un juriste, passer `LEGAL.reviewed` à `true` dans `legal.ts` : le bandeau « texte provisoire » disparaît.
- **Ce que le brouillon affirme et qui est à vérifier** : aucun outil d'analyse d'audience ni traceur publicitaire (aucun trouvé dans le code), prestataires cités (Supabase, CamPay, Google pour l'assistant ; e-mail, SMS et hébergeur du site laissés à confirmer), référence à la loi camerounaise n° 2024/017 du 23 décembre 2024 (marquée à vérifier).
- **Non vérifié** : pas de build ; `routeTree.gen.ts` se régénère au prochain `npm run dev` ou `build` et connaîtra alors les 3 nouvelles routes.

## v48 — OneSignal : identifiants reçus, prise en charge de `safari_web_id`
- OneSignal choisi comme fournisseur push. `VITE_ONESIGNAL_APP_ID` et l'identifiant Safari web sont **publics** (ils se trouvent dans le code envoyé au navigateur) : à saisir comme variables d'environnement du site (build). La **clé API REST** OneSignal, elle, est secrète : uniquement dans les secrets Supabase (`ONESIGNAL_API_KEY`), jamais dans le dépôt, le front ou une conversation.
- `src/lib/push.ts` passe `safari_web_id` à OneSignal quand `VITE_ONESIGNAL_SAFARI_WEB_ID` est défini. Le bouton-cloche intégré de OneSignal reste désactivé (`notifyButton.enable: false`) : l'application a sa propre carte dans Paramètres > Notifications.
- `public/OneSignalSDKWorker.js` : identique au fichier fourni par OneSignal (une seule ligne `importScripts`), rien à remplacer. Après déploiement, il doit s'ouvrir sur `https://campusmarket.me/OneSignalSDKWorker.js`.
- **Brevo** : le code d'envoi du projet (`_shared/email.ts`) appelle l'API HTTP de Brevo, qui attend une **clé API** (commençant par `xkeysib-`). Une clé **SMTP** (`xsmtpsib-`) ne convient pas à cet usage ; elle sert aux réglages SMTP de Supabase Auth (codes d'inscription et de récupération). Les deux clés sont à créer dans Brevo (SMTP et API) et à ne saisir que dans les secrets Supabase ou dans Authentication > SMTP.

## v49 — Installation de l'application (PWA)
- **Ce que c'est** : CampusMarket s'installe depuis le navigateur comme une application (fenêtre dédiée, icône sur le bureau, le Dock ou l'écran d'accueil), sans magasin d'applications ni fichier `.exe` / `.dmg`. C'est le même site : les mises à jour sont automatiques, une connexion internet reste nécessaire (pas de mode hors ligne).
- **Fichiers** : `public/manifest.webmanifest` (nom, couleurs, affichage « standalone », 3 raccourcis : Marketplace, Formations, Messages), `public/icons/` (icon-192, icon-512, icon-maskable-512, apple-touch-icon), `src/lib/pwa.ts` (garde l'événement « installer » du navigateur), `src/components/settings/InstallApp.tsx` (carte « Application sur votre appareil » dans Paramètres > Général), bouton « Installer l'application » dans la barre latérale (visible seulement si le navigateur le permet en un clic), `src/routes/__root.tsx` (liens du manifeste et de l'icône iOS).
- **Aucun service worker ajouté, volontairement** : Chrome, Edge et Safari récents n'en exigent pas pour installer, et un second service worker entrerait en conflit avec celui des notifications push (un seul par site).
- **Navigateurs** : Chrome et Edge (ordinateur, Android) : bouton d'installation en un clic. Safari Mac : « Ajouter au Dock ». iPhone et iPad : Partager, puis « Sur l'écran d'accueil ». Firefox sur ordinateur : pas d'installation.
- **À remplacer** : les icônes ont été produites en agrandissant `public/favicon.png` (64 px) : elles sont un peu floues. Le **fichier du logo d'origine est absent du projet** : `src/assets/campusmarket-logo.jpg.asset.json` n'est qu'une référence vers un fichier hébergé sur l'ancienne plateforme, et son adresse (`/__l5e/assets-v1/…`) renvoie la page de connexion sur campusmarket.me (vérifié). Le grand logo ne s'affiche donc pas sur le site en ligne. Fournir le logo d'origine (PNG carré, 1024 px idéalement) pour régénérer les icônes et le corriger.
- **Non vérifié** : pas de build ni d'installation réelle. Le manifeste n'est pas encore en ligne (`/manifest.webmanifest` renvoie aujourd'hui la page de connexion : version non déployée). Test à faire après déploiement : Chrome > outils de développement > Application > Manifeste (aucune erreur), icône d'installation dans la barre d'adresse, installation puis ouverture dans sa fenêtre.

## v50 — Migrations 0062 à 0070 ajoutées au dépôt
- **Ajoutées dans `supabase/migrations/`** : `0062_sponsored_listings`, `0062_study_groups`, `0063_tutoring`, `0064_monetization_fees_revenue`, `0065_fix_sponsorship_payments`, `0066_payouts_flags_availability`, `0067_seller_premium`, `0068_paid_tutoring`, `0069_paid_registration`, `0070_admin_list_payouts`. Avec `0071_push_notifications`, la suite 0061 à 0071 est maintenant complète dans le dépôt.
- **Fidélité vérifiée** : SQL lu directement dans `supabase_migrations.schema_migrations` du projet en ligne ; longueur et MD5 comparés fichier par fichier : identiques.
- **Déjà appliquées en ligne : ne pas les rejouer** sur `kxkxrephkyfpcuanlxen` ; elles servent à recréer une base neuve (dans l'ordre des noms de fichiers).
- **Deux fichiers `0062_*`** : même numéro, appliqués dans l'ordre alphabétique (sponsored_listings puis study_groups). `0060` et `0060b` suivent déjà ce principe.
- **Restent hors dépôt** : rien côté migrations. `_prepared/0055_registration_fee.sql` reste à ne pas appliquer (remplacée par 0069).
- **Non testé** : rejouer toute la suite sur une base vide (à faire une fois avec `supabase db reset` en local ou une branche Supabase pour confirmer que l'ordre 0001 à 0071 passe sans erreur).

## v51 — Code de vérification du téléphone envoyé par e-mail
- **Décision** : en attendant un prestataire SMS ou WhatsApp, le code à 6 chiffres de `phone-otp-request` part **à l'adresse e-mail du compte** (variable `OTP_DELIVERY`, défaut `email` ; `sms` reste disponible quand `_shared/sms.ts` sera implémenté). Le code reste haché en base, jamais journalisé, valable 10 minutes, mêmes limites anti-abus.
- **Réponse de la fonction** : `delivery` et `sent_to` (adresse masquée, ex. `ca***@gmail.com`) ; nouvelle erreur `delivery_error` (502) à la place de `sms_provider_error` ; `no_email_on_account` (422) si le compte n'a pas d'e-mail.
- **Déployée en ligne** : `phone-otp-request` v3 sur `kxkxrephkyfpcuanlxen` (avec `_shared/email.ts`). **Rien ne partira tant que les secrets e-mail ne sont pas saisis** dans Supabase (Edge Functions > Secrets) : `EMAIL_PROVIDER=brevo`, `EMAIL_API_KEY` (clé API `xkeysib-…`, pas la clé SMTP `xsmtpsib-…`), `EMAIL_FROM` (expéditeur validé chez Brevo). Optionnel : `OTP_DELIVERY=email`.
- **Écrans adaptés** : « Quel est votre numéro ? » et « Entrez le code reçu par e-mail » ; la config et `.env.example` mises à jour.
- **Limite à connaître** : ce mode prouve l'accès à la boîte e-mail, **pas la possession du numéro**. Conséquences : `phone_verified` n'a plus la même valeur ; le pays déduit du numéro (tarif d'inscription payante, migration 0069) peut être choisi librement par l'utilisateur ; l'unicité du numéro entre comptes reste appliquée. À reconsidérer avant d'activer `paid_registration` ou le tutorat payant (WhatsApp/SMS, ou contrôle à la première transaction Mobile Money).
- **Vérifié côté Supabase** (advisor sécurité du 24/10/2026) : la **protection contre les mots de passe compromis est désactivée** (fonction réservée au plan Pro). Site URL / Redirect URLs, confirmation d'e-mail et longueur du mot de passe ne sont pas lisibles depuis l'extérieur : à contrôler dans Authentication du tableau de bord.
- **Non testé** : aucun e-mail réellement envoyé.

## v52 — Vrai logo : favicon, icônes d'application, image de partage
- **Source** : le logo fourni (main qui tend des billets, cercle bleu sur fond noir, PNG 1254 x 1017) a été recadré en carré autour du cercle (fond `#00030c`, laissé tel quel).
- **Générés dans `public/`** : `logo.png` (512), `favicon.ico` (16/32/48), `favicon-48.png`, `favicon-96.png`, `favicon-192.png` (multiples de 48 px, exigés par Google), `favicon.png` (96, ancienne adresse conservée), `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png` (logo à 72 % dans la zone sûre), `icons/apple-touch-icon.png` (180), `og-image.png` (1200 x 630, aperçu des liens partagés).
- **Code** : `__root.tsx` déclare les favicons, `og:image` / `twitter:image`, `og:site_name`, couleur du thème `#00030c` (et `twitter:site` « @Lovable » retiré) ; `Logo` (`brand.tsx`) lit désormais `/logo.png` ; `manifest.webmanifest` : fond `#00030c` ; fichier `campusmarket-logo.jpg.asset.json` (adresse `/__l5e/…` morte) supprimé.
- **Google** : le favicon n'apparaît dans les résultats qu'après un nouveau passage du robot, de quelques jours à quelques semaines. Après le déploiement : vérifier que `https://campusmarket.me/favicon.ico` s'ouvre, puis dans Google Search Console > Inspection de l'URL > « Demander une indexation » pour `https://campusmarket.me/`.
- **Non vérifié** : build non lancé ; rendu réel du logo dans l'app et sur Google non constaté.

