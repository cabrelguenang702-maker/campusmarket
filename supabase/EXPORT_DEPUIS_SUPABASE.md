# Aligner le dépôt sur le projet Supabase (migrations et Edge Functions)

> **Mise à jour v50 (24/10/2026)** : les migrations **0062 à 0070** (10 fichiers) sont maintenant dans `supabase/migrations/`.
> Elles ont été relues depuis la table `supabase_migrations.schema_migrations` du projet `kxkxrephkyfpcuanlxen`, et la longueur et
> l'empreinte MD5 de chaque fichier ont été comparées à celles du SQL en ligne : **les 10 sont identiques**. Elles sont **déjà appliquées
> en ligne : ne pas les rejouer** sur ce projet (elles servent à reconstruire une base neuve). Les deux migrations `0062_*` portent le
> même numéro mais ont été appliquées dans l'ordre alphabétique (`sponsored_listings` puis `study_groups`) : à conserver.
> Le reste de ce document (CLI `supabase migration fetch`) n'est plus nécessaire pour ces migrations.

**État au 21/10/2026** : les 5 Edge Functions (`campus-copilot`, `sponsorship-checkout-initiate`, `subscription-checkout-initiate`,
`tutoring-checkout-initiate`, `registration-checkout-initiate`) sont maintenant **dans ce dépôt**, copiées à l'identique du code déployé
(seuls les chemins d'import ont changé : `../_shared/...` au lieu de `./_shared/...` ; `campus-copilot` garde son propre dossier `_shared/`).
La migration **0061 est appliquée** sur le projet. Il ne reste à récupérer que les **migrations 0062 à 0070**
(appliquées directement en ligne, SQL pas encore dans `supabase/migrations/`) : le plus fiable est de les **télécharger telles qu'elles sont en ligne**
(aucune retranscription, donc aucun risque d'écart).

Depuis la racine du projet, avec le CLI Supabase installé et connecté (`supabase login`) :

```bash
supabase link --project-ref kxkxrephkyfpcuanlxen

# Historique des migrations appliquées -> supabase/migrations/<horodatage>_<nom>.sql
supabase migration fetch
```

Les options exactes dépendent de la version du CLI (`supabase migration --help`, `supabase functions download --help` ;
`--use-api` évite d'avoir besoin de Docker pour les fonctions).

## Migrations concernées
`0062_sponsored_listings`, `0062_study_groups`, `0063_tutoring`, `0064_monetization_fees_revenue`, `0065_fix_sponsorship_payments`,
`0066_payouts_flags_availability`, `0067_seller_premium`, `0068_paid_tutoring`, `0069_paid_registration`, `0070_admin_list_payouts`.

## Ne pas appliquer
- `_prepared/0055_registration_fee.sql` : remplacée par la migration 0069 (inscription payante par pays).
- `0061_academy_quiz_authoring.sql` : déjà appliquée en ligne (21/10/2026, sous le nom `0061_academy_quiz_authoring`). Ne pas la rejouer.

## Avant de redéployer les Edge Functions
Les fonctions de paiement partagent `supabase/functions/_shared/` (`cors.ts`, `campay.ts`). Vérifiez que les imports téléchargés
(`./_shared/...` ou `../_shared/...`) pointent bien vers ce dossier avant de redéployer.
