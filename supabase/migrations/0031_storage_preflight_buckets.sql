-- 0031 — Buckets hérités de l'ancien projet : on les met en conformité avec le preflight (privés, taille et types bornés)
-- au lieu de les laisser publics et sans limite. Supabase interdit de supprimer un bucket en SQL (storage.protect_delete) :
-- listing-media, chat-attachments et formation-content restent donc présents mais vides et FERMÉS (aucune policy
-- storage.objects ne les référence : seuls le service et le staff via le dashboard peuvent y toucher). Ils peuvent être
-- supprimés depuis le dashboard (Storage > ⋯ > Delete) sans aucune conséquence.
--
-- `avatars` est conservé et réutilisé : l'écran profil en a besoin. Il devient privé (URLs signées), limité à 2 Mo et
-- à JPG/PNG/WebP, avec des policies calquées sur product-media : chacun écrit dans son propre dossier <uid>/...,
-- tout utilisateur connecté peut lire.
update storage.buckets
   set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

update storage.buckets
   set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('listing-media', 'formation-content');

update storage.buckets
   set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'chat-attachments';

create policy avatars_storage_select on storage.objects
  for select to authenticated using (bucket_id = 'avatars');
create policy avatars_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_active_account());
create policy avatars_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
