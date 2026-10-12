-- 0046 — La fonction utilisée par les politiques du bucket space-media n'était pas exécutable par `authenticated`
-- (les droits par défaut sont retirés sur les fonctions du schéma public) : tout envoi d'image était refusé.
revoke all on function public.space_media_space_id(text) from public, anon;
grant execute on function public.space_media_space_id(text) to authenticated;
