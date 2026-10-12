-- =============================================================================
-- Test de fumée — communautés/groupes/modération (0014, 1ère moitié) et
-- événements/billetterie (0014, 2e moitié) : visibilité public/privé/
-- invitation, permissions de publication/modération, signalements,
-- anti sur-vente, scan atomique, généralisation des paiements (3e cible).
-- =============================================================================
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11112222-0000-0000-0000-000000000001', 'owner.comm-test@example.com'),
  ('11112222-0000-0000-0000-000000000002', 'membre.comm-test@example.com'),
  ('11112222-0000-0000-0000-000000000003', 'exterieur.comm-test@example.com'),
  ('11112222-0000-0000-0000-000000000004', 'invite.comm-test@example.com');

insert into public.space_categories (slug, name) values ('tech-test', 'Tech (test)');
insert into public.event_categories (slug, name) values ('conf-test', 'Conférence (test)');

-- -----------------------------------------------------------------------------
-- Création d'espace, auto-provisioning du owner, adhésion directe (publique).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001'; -- Owner

do $$
begin
  insert into public.spaces (id, kind, category_slug, name, description, privacy, created_by)
  values ('11112222-0000-0000-0000-0000000000aa', 'communaute', 'tech-test', 'Communauté publique test',
    'Description suffisamment longue pour la contrainte de longueur minimale.', 'publique', auth.uid());

  insert into public.spaces (id, kind, category_slug, name, description, privacy, created_by)
  values ('11112222-0000-0000-0000-0000000000bb', 'groupe', 'tech-test', 'Groupe privé test',
    'Description suffisamment longue pour la contrainte de longueur minimale.', 'privee', auth.uid());

  insert into public.spaces (id, kind, category_slug, name, description, privacy, created_by)
  values ('11112222-0000-0000-0000-0000000000cc', 'groupe', 'tech-test', 'Groupe sur invitation test',
    'Description suffisamment longue pour la contrainte de longueur minimale.', 'invitation', auth.uid());
end $$;

reset role;

do $$
begin
  assert (select member_count from public.spaces where id = '11112222-0000-0000-0000-0000000000aa') = 1,
    'Le créateur doit être auto-provisionné comme owner (member_count=1)';
  assert (select role from public.space_members where space_id = '11112222-0000-0000-0000-0000000000aa' and user_id = '11112222-0000-0000-0000-000000000001') = 'owner',
    'Le créateur doit avoir le rôle owner';
end $$;

-- Un tiers rejoint directement l'espace PUBLIC : autorisé.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002'; -- Membre

do $$
begin
  insert into public.space_members (space_id, user_id) values ('11112222-0000-0000-0000-0000000000aa', auth.uid());
end $$;

reset role;

-- Impossible de rejoindre directement le groupe PRIVÉ ni celui sur INVITATION.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
insert into public.space_members (space_id, user_id) values ('11112222-0000-0000-0000-0000000000bb', auth.uid());
\set ON_ERROR_STOP on

reset role;

-- -----------------------------------------------------------------------------
-- Visibilité : un extérieur voit qu'un espace PUBLIC et un groupe PRIVÉ
-- existent (nécessaire pour pouvoir demander à le rejoindre), mais pas le
-- groupe sur INVITATION (celui-là doit rester totalement caché).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000003'; -- Extérieur

do $$
begin
  assert (select count(*) from public.spaces where id = '11112222-0000-0000-0000-0000000000aa') = 1,
    'Un espace public doit être visible par n''importe quel utilisateur authentifié';
  assert (select count(*) from public.spaces where id = '11112222-0000-0000-0000-0000000000bb') = 1,
    'Un groupe privé doit rester DÉCOUVRABLE (sinon impossible de demander à le rejoindre) même par un non-membre';
  assert (select count(*) from public.spaces where id = '11112222-0000-0000-0000-0000000000cc') = 0,
    'Un groupe sur invitation doit rester totalement invisible à qui n''y a pas été invité';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Flux d'adhésion PRIVÉE : demande spontanée + approbation par l'owner.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002'; -- Membre demande à rejoindre le groupe privé

do $$
begin
  insert into public.space_membership_requests (id, space_id, user_id)
  values ('11112222-0000-0000-0000-0000000000d1', '11112222-0000-0000-0000-0000000000bb', auth.uid());
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001'; -- Owner approuve

do $$
begin
  update public.space_membership_requests set status = 'approved' where id = '11112222-0000-0000-0000-0000000000d1';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.space_members where space_id = '11112222-0000-0000-0000-0000000000bb' and user_id = '11112222-0000-0000-0000-000000000002') = 1,
    'L''approbation de la demande doit créer automatiquement l''appartenance';
end $$;

-- -----------------------------------------------------------------------------
-- Flux d'adhésion sur INVITATION : l'owner invite, l'invité accepte lui-même
-- (jamais l'inverse — un membre ne peut pas s'auto-inviter).
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000004'; -- Invité tente de s'auto-inviter

\set ON_ERROR_STOP off
insert into public.space_membership_requests (space_id, user_id, invited_by)
values ('11112222-0000-0000-0000-0000000000cc', auth.uid(), auth.uid());
\set ON_ERROR_STOP on

reset role;
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001'; -- Owner invite réellement

do $$
begin
  insert into public.space_membership_requests (id, space_id, user_id, invited_by)
  values ('11112222-0000-0000-0000-0000000000d2', '11112222-0000-0000-0000-0000000000cc', '11112222-0000-0000-0000-000000000004', auth.uid());
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000004'; -- L'invité accepte lui-même

do $$
begin
  update public.space_membership_requests set status = 'approved' where id = '11112222-0000-0000-0000-0000000000d2';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.space_members where space_id = '11112222-0000-0000-0000-0000000000cc' and user_id = '11112222-0000-0000-0000-000000000004') = 1,
    'L''acceptation de l''invitation par l''invité doit créer l''appartenance';
end $$;

-- -----------------------------------------------------------------------------
-- Publications, épinglage, modération de contenu.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002'; -- Membre publie dans l'espace public

do $$
begin
  insert into public.space_posts (id, space_id, author_id, body)
  values ('11112222-0000-0000-0000-0000000000e1', '11112222-0000-0000-0000-0000000000aa', auth.uid(), 'Bonjour la communauté !');

  -- Un simple membre ne doit pas pouvoir épingler lui-même son post : le
  -- USING de space_posts_update_own_body lui donne accès à la ligne, mais aucun
  -- WITH CHECK ne valide pinned=true pour lui -> erreur RLS explicite.
  begin
    update public.space_posts set pinned = true where id = '11112222-0000-0000-0000-0000000000e1';
    assert false, 'Un membre simple ne doit pas pouvoir épingler un post lui-même';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  assert (select pinned from public.space_posts where id = '11112222-0000-0000-0000-0000000000e1') = false,
    'Le post doit rester non épinglé après la tentative du membre simple';
end $$;

reset role;

-- Un extérieur (non membre) ne peut pas poster dans cet espace public sans y être inscrit.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000003';

\set ON_ERROR_STOP off
insert into public.space_posts (space_id, author_id, body)
values ('11112222-0000-0000-0000-0000000000aa', '11112222-0000-0000-0000-000000000003', 'Je ne suis même pas membre');
\set ON_ERROR_STOP on

reset role;

-- L'owner (modérateur de fait) épingle le post et le masque ensuite via la fonction de modération.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001';

do $$
begin
  update public.space_posts set pinned = true where id = '11112222-0000-0000-0000-0000000000e1';
  assert (select pinned from public.space_posts where id = '11112222-0000-0000-0000-0000000000e1') = true,
    'Le owner doit pouvoir épingler un post';

  perform public.moderate_hide_post('11112222-0000-0000-0000-0000000000e1', 'Contenu hors sujet (test)');
  -- Une fois masqué, le post disparaît de la vue des membres (même de l'owner) :
  assert (select count(*) from public.space_posts where id = '11112222-0000-0000-0000-0000000000e1') = 0,
    'Un post masqué ne doit plus être visible des membres';
end $$;

reset role;

do $$
begin
  assert (select hidden_at from public.space_posts where id = '11112222-0000-0000-0000-0000000000e1') is not null,
    'moderate_hide_post doit avoir positionné hidden_at (vérifié hors RLS)';
end $$;

do $$
begin
  assert (select count(*) from public.audit_logs where action = 'hide_post' and resource_id = '11112222-0000-0000-0000-0000000000e1') = 1,
    'moderate_hide_post doit être journalisé dans audit_logs';
end $$;

-- Un simple membre ne peut pas invoquer moderate_hide_post sur ce même espace.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002';

do $$
begin
  begin
    perform public.moderate_restore_post('11112222-0000-0000-0000-0000000000e1');
    assert false, 'Un simple membre ne doit jamais pouvoir invoquer les fonctions de modération';
  exception when others then
    if sqlerrm not like '%réservée%' then raise; end if;
  end;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Suspension d'un espace : réservée au staff, jamais à l'owner lui-même.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001'; -- Owner, pas staff

do $$
begin
  begin
    perform public.moderate_suspend_space('11112222-0000-0000-0000-0000000000aa', 'test');
    assert false, 'Un owner d''espace, sans être staff, ne doit jamais pouvoir suspendre son propre espace';
  exception when others then
    if sqlerrm not like '%réservée au staff%' then raise; end if;
  end;

  -- Ni contourner via un UPDATE direct : USING donne accès à la ligne (owner)
  -- mais le WITH CHECK interdit tout changement de suspended_at -> erreur RLS.
  begin
    update public.spaces set suspended_at = now() where id = '11112222-0000-0000-0000-0000000000aa';
    assert false, 'Un owner ne doit jamais pouvoir positionner suspended_at par un UPDATE direct';
  exception when others then
    if sqlerrm not like '%moderate_%' then raise; end if;
  end;
  assert (select suspended_at from public.spaces where id = '11112222-0000-0000-0000-0000000000aa') is null,
    'suspended_at doit rester NULL après la tentative directe de l''owner';
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Signalements : le rapporteur voit son propre signalement, pas ceux des autres.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000003';

do $$
begin
  insert into public.reports (id, reporter_id, target_type, target_id, reason)
  values ('11112222-0000-0000-0000-0000000000f1', auth.uid(), 'space', '11112222-0000-0000-0000-0000000000aa', 'Contenu inapproprié (test)');
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002'; -- Un autre utilisateur

do $$
begin
  assert (select count(*) from public.reports where id = '11112222-0000-0000-0000-0000000000f1') = 0,
    'Un utilisateur ne doit jamais voir le signalement déposé par quelqu''un d''autre';
end $$;

reset role;

-- =============================================================================
-- ÉVÉNEMENTS ET BILLETTERIE
-- =============================================================================
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001'; -- Organisateur

do $$
begin
  insert into public.events (id, created_by, organizer_name, category_slug, name, description, venue, campus, city, starts_at, capacity, price, status)
  values ('11112222-0000-0000-0000-0000000000ee', auth.uid(), 'Owner Test', 'conf-test', 'Conférence test',
    'Description suffisamment longue pour la contrainte de longueur minimale.', 'Amphi A', 'UY1', 'Yaoundé',
    now() + interval '7 days', 2, 0, 'published');

  insert into public.events (id, created_by, organizer_name, category_slug, name, description, venue, campus, city, starts_at, capacity, price, status)
  values ('11112222-0000-0000-0000-0000000000ff', auth.uid(), 'Owner Test', 'conf-test', 'Conférence payante test',
    'Description suffisamment longue pour la contrainte de longueur minimale.', 'Amphi B', 'UY1', 'Yaoundé',
    now() + interval '7 days', 50, 3000, 'published');
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Anti sur-vente : capacité de 2, un 3e billet gratuit doit être rejeté.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002';

do $$
begin
  insert into public.event_tickets (id, event_id, attendee_id, unit_price, idempotency_key, status)
  values ('11112222-0000-0000-0000-0000000001a1', '11112222-0000-0000-0000-0000000000ee', auth.uid(), 0, gen_random_uuid(), 'valid');
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000003';

do $$
begin
  insert into public.event_tickets (id, event_id, attendee_id, unit_price, idempotency_key, status)
  values ('11112222-0000-0000-0000-0000000001a2', '11112222-0000-0000-0000-0000000000ee', auth.uid(), 0, gen_random_uuid(), 'valid');
end $$;

reset role;
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000004';

\set ON_ERROR_STOP off
insert into public.event_tickets (event_id, attendee_id, unit_price, idempotency_key, status)
values ('11112222-0000-0000-0000-0000000000ee', auth.uid(), 0, gen_random_uuid(), 'valid');
\set ON_ERROR_STOP on

reset role;

do $$
begin
  assert (select count(*) from public.event_tickets where event_id = '11112222-0000-0000-0000-0000000000ee') = 2,
    'La capacité de 2 doit strictement bloquer un 3e billet';
  assert (select tickets_sold from public.events where id = '11112222-0000-0000-0000-0000000000ee') = 2,
    'tickets_sold doit refléter exactement les 2 billets acceptés';
end $$;

-- -----------------------------------------------------------------------------
-- Billet payant : auto-activation refusée, qr_code opaque généré, paiement
-- via la généralisation payments (3e cible), scan atomique.
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000002';

\set ON_ERROR_STOP off
insert into public.event_tickets (event_id, attendee_id, unit_price, idempotency_key, status)
values ('11112222-0000-0000-0000-0000000000ff', auth.uid(), 3000, gen_random_uuid(), 'valid');
\set ON_ERROR_STOP on

do $$
declare
  v_qr text;
begin
  insert into public.event_tickets (id, event_id, attendee_id, unit_price, idempotency_key, status)
  values ('11112222-0000-0000-0000-0000000001b1', '11112222-0000-0000-0000-0000000000ff', auth.uid(), 3000, gen_random_uuid(), 'pending_payment');

  select qr_code into v_qr from public.event_tickets where id = '11112222-0000-0000-0000-0000000001b1';
  assert v_qr is not null and char_length(v_qr) = 48,
    'Un qr_code opaque (24 octets en hexadécimal = 48 caractères) doit être généré automatiquement';
end $$;

reset role;

-- Règlement du billet (simulation service_role, comme le ferait payments-webhook).
insert into public.payments (id, event_ticket_id, amount)
values ('11112222-0000-0000-0000-0000000001c1', '11112222-0000-0000-0000-0000000001b1', 3000);
insert into public.payment_attempts (payment_id, idempotency_key, provider, phone_number, provider_reference)
values ('11112222-0000-0000-0000-0000000001c1', gen_random_uuid(), 'mtn_momo', '+237670000098', 'CAMPAY-EVENT-TEST');

do $$
begin
  update public.payments set status = 'success' where id = '11112222-0000-0000-0000-0000000001c1';
  assert (select status from public.event_tickets where id = '11112222-0000-0000-0000-0000000001b1') = 'valid',
    'Un paiement réussi doit activer automatiquement le billet (pending_payment -> valid)';
end $$;

-- Scan : succès la première fois, "already_used" la seconde, "wrong_event" sur le mauvais événement.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000001'; -- Organisateur

do $$
declare
  v_qr text;
  v_result public.scan_result;
begin
  select qr_code into v_qr from public.event_tickets where id = '11112222-0000-0000-0000-0000000001b1';

  v_result := public.scan_ticket(v_qr, '11112222-0000-0000-0000-0000000000ff');
  assert v_result = 'valid', 'Le premier scan d''un billet valide doit réussir';

  v_result := public.scan_ticket(v_qr, '11112222-0000-0000-0000-0000000000ff');
  assert v_result = 'already_used', 'Un second scan du même billet doit être détecté comme already_used';

  v_result := public.scan_ticket(v_qr, '11112222-0000-0000-0000-0000000000ee');
  assert v_result = 'wrong_event', 'Scanner un billet valide pour le mauvais événement doit être détecté';
end $$;

reset role;

do $$
begin
  assert (select count(*) from public.ticket_scans where ticket_id = '11112222-0000-0000-0000-0000000001b1') = 3,
    'Les 3 tentatives de scan doivent toutes être journalisées, y compris les échecs';
end $$;

-- Un tiers sans lien avec l'événement ne doit pas pouvoir scanner du tout.
set role authenticated;
set request.jwt.uid = '11112222-0000-0000-0000-000000000003';

do $$
begin
  begin
    perform public.scan_ticket('peu-importe-le-code', '11112222-0000-0000-0000-0000000000ff');
    assert false, 'Un tiers sans lien avec l''événement ne doit jamais pouvoir invoquer scan_ticket';
  exception when others then
    if sqlerrm not like '%réservé%' then raise; end if;
  end;
end $$;

reset role;

do $$
begin
  raise notice 'community_events_rls_test.sql : tous les tests sont passés.';
end $$;
