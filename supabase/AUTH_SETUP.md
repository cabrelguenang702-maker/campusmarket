# Configuration de Supabase Auth pour le front

Le front (`src/lib/auth.tsx`) s'appuie sur des réglages du tableau de bord que **le code ne peut pas
imposer**. Si l'un d'eux manque, le parcours casse ou, pire, la règle n'est appliquée que par le
navigateur (donc contournable). À faire sur staging puis production — Dashboard → Authentication.

> Rien ici n'a été vérifié contre un vrai projet Supabase : le front est compilé et ses utilitaires
> testés, mais aucun appel réel à Auth n'a été exécuté. Les points marqués **[à confirmer]** sont à
> contrôler au premier essai.

## 1. Obligatoire pour que les parcours fonctionnent

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Email → **Confirm email** | Activé | L'inscription attend un code à saisir ; sans cela la session s'ouvre sans vérification (le front gère ce cas mais l'e-mail n'est alors jamais vérifié). Les invitations d'équipe exigent aussi un e-mail confirmé. |
| Email → **Email OTP Length** | 6 | Les écrans affichent 6 cases. |
| Email → **Email OTP Expiration** | 600 s | Le texte des écrans parle d'un code à durée limitée ; 10 minutes est cohérent avec les SMS. |
| Templates → **Confirm signup** | Remplacer le lien par le code : `{{ .Token }}` | Le modèle par défaut envoie un **lien** ; le front attend un **code**. Sans changement, personne ne peut finir l'inscription. |
| Templates → **Reset password** | Idem : `{{ .Token }}` | Même raison pour la récupération. |
| URL Configuration → **Site URL** | L'URL publique de l'app | Utilisée dans les e-mails. |
| URL Configuration → **Redirect URLs** | Liste explicite, **sans joker** | Le front n'utilise aucun lien magique, donc aucune URL de redirection n'est nécessaire en dehors du site lui-même. |
| SMTP | **SMTP personnalisé** | Le SMTP intégré est limité à quelques e-mails par heure et pour toute la plateforme : insuffisant dès le premier lancement. Configurer SPF, DKIM et DMARC. |

Modèle minimal pour les deux templates (adapter le texte) :

```html
<p>Votre code CampusMarket : <strong style="font-size:22px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>Il expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>
```

## 2. Les règles de mot de passe doivent aussi être imposées côté serveur

Le front exige **10 caractères, une majuscule, un chiffre** (`PASSWORD_RULES` dans `auth-utils.ts`), mais
un appel direct à l'API d'Auth ne passe pas par le front. Réglage : Authentication → Sign In / Providers →
**Password requirements** : longueur minimale **10** et « lettres minuscules, majuscules et chiffres ».
Activer aussi la protection contre les mots de passe compromis si ton plan la propose.

## 3. À NE PAS activer tant que le front ne le gère pas

- **CAPTCHA (hCaptcha / Turnstile)** : le front n'envoie aucun `captchaToken`. Activé côté Supabase, il fait
  échouer **toutes** les inscriptions, connexions et demandes de réinitialisation. L'intégrer (widget +
  `options.captchaToken` dans `signUp`, `signInWithPassword`, `resetPasswordForEmail`) est un chantier à part,
  recommandé avant l'ouverture publique.
- **Connexions anonymes** : laisser désactivées.
- **Fournisseur Phone d'Auth** : inutile. La vérification du téléphone passe par les Edge Functions
  `phone-otp-request` / `phone-otp-verify` (le numéro est stocké dans `profile_private`, pas dans `auth.users`).

## 4. Comportements à connaître

- **Adresse déjà inscrite.** Avec « Confirm email », Supabase répond sans erreur mais renvoie un utilisateur
  sans identité : c'est ce que le front utilise pour afficher « Cette adresse est déjà utilisée ». Ce message
  permet donc de savoir qu'une adresse a un compte. Le design le prévoit ; la limitation de débit d'Auth et
  un CAPTCHA en réduisent l'abus. À l'inverse, la **récupération de mot de passe ne révèle jamais** si une
  adresse existe (écran identique dans les deux cas).
- **Code faux ou expiré.** Auth renvoie la même erreur pour les deux ; l'écran affiche « incorrect ou expiré ».
- **Type de code d'inscription [à confirmer].** `verifyOtp` est appelé avec `type: "signup"`. Si ton projet
  répond « invalid » alors que le code est bon, essayer `type: "email"` dans `verifyEmailCode`
  (`src/lib/auth.tsx`) : selon la version d'Auth, l'un ou l'autre est attendu pour un compte non confirmé.
- **Réinitialisation du mot de passe.** Après l'enregistrement, **toutes** les sessions de l'utilisateur sont
  fermées (`signOut({ scope: "global" })`) : l'écran de succès renvoie vers la connexion.
- **Session expirée.** Si la session est perdue sans déconnexion volontaire, la page de connexion affiche
  « Votre session a expiré » et le retour se fait vers la page d'origine (chemins internes uniquement).
- **Connexion par numéro de téléphone** : non disponible. Elle exigerait une Edge Function qui retrouve le compte
  côté serveur (jamais une requête depuis le navigateur : elle révélerait l'e-mail associé à un numéro).
- **« Rester connecté »** décoché : la session vit dans `sessionStorage` (fermée avec l'onglet) au lieu de `localStorage`.

## 5. Vérification rapide après configuration

1. S'inscrire avec une vraie adresse : l'e-mail reçu contient **6 chiffres**, pas un lien.
2. Saisir un mauvais code : message « incorrect ou expiré ». Saisir le bon : passage à l'étape téléphone.
3. Tenter de créer un compte avec le mot de passe `abc` **par appel direct** à l'API
   (`curl -X POST $URL/auth/v1/signup …`) : doit être refusé (règle serveur, point 2).
4. « Mot de passe oublié » : code reçu, nouveau mot de passe accepté, ancien refusé, autre appareil déconnecté.
5. Se connecter avec un compte du personnel : l'entrée « Administration » apparaît dans le menu ; avec un
   compte étudiant, `/admin` renvoie vers « accès refusé ».
