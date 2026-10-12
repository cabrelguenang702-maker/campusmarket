# CampusMarket — prototype UI

Prototype responsive construit à partir du master des écrans et états (`CampusMarket_Master_Liste_Pages_Visuelles_Frontend.docx`).

## Lancer le projet

```bash
bun install   # met aussi à jour bun.lock (@boxicons/react ajouté, lucide-react retiré)
bun run dev
```

## Avancement

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Design system et composants globaux | Terminée |
| 2 | Authentification et onboarding | Terminée |
| 3 | Marketplace, produit, vendeur, checkout, achats groupés, publication, « Je recherche » | Terminée |
| 4 | Messagerie, profil, favoris, notifications, paramètres, vérification du compte | Terminée |
| 5 | Academy / formations | Terminée |
| 6a | Communautés et groupes | Terminée |
| 6b | Événements (billetterie, contrôle des billets) | Terminée |
| 7 | Annuaire des universités et centre d'aide | Terminée |
| 8a | Admin — tableau de bord et gestion des utilisateurs | Terminée |
| 8b à 8d | Admin — annonces, universités, géographie, statistiques, support, paramètres | Terminée |
| 9 | Audit transversal : états d'erreur/chargement/vide et responsive | Terminée |
| 10 | Branchement au backend existant | Amorcée |

Les routes du master pas encore construites affichent un écran « en cours de conception » (`src/routes/_app.$.tsx`), alimenté par `src/lib/planned-routes.ts`. Chaque phase livrée retire ses routes de cette liste.

## Architecture

```
src/
  components/
    icons.ts            registre unique des icônes (Boxicons officiels, aucun emoji)
    cm/                 composants métier du design system (badges, commerce, forms, feedback, screens)
    layout/             AppShell (sidebar, header, nav mobile), AuthLayout, PageHeader
    auth/               AuthPage (gabarit d'écran), OtpStep (saisie du code)
    design-system/      sections de la page /design-system
    ui/                 primitives shadcn (adaptées aux tokens)
  lib/
    theme.tsx           thème clair / sombre / automatique (sans flash au chargement)
    mock-data.ts        données de maquette (produits, universités, pays…)
    onboarding.tsx      état de l'inscription partagé entre les écrans
    config.ts           DESIGN_REVIEW_MODE
  routes/
    _app.*              écrans avec sidebar (accueil, design-system, 404, accès refusé…)
    _auth.*             écrans d'authentification (bienvenue, inscription, connexion, récupération)
```

## Points clés

- **Thèmes** : `:root` = clair, `.dark` = sombre (identité de marque). Choix mémorisé, mode automatique inclus. Tokens sémantiques dans `src/styles.css` (dont `success`, `warning`, `info`).
- **Icônes** : uniquement `@boxicons/react`, toujours importées depuis `@/components/icons`. Pour en ajouter une, ajouter une ligne d'export dans ce fichier.
- **Mode revue de design** : `DESIGN_REVIEW_MODE` (`src/lib/config.ts`) affiche sur chaque écran la barre « Maquette · états de l'écran » pour basculer entre chargement, erreur, succès, etc. Passer à `false` avant le branchement backend.
- **Codes de test** : à l'étape OTP, `000000` simule un code incorrect, tout autre code complet est accepté.
- **Frais d'inscription** : `REGISTRATION_FEE` dans `mock-data.ts` est une valeur de maquette.
- **Liens** : `AppLink` accepte un `string` pour les routes pas encore construites ; à resserrer au fil des phases.
- **Logo** : l'image vient de l'asset Lovable ; hors Lovable, `/favicon.png` sert de repli. Déposer le vrai fichier dans `public/` et pointer `Logo` dessus.

## Phase 3 — routes et états (numéros du master)

Chaque écran a sa barre « Maquette · états de l'écran ». Les états ci-dessous y sont tous accessibles.

| Route | États couverts |
| --- | --- |
| `/marketplace` (`?q=`, `?categorie=`, `?tri=`, `?vue=groupes`) | 42–48 accueil, recherche, résultats, filtres ouverts, filtres avancés, tri, catégorie ; 79 liste des achats groupés ; chargement, vide, filtres sans résultat, erreurs ; « afficher plus » (infinite scroll) |
| `/produit/:id` | 49–55 détail, galerie plein écran, offre du vendeur, indisponible, vendu, réservé, expiré ; chargement, introuvable, erreur |
| `/produit/:id/acheter` | 68–78 récapitulatif, informations acheteur, choix du paiement, paiement Mobile Money, en attente, confirmé, échoué, commande confirmée, annulée, produit indisponible |
| `/produit/:id/achat-groupe` | 80–89 détail, progression, participants, paliers, rejoindre, paiement, groupe complet, expiré, réussi, échoué |
| `/boutique/:id` | 56–57 boutique, annonces du vendeur (filtres), avis, à propos ; sans annonce, chargement, introuvable, erreur |
| `/publier` | 58–64 informations, photos (envoi réel avec aperçu), caractéristiques, prix, aperçu, publication réussie, erreur ; erreurs de saisie |
| `/je-recherche` | 65–67 liste des demandes, création, résultats correspondants ; aucune demande, aucun résultat |

Composants ajoutés : `PaymentFlow` (parcours Mobile Money réutilisable en 6 états), `Stepper`, `ProductGallery`, `GroupProgress`, `FiltersPanel`, `OrderSummary`. Ils sont documentés dans l'onglet « Composants » de `/design-system`.

Données de maquette : `src/lib/mock-data.ts` (produits, vendeurs, achats groupés, demandes) et `src/lib/catalog.ts` (filtres et tris, à remplacer par les requêtes backend). Les frais de service (2 %) et les prix sont des valeurs de maquette.

## Phase 4 — routes et états (numéros du master)

| Route | États couverts |
| --- | --- |
| `/messages`, `/messages/:id` | 90–103 liste, conversation, nouvelle conversation, recherche d'utilisateur, conversation vide, envoi, pièce jointe (envoi réel avec aperçu), aperçu, message envoyé, échec (avec « Réessayer »), utilisateur bloqué, archivée / supprimée, hors connexion ; chargement |
| `/profil` (`?onglet=`, `?vue=`) | 104–115 profil, profil public, modifier le profil, modifier la photo, informations personnelles, mes annonces / achats / ventes / demandes / groupes / communautés / événements ; sections vides, chargement |
| `/profil/annonces`, `/profil/achats` | redirigent vers les onglets de `/profil` (liens existants conservés) |
| `/favoris` | 116–120 favoris, favoris vides, produit retiré, produit supprimé / indisponible ; chargement, erreur |
| `/notifications` | 121–132 centre, non lues, lues, vides, les sept types (filtres), paramètres des notifications ; chargement, erreur |
| `/profil/parametres` (`?section=`) | 133–150 général, langue, thèmes clair / sombre / automatique (réels), confidentialité, notifications, sécurité, changer le mot de passe, activation 2FA (intro, QR, confirmation, codes de secours), désactivation 2FA, appareils, historique, déconnexion des autres appareils, désactivation du compte et confirmation |
| `/profil/verification` | 151–160 statut, choix du document, carte étudiante (recto/verso), autre document, aperçu, en cours, réussie, refusée, nouvelle vérification, compte vérifié |

Points techniques :
- **Favoris** : `src/lib/favorites.tsx` est un magasin global (mémorisé dans le navigateur). Tous les cœurs de la plateforme l'utilisent. Il contient des favoris de démonstration (annonces vendue, expirée, retirée, supprimée).
- **Messagerie** : `/messages` est un layout (liste + conversation). Codes de test : dans la saisie du code 2FA, `000000` est incorrect ; dans le changement de mot de passe, `incorrect` comme mot de passe actuel simule l'erreur.
- **QR 2FA** : `MockQr` est un motif de démonstration, à remplacer par un vrai générateur de QR code.
- **Icônes** : nouveaux alias dans `src/components/icons.ts`.
- Données de maquette : `src/lib/mock-social.ts` (conversations, notifications, commandes, appareils…).

## Phase 5 — routes et états (numéros du master)

| Route | États couverts |
| --- | --- |
| `/formations` (`?q=`, `?categorie=`, `?vue=mes`, `?tri=`) | 161–163 catalogue, recherche, filtres (niveau, prix, durée, note) ; « Mes formations » (en cours / terminées) ; aucun résultat, vide, chargement, erreurs |
| `/formations/:id` | 164–169 présentation, modules, progression, inscription (gratuite ou paiement Mobile Money), formation en cours ; avis ; formation terminée ; chargement, introuvable, erreur |
| `/formations/:id/modules/:moduleId` | 170–178 lecteur vidéo (lecture, ±10 s, vitesse, sous-titres), PDF (pages, zoom), article (progression de lecture), module terminé, module suivant (lecture automatique), module verrouillé, progression de la formation, formation terminée |
| `/formations/:id/certificat` | 179–181 certificat, aperçu plein écran, téléchargement (PNG réel) et impression (PDF via l'impression du navigateur) ; certificat indisponible tant que la formation n'est pas terminée |

Points techniques :
- **Progression** : `src/lib/academy.tsx` est un magasin global mémorisé dans le navigateur (inscriptions, modules terminés). Les modules se débloquent dans l'ordre. Données de démonstration : « Design UI avec Figma » terminée, « Développement web avec React » en cours (3/8), « Excel pour étudiants » commencée.
- **Contenus** : `src/lib/mock-academy.ts` (formations, modules, articles de démonstration). Les lecteurs vidéo et PDF sont des maquettes interactives ; à brancher sur les vrais médias.
- **Certificat** : dessiné en HTML à taille fixe puis mis à l'échelle (`CertificatePaper`). L'impression utilise le CSS `@media print` de `styles.css`. Le QR est un motif de démonstration (`MockQr`).
- **Dialogues** : `Dialog` et `AlertDialog` contraignent maintenant leur contenu à la largeur de l'écran (correctif mobile).

## Phase 6a — Communautés et groupes (numéros du master)

| Route | États couverts |
| --- | --- |
| `/communautes` (`?q=`, `?categorie=`) | 182–183 liste, recherche, filtres par catégorie ; aucun résultat, vide, chargement, erreur |
| `/communautes/:id` | 184–189, 192–194, 197 fil de publications, créer une publication (texte + image), commentaires, réactions (5 types), rejoindre / quitter, communauté privée verrouillée, bandeau de modération ; chargement, introuvable, erreur |
| `/communautes/:id/membres` | 190–191, 196 liste des membres (recherche, filtre par rôle), profil (renvoie vers la boutique du vendeur), retirer un membre, promotion/rétrogradation modérateur |
| `/groupes`, `/groupes/:id`, `/groupes/:id/membres` | 198–212 mêmes écrans et états que les communautés, avec administrateurs/modérateurs |

Points techniques :
- **Adhésions et publications** : `src/lib/community.tsx` est un magasin global mémorisé dans le navigateur (statut de membre par personne et par espace, réactions, commentaires ajoutés, publications créées, épinglage, suppression, exclusion). Les changements de rôle par un autre membre que soi sont bien reflétés dans la liste.
- **Cohérence des données** : les communautés/groupes utilisés dans les liens du profil et de l'accueil (`developpeurs-cameroun`, `iutfv-informatique`, `bons-plans-bandjoun`, `entrepreneurs-campus`) sont repris avec le même id dans `src/lib/mock-community.ts`, donc les liens existants fonctionnent déjà.
- **Réactions** : 5 types (J'aime, J'adore, Haha, Triste, Grrr) via un popover sur le bouton principal.
- **Rôles** : administrateur, modérateur, membre — gérés depuis la page Membres (visible seulement pour les administrateurs/modérateurs).

## Phase 6b — Événements, billetterie et contrôle des billets (numéros du master)

| Route | États couverts |
| --- | --- |
| `/evenements` (`?q=`, `?categorie=`) | 213–217 liste, recherche, filtres par catégorie ; aucun résultat, vide, chargement, erreur |
| `/evenements/creer` | 218–224 informations (nom, catégorie, description, affiche), lieu et date, billetterie (gratuit ou payant, capacité), aperçu avant publication, validation des champs, publication en cours, réussie, erreur serveur |
| `/evenements/:id` | 225–231 présentation, programme, lieu, billetterie (inscription gratuite ou paiement Mobile Money), billet électronique avec QR une fois inscrit, événement complet, annulé, terminé ; introuvable, chargement, erreur |
| `/evenements/:id/controle` | 232–237 scanner QR (maquette caméra), saisie manuelle du code, billet valide / déjà contrôlé / invalide, liste des participants avec recherche et contrôle manuel, compteur de progression, tous les billets contrôlés |

Points techniques :
- **Inscriptions et billets** : `src/lib/events.tsx` est un magasin global mémorisé dans le navigateur (inscription par événement, codes de billets, billets déjà contrôlés à l'entrée). Le code du billet est déterministe (`CM-<événement>-MOI-<id>`) pour rester stable d'une session à l'autre.
- **Cohérence des données** : les événements liés depuis l'accueil et le profil (`hackathon-campus-2026`, `soiree-rentree`) sont repris avec le même id dans `src/lib/mock-events.ts` ; le profil affiche déjà « Billet prêt » pour le hackathon, cohérent avec le magasin (préinscrit par défaut).
- **Billetterie** : réutilise le composant `PaymentFlow` (Mobile Money) déjà construit pour les achats et les formations payantes ; un événement gratuit délivre directement le billet sans étape de paiement.
- **Billet électronique** : `ETicket` (QR de démonstration `MockQr`, code affiché en clair, actions Télécharger/Partager).
- **Contrôle des billets** : `ScannerFrame` est une maquette de viseur caméra (aucun accès caméra réel) — à brancher sur une librairie de scan QR au moment du branchement backend. Le bouton « Simuler un scan » contrôle automatiquement le prochain billet non encore validé, pour démontrer le flux sans caméra. La saisie manuelle et le clic « Contrôler » dans la liste des participants utilisent la même validation.

## Phase 7 — Annuaire des universités et centre d'aide (numéros du master)

| Route | États couverts |
| --- | --- |
| `/universites` (`?q=`, `?pays=`, `?region=`, `?ville=`) | Liste, recherche, filtres pays / région / ville ; aucun résultat, vide, chargement, erreur |
| `/universites/:id` | Profil de l'université (statistiques, ville, pays), annonces marketplace et événements à venir sur ce campus ; introuvable, chargement, erreur |
| `/aide` (`?onglet=`, `?q=`, `?categorie=`) | FAQ par catégorie, recherche, aucun résultat ; onglet Mes tickets, aucun ticket ; nouveau ticket (formulaire, envoi, réussite) ; chargement, erreur |
| `/aide/:id` | Conversation avec le support (texte, pièces jointes), réponse, marquer résolu / rouvrir ; ticket résolu, fermé ; introuvable, chargement, erreur |

Points techniques :
- **Annuaire** : `src/lib/university-directory.ts` enrichit les données `universities` déjà utilisées à l'inscription (`src/lib/mock-data.ts`) avec régions et drapeaux, sans dupliquer la liste. Le profil d'une université croise en direct les annonces (`campus` du produit) et les événements (`campus` de l'événement) déjà construits dans les phases précédentes.
- **Centre d'aide** : `src/lib/mock-support.ts` contient les catégories, la FAQ et des tickets de démonstration. La conversation d'un ticket réutilise le composant `Bubble` déjà construit pour la messagerie (`src/components/messages/Bubble.tsx`), donc le rendu des pièces jointes et des statuts reste cohérent avec le reste de l'application.
- **Nouveau ticket** : `NewTicketDialog` (sujet, catégorie, description, pièce jointe simulée) débouche sur un ticket consultable immédiatement via son lien.

## Phase 8a — Administration : tableau de bord et utilisateurs (numéros du master)

| Route | États couverts |
| --- | --- |
| `/admin` | Statistiques clés (étudiants, universités, annonces, événements, tickets, signalements, volume Mobile Money), graphique d'activité hebdomadaire, alertes, signalements récents ; chargement, erreur |
| `/admin/utilisateurs` (`?q=`, `?statut=`) | Recherche, filtres par statut, vérification de compte, suspension, réactivation, bannissement (avec confirmation) ; aucun résultat, vide, chargement, erreur |

Points techniques :
- **Espace dédié** : nouveau groupe de routes `_admin` (`src/routes/_admin.tsx`) avec son propre shell `AdminShell` (sidebar Utilisateurs / Annonces / Universités / Géographie / Statistiques / Support / Paramètres), distinct de l'application étudiante mais réutilisant `UserMenu`, `ThemeToggle` et `NotificationsMenu` déjà construits.
- **Données** : `src/lib/mock-admin.ts` (utilisateurs, signalements, alertes, activité hebdomadaire). Les statistiques du tableau de bord agrègent en direct les compteurs réels des autres modules déjà construits (universités, annonces, événements, tickets support).
- **Graphique** : premier usage du wrapper `ChartContainer` (shadcn/recharts) déjà présent dans le projet mais pas encore utilisé.
- **Actions utilisateurs** : vérification, suspension, réactivation et bannissement mettent à jour l'état local immédiatement (démo sans backend), avec confirmation via `ConfirmDialog` pour les actions sensibles.

## Phase 8b à 8d — Administration : annonces, universités, géographie, statistiques, support, paramètres

| Route | États couverts |
| --- | --- |
| `/admin/annonces` | Liste des annonces (approuver, mettre en attente, retirer), onglet Signalements (traiter/rejeter) ; recherche, aucun résultat, vide, chargement, erreur |
| `/admin/universites` | Liste, ajout/modification (formulaire), retrait avec confirmation, recherche ; aucun résultat, vide, chargement, erreur |
| `/admin/geographie` | Onglets Pays (ajout/modification/suppression, région, indicatif) et Villes (lecture, nombre d'universités) ; recherche, aucun résultat, chargement, erreur |
| `/admin/statistiques` | Croissance des inscriptions (courbe), activité hebdomadaire (barres), répartition par catégorie (camembert), top campus par annonces (barres), export CSV réel ; chargement, erreur |
| `/admin/support` | Vue maître-détail de tous les tickets, assignation à un agent, historique interne, conversation (réutilise `Bubble`) ; recherche, aucun résultat, vide, chargement, erreur |
| `/admin/parametres` | Onglets Équipe & rôles (invitation, changement de rôle, retrait), Journal d'audit, Sécurité (2FA, sessions actives) |

Points techniques :
- Les actions de modération (statuts d'annonce, ajout/suppression d'université ou de pays, assignation de ticket, invitation d'équipe) mettent à jour un état React local — cohérent avec le reste du prototype qui simule le comportement sans backend.
- `/admin/statistiques` télécharge un vrai fichier CSV généré côté client (`Blob` + lien de téléchargement), fonctionnel dès l'aperçu, sans dépendance serveur.
- La phase 8 (back-office administrateur) est maintenant complète dans son ensemble.

## Phase 9 — Audit transversal (états et responsive)

Contrairement aux phases précédentes, la phase 9 ne crée pas de nouvel écran : c'est une revue de l'ensemble des écrans déjà livrés (phases 1 à 8).

Vérifications effectuées :
- **États** : chaque route listant des données possède déjà un sélecteur d'états (chargement, vide, aucun résultat, erreur) depuis sa phase d'origine — vérifié par un contrôle automatique sur les 66 routes du projet. Les seules routes sans sélecteur sont légitimes : pages d'erreur elles-mêmes (`404`, `accès refusé`), redirections d'anciens liens, panneau vide de la messagerie, vitrine du design system, et la page Paramètres admin (pas de liste de données).
- **Responsive** : audit des largeurs fixes, des grilles et de la balise viewport sur l'ensemble du projet, avec un focus sur le module admin (phase 8, le plus récent). Correction d'un cas réel : la ligne d'un membre d'équipe dans `/admin/parametres` (avatar + email + sélecteur de rôle + bouton de suppression) pouvait déborder sur un écran très étroit faute de retour à la ligne ; le sélecteur passe désormais en pleine largeur sur mobile et repasse à une largeur fixe à partir de `sm:`.
- Aucune table HTML brute dans le projet (tout est en cartes/listes, naturellement adapté au mobile), et les graphiques (`ChartContainer`) sont déjà responsives via `ResponsiveContainer`.

`tsc` et `vite build` passent sans erreur après ces vérifications.

## Phase 10 (amorce) — Backend Supabase

À partir des documents fournis (`CampusMarket_Backend_Hardened_Security_Edition.docx`,
`CampusMarket_Plan_de_Tests_Complet_E2E_Securite_V2_Enrichi.docx`), un premier socle
backend réel a été ajouté dans `supabase/` : schéma PostgreSQL + Row Level Security pour
l'identité (profils publics/privés, provisioning automatique à l'inscription), la
géographie (pays, universités — alimente `/universites`), le marketplace (catégories,
annonces, médias) et le commerce (commandes avec remise en main propre, achats groupés
avec paliers de prix). Détails complets, décisions et prochaines étapes dans
`supabase/README.md`.

Chaque migration a été exécutée et validée sur un PostgreSQL local (schéma `auth` simulé)
plutôt que simplement écrite : `supabase/tests/smoke_test.sql` vérifie que le provisioning
automatique fonctionne et qu'un utilisateur ne peut ni lire les données privées d'un
autre, ni créer une annonce en usurpant son identité ; `supabase/tests/orders_rls_test.sql`
vérifie qu'un acheteur ne peut jamais s'auto-valider un paiement et qu'un vendeur ne peut
agir sur une commande que dans l'état où il est censé intervenir.

Ce n'est qu'un début : paiements Mobile Money (qui débloqueront le passage des commandes
à "payée"), réservations/troc, messagerie, académie, communautés/groupes,
événements/billetterie et back-office admin restent à brancher sur le modèle de données
déjà conçu (voir la feuille de route dans `supabase/README.md`).

## Phase 10-9 — Back-office admin (backend)

`supabase/migrations/0020_admin.sql` et `supabase/tests/admin_rls_test.sql` : sanctions avec effet
réel (suspension/bannissement), modération des annonces et des signalements, vérification de compte,
invitations d'équipe, statistiques, journal d'audit. Le tableau de correspondance page ↔ fonctions et
les limites connues sont dans `supabase/README.md` (section « Admin »).

La migration corrige aussi plusieurs failles du schéma existant (journaux d'audit forgeables par
n'importe quel client, annonce retirée remise en ligne par son vendeur, vérification de compte par
UPDATE direct, signalements réécrivables). Les 13 tests RLS passent sur PostgreSQL 16 local ;
le front admin utilise encore `mock-admin.ts`.

## Phase 10-10 — Durcissement de sécurité

`supabase/migrations/0021_hardening.sql`, `supabase/tests/hardening_rls_test.sql`,
`supabase/preflight_production.sql` (contrôle en lecture seule à lancer sur le vrai projet),
`supabase/PRODUCTION.md` (guide de mise en production), ainsi que des correctifs dans les Edge Functions
(`payments-webhook`, `phone-otp-request`, `phone-otp-verify`, `_shared/cors.ts`) et des en-têtes de sécurité
dans `src/server.ts`. Détail des failles trouvées et des limites : `supabase/README.md`, section « Durcissement ».

À savoir : les Edge Functions modifiées n'ont pas été exécutées (syntaxe vérifiée seulement) ;
`CAMPAY_WEBHOOK_KEY` est désormais obligatoire (sans elle le webhook répond 503) ; définir `ALLOWED_ORIGIN`.

## Phase 11 — Branchement du front : authentification

Première étape du branchement sur Supabase : inscription, codes e-mail et SMS, connexion, récupération de
mot de passe, déconnexion, gardes de route, menu utilisateur, référentiels pays/universités.
Voir **`FRONT_BRANCHEMENT.md`** (ce qui est branché, décisions à valider, limites) et
**`supabase/AUTH_SETUP.md`** (réglages Auth à faire dans le tableau de bord : sans eux, le parcours casse).

À savoir : l'ordre de l'inscription a changé (compte avant téléphone) et le design n'avait ni champ nom ni mot de
passe ; le paiement d'inscription est désactivé faute de backend ; les flux n'ont pas été exécutés contre un vrai
projet Supabase (typecheck, build, tests unitaires et rendu du worker uniquement).

