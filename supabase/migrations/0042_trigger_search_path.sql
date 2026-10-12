-- 0042 — search_path fixé sur les déclencheurs et fonctions de session ajoutés ou touchés par 0039–0041
alter function public.protect_profile_trust_columns() set search_path = public;
alter function public.protect_private_trust_columns() set search_path = public;
alter function public.session_aal() set search_path = public;
alter function public.has_mfa_session() set search_path = public;
