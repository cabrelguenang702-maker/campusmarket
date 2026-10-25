# Notifications push — mise en route

État : le code et la migration `0071_push_notifications` (déjà appliquée en ligne) sont en place. **Rien ne s'active tant
que vous n'avez pas choisi un fournisseur et renseigné ses clés.** Tant que `VITE_PUSH_PROVIDER` est vide, l'application
ne propose aucune option push. Non testé avec un vrai appareil.

## Comment ça marche
1. L'utilisateur active les notifications dans **Profil > Paramètres > Notifications** (carte « Notifications sur cet appareil »).
2. Quand une notification est créée (non lue, donc catégorie active dans l'app), un déclencheur la place dans `notification_push_queue`
   si l'utilisateur a un appareil abonné. `create_notification` n'est pas modifiée.
3. L'Edge Function `push-dispatch` (planifiée chaque minute) envoie le push. Texte générique : titre = catégorie,
   corps = « Ouvrez CampusMarket pour la consulter. » Aucun contenu de message ne passe par un service tiers.
4. Le push suit le réglage **« Dans l'app »** de chaque catégorie ; la sécurité est toujours active.

## Choisir UN fournisseur (le même des deux côtés)
| | OneSignal | Web Push natif |
|---|---|---|
| Application (`.env` / build) | `VITE_PUSH_PROVIDER=onesignal`, `VITE_ONESIGNAL_APP_ID`, `VITE_ONESIGNAL_SAFARI_WEB_ID` (facultatif) | `VITE_PUSH_PROVIDER=webpush`, `VITE_VAPID_PUBLIC_KEY` |
| Edge Functions (secrets) | `PUSH_PROVIDER=onesignal`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` | `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Commun | `APP_URL` (adresse du site), `NOTIFICATIONS_DISPATCH_SECRET` (déjà utilisé par l'e-mail) | idem |

- **OneSignal** : créez une application « Web » sur onesignal.com, saisissez l'adresse de votre site, copiez l'App ID et la clé API
  (Réglages > Clés et identifiants). Les appareils sont rattachés au compte par `external_id` (= identifiant CampusMarket).
- **Web Push natif** : générez les clés avec `npx web-push generate-vapid-keys`. La clé publique va dans l'application
  ET dans les secrets ; la clé privée uniquement dans les secrets (jamais dans le code ni dans un `VITE_*`).
- Ne pas activer les deux : ils utiliseraient chacun un service worker à la racine du site.

## Étapes
1. Renseignez les variables ci-dessus (application : au build ; Edge Functions : `supabase secrets set …`).
2. Déployez la fonction : `supabase functions deploy push-dispatch --no-verify-jwt` (protégée par le secret partagé, comme `notifications-dispatch`).
3. Planifiez-la (SQL Editor, **après** le déploiement) :
```sql
select cron.schedule(
  'push-dispatch-every-minute', '* * * * *',
  $$ select net.http_post(
       url := private.cron_secret('project_url') || '/functions/v1/push-dispatch',
       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || private.cron_secret('notifications_dispatch_secret')),
       body := '{}'::jsonb); $$);
-- Purge des envois terminés de plus de 30 jours (la table ne grossit pas sans limite) :
select cron.schedule('push-queue-purge', '0 3 * * *',
  $$ delete from public.notification_push_queue where status <> 'pending' and created_at < now() - interval '30 days'; $$);
```
4. Reconstruisez et republiez le site (les `VITE_*` sont lus au build ; la politique de sécurité du site ouvre `cdn.onesignal.com` et `*.onesignal.com`
   uniquement si `VITE_PUSH_PROVIDER=onesignal`).

## À tester avec un compte test
- Activation sur Chrome (ordinateur et Android), puis une vraie notification (ex. un message reçu) : le push arrive, le clic ouvre `/notifications`.
- Refus de l'autorisation, puis réactivation via les réglages du navigateur.
- Déconnexion puis connexion avec un autre compte sur le même appareil : l'autre compte ne reçoit pas les push du premier.
- Désactivation depuis la carte, et vérification qu'aucun push ne part ensuite.
- iPhone : le push web ne fonctionne qu'avec le site ajouté à l'écran d'accueil (iOS 16.4 minimum).

## Limites connues
- Pas de réglage push par catégorie (il suit « Dans l'app »). Un utilisateur qui coupe « Dans l'app » ET « E-mail » pour une catégorie ne reçoit rien.
- Une notification « dédupliquée » (ex. plusieurs commentaires sur le même fil) ne renvoie pas de push : un seul par fil tant qu'il est non lu.
- OneSignal : la ligne serveur est par compte, pas par appareil ; si tous les appareils se désabonnent, les envois suivants échouent côté OneSignal
  (« aucun destinataire ») et sont marqués `failed` dans la file, sans conséquence.
