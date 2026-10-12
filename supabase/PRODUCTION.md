# Mise en production — CampusMarket

Ce document sépare ce qui est **vérifié automatiquement** de ce qui **dépend de réglages
du tableau de bord** (que le code ne peut pas contrôler). Rien ici n'a été testé contre un vrai
projet Supabase : les tests tournent sur PostgreSQL 16 avec un faux schéma Supabase, et les
Edge Functions n'ont pas été exécutées (syntaxe vérifiée seulement). Les étapes marquées
**[à vérifier sur le vrai projet]** sont là pour ça.

## 1. Ordre recommandé

1. Créer un projet **staging** distinct de la production (mêmes migrations, secrets différents).
2. Appliquer `0001` → `0021` dans l'ordre sur staging, puis jouer les 14 fichiers de `supabase/tests/`
   **sur une base locale** (jamais sur staging/prod : ils créent de faux comptes).
3. Déployer les 7 Edge Functions sur staging, définir les secrets (section 3).
4. Exécuter `supabase/preflight_production.sql` sur staging, corriger jusqu'à « Prêt côté base ».
5. Dérouler les tests de fumée (section 5) sur staging.
6. Répéter 2 à 5 sur la production, **après une sauvegarde manuelle** (section 4).

## 2. Contrôle automatique : `preflight_production.sql`

Coller le fichier dans le SQL Editor : une seule requête, **lecture seule**. La première ligne est
le verdict (`ECHEC` = ne pas ouvrir). Il vérifie RLS partout, `search_path` des fonctions sensibles,
droits minimaux de `anon`/`authenticated` (dont TRUNCATE, qui ignore la RLS), fonctions internes non
exposées, buckets privés et bornés, présence d'un `super_admin` et MFA des admins, absence de comptes
de test, extensions `pg_cron`/`pg_net`, jobs planifiés présents, secrets Vault réellement remplis
(les modèles `REMPLACER…` sont détectés), webhooks sans signature, paiements bloqués.

Sur une base **locale** neuve, trois `ECHEC` sont normaux : jobs cron absents (pg_cron est simulé en
local), secrets Vault encore au modèle, aucun `super_admin`. Sur un vrai projet, les jobs sont créés
par les migrations *si* `pg_cron` était activé au moment où elles ont été appliquées ; sinon
`jobs_cron_attendus` liste ceux qui manquent (activer l'extension puis rejouer le bloc `cron.schedule`
de la migration concernée). Secrets Vault et `super_admin` sont dans tous les cas à faire à la main.

## 3. Secrets des Edge Functions

Voir `functions/.env.example`. Points de durcissement :

| Secret | Règle |
|---|---|
| `CAMPAY_WEBHOOK_KEY` | **Obligatoire.** Sans elle, `payments-webhook` répond 503 (fail-closed). |
| `ALLOW_UNSIGNED_WEBHOOKS` | Sandbox seulement. **Ne doit pas exister en production.** |
| `ALLOWED_ORIGIN` | Origine exacte de l'app (`https://…`, sans slash final). Sans elle : `*`. |
| `PAYMENTS_RECONCILE_SECRET`, `NOTIFICATIONS_DISPATCH_SECRET` | `openssl rand -hex 32`, **différents** entre staging et prod, identiques à ceux du Vault. |
| `SUPABASE_SERVICE_ROLE_KEY` | Jamais dans le front, jamais dans un dépôt, jamais dans un message. |

La CSP du worker web (`connect-src`/`img-src`) est bornée à **ton** projet via `VITE_SUPABASE_URL` (injectée au build,
la même que celle du client) ; la variable de worker `SUPABASE_URL`, si définie, est prioritaire. Sans l'une ni l'autre,
repli sur `*.supabase.co`.

## 4. Réglages hors base **[à vérifier sur le vrai projet]**

**Authentification** (Dashboard → Authentication)
- Confirmation d'e-mail obligatoire (l'acceptation des invitations d'équipe en dépend : elle exige
  un e-mail *confirmé*).
- Longueur minimale du mot de passe ≥ 10, et protection contre les mots de passe compromis si ton
  plan la propose.
- CAPTCHA (hCaptcha ou Turnstile) sur inscription et connexion — **seulement après** avoir intégré le jeton dans le front
  (il n'envoie pas encore de `captchaToken` : l'activer avant ferait échouer toutes les inscriptions ; voir `AUTH_SETUP.md`, section 3).
- Modèles d'e-mail « Confirm signup » et « Reset password » avec `{{ .Token }}` (code à 6 chiffres) et règles de mot de passe
  imposées côté serveur : détail dans **`AUTH_SETUP.md`**.
- Connexions anonymes désactivées. MFA TOTP activé (les actions admin l'exigent).
- Durée de vie du JWT : 3600 s ou moins ; rotation des refresh tokens activée.
- URL de redirection : liste explicite, **sans joker**.
- SMTP personnalisé avec SPF/DKIM/DMARC valides (sinon les e-mails de sécurité n'arrivent pas).
- Limites de débit d'Auth : les garder aux valeurs par défaut ou plus basses, jamais plus hautes.

**API et réseau** (Dashboard → Settings → API / Database)
- Schémas exposés : `public` seulement. Désactiver GraphQL s'il n'est pas utilisé.
- Restrictions réseau sur la connexion Postgres directe ; SSL imposé.
- Plan avec **sauvegardes quotidiennes**, idéalement PITR. Faire un test de restauration **une fois**,
  sur un projet jetable : une sauvegarde jamais restaurée n'est qu'une hypothèse.

**Surveillance**
- Alertes sur : pic de 401/403 sur `payments-webhook`, taux d'échec de paiement, erreurs 5xx des
  Edge Functions, croissance anormale de `provider_events`.
- Relire `admin_alerts()` et `audit_logs` (filtre `result = 'failure'`) régulièrement :
  chaque action admin refusée y laisse une trace.

## 5. Tests de fumée après déploiement

Remplace `URL` et `ANON` (clé anon publique). Tous doivent échouer comme indiqué.

```bash
# 1. Un visiteur ne peut pas forger l'audit (attendu : 401/403 ou erreur de droit d'exécution)
curl -s -X POST "$URL/rest/v1/rpc/log_audit" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"p_action":"faux","p_resource_type":"profile"}'

# 2. Un visiteur ne peut pas lire les données privées (attendu : erreur de droit, pas une liste vide)
curl -s "$URL/rest/v1/profile_private?select=*" -H "apikey: $ANON"

# 3. Le webhook refuse une requête non signée (attendu : 401, ou 503 si la clé manque)
curl -s -i -X POST "$URL/functions/v1/payments-webhook" -H "Content-Type: application/json" \
  -d '{"reference":"x","external_reference":"00000000-0000-0000-0000-000000000000","status":"SUCCESSFUL"}'

# 4. Les en-têtes de sécurité sont posés (attendu : Content-Security-Policy, Strict-Transport-Security…)
curl -sI https://TON-DOMAINE | grep -iE "content-security|strict-transport|x-frame|nosniff"
```

Puis, à la main : créer un compte, soumettre un faux code OTP 6 fois (le 6ᵉ doit être refusé,
même avec le bon code), tenter de modifier le prix d'un autre vendeur (refusé), se connecter en
admin **sans** MFA et tenter un bannissement (refusé : `mfa_required`).

## 6. Rotation et incident

- **Fuite de la clé `service_role`** : la régénérer immédiatement (Dashboard → Settings → API),
  redéployer les Edge Functions, puis relire `audit_logs` et `provider_events` sur la période.
- **Fuite d'un secret de cron/webhook** : le changer côté Edge Function **et** dans le Vault, sinon
  les jobs planifiés échouent en 401.
- **Compte admin compromis** : le suspendre depuis un autre admin (`admin_suspend_user`), retirer
  ses rôles (`revoke_role`), relire ses actions dans `audit_logs`. C'est pour cela qu'il faut
  **au moins deux** `super_admin`.
- **Perte du dernier `super_admin`** : plus personne ne peut attribuer de rôle. La seule issue est
  une écriture directe en SQL Editor — à éviter en s'organisant avant.

## 7. Limites connues (honnêteté)

- **CSP avec `'unsafe-inline'` sur les scripts** : nécessaire tant que l'hydratation SSR et le script de
  thème sont inline. Les autres directives (connect-src, object-src, frame-ancestors, base-uri,
  form-action) apportent une vraie protection, mais pas contre l'exécution d'un script injecté.
  Passer aux nonces est un chantier à part.
- **Pas de limitation par IP** : les limites de débit sont par compte (et par numéro pour les SMS).
  Un attaquant qui crée des comptes en masse n'est freiné que par le CAPTCHA et les limites d'Auth.
- **Pas de scan antivirus des fichiers déposés** : les buckets limitent taille et types (MIME déclaré),
  pas le contenu réel.
- **Rétention** : 24 h pour les codes OTP, 180 j pour les événements de paiement traités. Les durées
  de conservation des autres données (messages, journaux d'audit, documents d'identité refusés)
  restent à fixer avec tes obligations légales ; elles ne sont pas purgées automatiquement.
- **Désinscription** : aucune fonction ne supprime un compte et ses fichiers de bout en bout
  (documents d'identité compris). À prévoir si tu dois répondre à une demande d'effacement.
