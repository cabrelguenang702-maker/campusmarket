# Branchement du front sur Supabase — état

Le front a été conçu avec des données de maquette (`src/lib/mock-*.ts`). Le branchement se fait **module par
module**. Ce fichier dit précisément ce qui est branché, ce qui ne l'est pas, et ce qui a été décidé en route.

## Démarrage

```bash
cp .env.example .env     # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (clé anon, publique)
npm ci && npm run dev
```

Sans ces deux variables, l'application affiche « Supabase n'est pas configuré » (aucun repli silencieux sur
les maquettes). `VITE_DESIGN_REVIEW=true` réaffiche les barres de bascule d'états des écrans encore en maquette.
Réglages du tableau de bord Supabase requis par l'authentification : **`supabase/AUTH_SETUP.md`**.

## Étape 1 — Authentification et inscription (faite)

| Écran | Branché sur |
|---|---|
| `/inscription/pays` | table `countries` (lecture anon) |
| `/inscription/email` (maintenant « Créez votre compte » : nom, e-mail, mot de passe, conditions) | `auth.signUp` |
| `/inscription/otp-email` | `auth.verifyOtp` / `auth.resend` |
| `/inscription/telephone`, `/inscription/otp-telephone` | Edge Functions `phone-otp-request` / `phone-otp-verify` |
| `/inscription/universite` | tables `universities`, `profiles` (mise à jour), `university_suggestions` (insertion) |
| `/inscription/compte-cree` | profil et données privées réels |
| `/connexion` | `auth.signInWithPassword`, « rester connecté », message de session expirée |
| `/mot-de-passe-oublie`, `/reinitialisation/*` | `resetPasswordForEmail`, `verifyOtp(recovery)`, `updateUser` |
| Menu utilisateur (`AppShell`) | nom, campus, badge vérifié, déconnexion, entrée « Administration » pour le personnel |
| Gardes de route | `_app` (connecté), `_auth` (visiteur), `_admin` (personnel), étapes d'inscription (session) |

Gardes = **interface uniquement**. Elles évitent d'afficher un écran à qui ne devrait pas le voir ; la protection
réelle des données est la RLS et les fonctions `admin_*`. La session est conservée côté navigateur
(localStorage), donc **inconnue du rendu serveur** : les pages gardées affichent « Chargement… » côté serveur
puis se résolvent dans le navigateur (vérifié sur le worker construit).

### Décisions prises (à valider)

1. **Ordre de l'inscription modifié.** Avant : pays → téléphone → code SMS → e-mail → code e-mail. Maintenant :
   pays → **compte (nom, e-mail, mot de passe)** → code e-mail → téléphone → code SMS → université. Raison : les
   Edge Functions de SMS exigent une session ouverte (sinon n'importe qui pourrait déclencher des SMS payants),
   et la session n'existe qu'après la création du compte. Le design n'avait **ni champ nom ni mot de passe** : ils sont
   ajoutés à l'écran e-mail, et la case « conditions d'utilisation » y est déplacée (c'est là que le compte est créé).
2. **Paiement d'inscription désactivé** (`REGISTRATION_PAYMENT_ENABLED = false` dans `src/lib/config.ts`). Le
   backend n'a aucune cible de paiement « inscription » et rien ne conditionne l'accès à un paiement ; l'écran
   `/inscription/paiement` reste dans le code, hors parcours. L'activer rétablit l'écran **sans aucun effet réel**.
   Si les frais d'inscription sont voulus, c'est une fonctionnalité backend à concevoir (cible de paiement, règle d'accès).
3. **Vérification du téléphone facultative** (`PHONE_VERIFICATION_REQUIRED = false`) : bouton « Passer cette étape ».
   Aucun prestataire SMS n'est configuré (`SMS_PROVIDER`) : une étape obligatoire bloquerait toute inscription.
   Seul le Cameroun (+237) est pris en charge par les Edge Functions ; pour les autres pays l'étape est proposée comme « bientôt disponible ».
4. **Mot de passe : 10 caractères, une majuscule, un chiffre** (règle unique, `auth-utils.ts`), à imposer aussi côté serveur.
5. **Connexion et récupération par e-mail uniquement.** Les écrans acceptaient « téléphone ou e-mail » ; par téléphone,
   ils affichent un message clair. Le faire proprement demande une Edge Function (voir `AUTH_SETUP.md`).
6. **Barres de bascule d'états retirées** des écrans branchés (leurs états viennent des vraies requêtes).

### Vérifié, et non vérifié

- Vérifié : typecheck, build, 13 tests unitaires (`npm run test:unit` : format des numéros,
  règles de mot de passe, classement des erreurs Auth, redirection post-connexion sans redirection ouverte, chemins gardés),
  rendu serveur et en-têtes de sécurité sur le worker construit (exécuté avec wrangler en local).
- **Non vérifié** : aucun appel réel à Supabase Auth ni aux Edge Functions (pas de projet ici). Les flux — inscription,
  codes, connexion, récupération, appels de fonctions — sont écrits d'après la documentation de supabase-js et les
  fonctions du dépôt, **pas exécutés**. Premier essai à faire sur staging avec la liste de `AUTH_SETUP.md`, section 5.
- Pas de test automatisé des écrans (aucun framework de test de composants dans le projet).

## Reste à brancher (toujours en maquette)

Tout le reste : marketplace, produit, commandes, paiements, offres, réservations, troc, messagerie, Academy,
communautés, événements, notifications, annuaire, support, profil et vérification de compte, **et les 8 pages
d'administration** (`mock-admin.ts`). `currentUser` (`mock-data.ts`) est encore lu par les écrans non branchés.
Les actions du back-office exigent une session **MFA (aal2)** côté base : l'écran d'inscription/vérification d'un
facteur TOTP n'existe pas encore dans le front et devra être ajouté avant de brancher l'administration.

Ordre proposé : marketplace (lecture) → produit et création d'annonce (+ images, bucket `product-media`) →
commandes et paiements (dépend de la clé CamPay) → messagerie → profil/vérification → le reste → administration (+ MFA).
