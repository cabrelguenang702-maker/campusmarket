# CampusMarket — état du branchement front ↔ Supabase (livraison intermédiaire v24)

Cette livraison est un **point d'étape**, pas la version finale : une partie des écrans lit et écrit dans Supabase, le reste
tourne encore sur des données de démonstration (mocks). **Rien n'a été compilé** (pas de réseau dans l'environnement de
travail) : seules la syntaxe des fichiers TypeScript et la résolution des imports ont été vérifiées. Premier réflexe : `npm install && npm run build`,
puis corriger les erreurs de types éventuelles. `src/routeTree.gen.ts` se régénère tout seul au premier `npm run dev`/`build`
(des routes ont été ajoutées, par exemple `/admin/securite`).

## Base de données (projet Supabase kxkxrephkyfpcuanlxen)
Migrations 0001–0021 d'origine + **0022 à 0051 ajoutées ici, déjà appliquées** sur le projet et testées avec de vrais rôles
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
d'adhésion, onglets « Mes communautés / Mes groupes » du profil), **aide et support** (FAQ publique, création de ticket avec capture, conversation, pièces jointes, fermeture), **universités** (annuaire avec recherche et filtres région / pays / ville, fiche d'une
université avec ses annonces et ses événements à venir).

## Encore sur des données de démonstration
Achats groupés (participation, paiement, création, clôture), onboarding/inscription (paiement), tout le back-office admin (dont l'écran support du personnel, `/admin/support`, qui lit encore `mock-support`).

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

## Achats groupés — étape 1 : lecture (v21)
- **Branché** : onglet « Achats groupés » de la marketplace et page `/produit/<id>/achat-groupe` (progression, palier courant, prochains
  paliers, échéance, statut, participants visibles seulement des participants et du vendeur).
- **Pas encore possible** : rejoindre, payer, créer un achat groupé, clôturer à l'échéance. Le bouton « Rejoindre » est volontairement désactivé.
- **Pourquoi** : le paiement CamPay du projet sait ENCAISSER (`collect`) mais pas REMBOURSER ; or l'ancien écran promettait un
  remboursement automatique de la différence de palier et un remboursement intégral si l'objectif n'est pas atteint. Rien dans le projet
  ne peut tenir cette promesse. Décision attendue (voir le message de livraison) avant de brancher la participation.

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
- Les avatars déjà envoyés dans l'ancien bucket privé ne s'afficheront pas : aucun n'existait (l'envoi n'était pas branché).
- **Les annonces publiées passent par la modération** : statut `pending_review` ; un admin doit les valider.
- **Frais de service 2 %** repris de la maquette (`order_service_fee`, migration 0034) : à confirmer.
- **Aucun versement au vendeur** n'est prévu en base (seulement le journal des paiements).
- Pas de présence « en ligne » ni de notifications push (rien en base).
- Preflight : 1 contrôle en échec tant qu'il n'y a pas de `super_admin` ; il faut aussi activer le MFA de ce compte
  (`/admin/securite`) et reporter les secrets d'Edge Functions (`PAYMENTS_RECONCILE_SECRET`, `NOTIFICATIONS_DISPATCH_SECRET`,
  `CAMPAY_WEBHOOK_KEY`, `ALLOWED_ORIGIN`). Voir `supabase/PRODUCTION.md`.
- Bucket orphelins `listing-media`, `chat-attachments`, `formation-content` : fermés et vides, supprimables depuis le dashboard.
