-- =============================================================================
-- Test de fumée — auth avancée (0011) : grant_role/revoke_role (MFA + RBAC),
-- immuabilité audit_logs/security_logs, détection nouvel appareil,
-- verrouillage de phone_verification_codes.
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000001', 'admin.auth-test@example.com'),
  ('dddddddd-0000-0000-0000-000000000002', 'super.auth-test@example.com'),
  ('dddddddd-0000-0000-0000-000000000003', 'etudiant.auth-test@example.com');

insert into public.user_roles (user_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'admin'),
  ('dddddddd-0000-0000-0000-000000000002', 'super_admin');

-- -----------------------------------------------------------------------------
-- grant_role : refusé sans admin, refusé sans MFA, refusé pour élévation,
-- OK avec admin + MFA sur un rôle non-élevé. Résultat structuré (jsonb), pas
-- d'exception, pour les cas "normaux" (voir commentaire dans la migration).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'dddddddd-0000-0000-0000-000000000003'; -- étudiant lambda, pas admin

do $$
declare
  v_result jsonb;
begin
  v_result := public.grant_role('dddddddd-0000-0000-0000-000000000003', 'moderator');
  assert (v_result ->> 'success')::boolean = false and v_result ->> 'error' = 'not_admin',
    'Un étudiant non-admin ne doit jamais pouvoir s''auto-attribuer un rôle';
end $$;

reset role;
set role authenticated;
set request.jwt.uid = 'dddddddd-0000-0000-0000-000000000001'; -- admin, mais SANS session MFA (aal1)
set request.jwt.claims = '{"aal":"aal1"}';

do $$
declare
  v_result jsonb;
begin
  v_result := public.grant_role('dddddddd-0000-0000-0000-000000000003', 'moderator');
  assert (v_result ->> 'success')::boolean = false and v_result ->> 'error' = 'mfa_required',
    'Un admin sans session MFA (aal2) ne doit pas pouvoir attribuer de rôle';
end $$;

-- Même un admin ne peut pas attribuer 'admin' ou 'super_admin' : réservé au super_admin.
set request.jwt.claims = '{"aal":"aal2"}';

do $$
declare
  v_result jsonb;
begin
  v_result := public.grant_role('dddddddd-0000-0000-0000-000000000003', 'admin');
  assert (v_result ->> 'success')::boolean = false and v_result ->> 'error' = 'requires_super_admin',
    'Un admin (non super_admin) ne doit pas pouvoir attribuer le rôle admin';

  -- Un rôle "normal" (moderator), lui, doit passer avec admin + aal2.
  v_result := public.grant_role('dddddddd-0000-0000-0000-000000000003', 'moderator');
  assert (v_result ->> 'success')::boolean = true,
    'grant_role doit réussir pour un admin en session MFA attribuant un rôle non-élevé';
  assert (select public.has_role('moderator', 'dddddddd-0000-0000-0000-000000000003')),
    'Le rôle moderator doit être effectivement présent après un grant_role réussi';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.security_logs where event_type = 'role_granted'
          and metadata ->> 'target_user' = 'dddddddd-0000-0000-0000-000000000003') = 1,
    'grant_role réussi doit journaliser un événement role_granted';
  assert (select count(*) from public.audit_logs where action = 'grant_role' and result = 'success') = 1,
    'grant_role réussi doit journaliser dans audit_logs';
  assert (select count(*) from public.audit_logs where action = 'grant_role' and result = 'failure') = 3,
    'Les trois tentatives refusées (non-admin, sans MFA, élévation) doivent être journalisées en failure : c''est précisément le point que corrige le retour jsonb plutôt qu''une exception';
end $$;

-- -----------------------------------------------------------------------------
-- revoke_role : anti-auto-verrouillage (reste en exception : erreur d'usage,
-- pas un cas à auditer comme tentative refusée normale).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'dddddddd-0000-0000-0000-000000000002'; -- super_admin
set request.jwt.claims = '{"aal":"aal2"}';

do $$
declare
  v_result jsonb;
begin
  begin
    perform public.revoke_role('dddddddd-0000-0000-0000-000000000002', 'super_admin');
    assert false, 'Un super_admin ne doit jamais pouvoir retirer lui-même son propre rôle super_admin';
  exception when others then
    if sqlerrm not like '%auto-verrouillage%' then raise; end if;
  end;

  v_result := public.revoke_role('dddddddd-0000-0000-0000-000000000003', 'moderator');
  assert (v_result ->> 'success')::boolean = true,
    'revoke_role doit réussir pour retirer le rôle d''un autre utilisateur';
  assert not (select public.has_role('moderator', 'dddddddd-0000-0000-0000-000000000003')),
    'Le rôle moderator doit avoir disparu après un revoke_role réussi';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Immuabilité des journaux, même pour service_role.
-- -----------------------------------------------------------------------------
set role service_role;

do $$
begin
  begin
    delete from public.security_logs;
    assert false, 'security_logs ne doit jamais accepter de DELETE, même pour service_role';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.audit_logs set result = 'success';
    assert false, 'audit_logs ne doit jamais accepter d''UPDATE, même pour service_role';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

-- Un simple étudiant ne doit voir ni l'un ni l'autre journal.
set role authenticated;
set request.jwt.uid = 'dddddddd-0000-0000-0000-000000000003';

do $$
begin
  assert (select count(*) from public.audit_logs) = 0,
    'Un utilisateur non-admin ne doit voir aucune ligne de audit_logs';
  assert (select count(*) from public.security_logs) = 0,
    'Un utilisateur non-admin (même staff) ne doit voir aucune ligne de security_logs (super_admin seulement)';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- record_login : détecte correctement premier appareil vs appareil connu.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = 'dddddddd-0000-0000-0000-000000000003';

do $$
declare
  v_result jsonb;
begin
  v_result := public.record_login('empreinte-appareil-test-001');
  assert (v_result ->> 'new_device')::boolean = true,
    'Le premier login avec cette empreinte doit être détecté comme nouvel appareil';

  v_result := public.record_login('empreinte-appareil-test-001');
  assert (v_result ->> 'new_device')::boolean = false,
    'Un second login avec la même empreinte ne doit plus être un nouvel appareil';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.security_logs where user_id = 'dddddddd-0000-0000-0000-000000000003' and event_type = 'new_device_detected') = 1,
    'Un seul événement new_device_detected attendu (uniquement au premier login)';
end $$;

-- -----------------------------------------------------------------------------
-- phone_verification_codes : verrouillé même pour son propriétaire.
-- -----------------------------------------------------------------------------
insert into public.phone_verification_codes (id, user_id, phone, code_hash)
values ('dddddddd-0000-0000-0000-0000000000aa', 'dddddddd-0000-0000-0000-000000000003', '+237670000001', 'hash-de-test');

set role authenticated;
set request.jwt.uid = 'dddddddd-0000-0000-0000-000000000003';

do $$
declare
  v_n bigint := 0;
begin
  -- Depuis 0021 le client n'a plus AUCUN droit sur cette table (refus d'accès) ;
  -- avant, la RLS renvoyait 0 ligne. Les deux sont acceptables : rien n'est lisible.
  begin
    select count(*) into v_n from public.phone_verification_codes;
  exception when insufficient_privilege then
    v_n := 0;
  end;
  assert v_n = 0,
    'Même le propriétaire du code ne doit rien pouvoir lire dans phone_verification_codes (accès service_role uniquement)';
end $$;

reset role;

do $$
begin
  raise notice 'auth_hardening_rls_test.sql : tous les tests sont passés.';
end $$;
