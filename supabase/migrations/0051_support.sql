-- 0051 — Aide et support : consigne l'état appliqué sur le projet + durcit les messages de ticket
--
-- Déjà appliqué sur le projet (migration « support », avant ce fichier) et repris ici pour qu'un nouveau projet
-- retrouve le même état en rejouant les migrations dans l'ordre :
--   * enforce_ticket_immutability : un demandeur ne peut modifier que le statut de son ticket (pas assigned_to,
--     last_message_at, last_message_preview) ;
--   * create_support_ticket(p_category, p_subject, p_body) : crée le ticket ET son premier message en une seule
--     opération (jamais de ticket vide), après contrôle MFA et validation des champs ;
--   * les 20 questions de la FAQ (5 catégories, rédigées d'après le comportement réel de l'application).
-- Nouveau dans ce fichier :
--   * LIMITE sur support_ticket_messages : le ticket était limité (5 / heure) mais pas ses messages — un demandeur
--     pouvait en envoyer sans fin. 30 messages par heure pour les non-membres du personnel.
--   * Une pièce jointe doit se trouver dans le dossier de SON ticket (`<ticket_id>/…`) et porter un nom.
--   * FAQ « Comment publier une annonce ? » : l'annonce passe par la modération avant d'être visible (la réponse
--     disait qu'elle l'était « dès sa publication »).

create or replace function public.enforce_ticket_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.subject is distinct from old.subject
     or new.category_slug is distinct from old.category_slug
     or new.user_id is distinct from old.user_id then
    raise exception 'Le sujet, la catégorie et l''auteur d''un ticket ne se modifient pas après création';
  end if;
  if current_user in ('authenticated', 'anon') and not public.is_staff()
     and (new.assigned_to is distinct from old.assigned_to
          or new.last_message_at is distinct from old.last_message_at
          or new.last_message_preview is distinct from old.last_message_preview) then
    raise exception 'Seul le statut du ticket peut être modifié';
  end if;
  return new;
end;
$$;

create or replace function public.create_support_ticket(p_category text, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_subject text := trim(coalesce(p_subject, ''));
  v_body text := trim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  perform public.assert_mfa();
  if char_length(v_subject) < 3 or char_length(v_subject) > 200 then
    raise exception 'Le sujet doit contenir entre 3 et 200 caractères';
  end if;
  if char_length(v_body) < 10 or char_length(v_body) > 4000 then
    raise exception 'Décrivez votre problème en 10 à 4000 caractères';
  end if;
  if not exists (select 1 from public.faq_categories where slug = p_category) then
    raise exception 'Catégorie inconnue';
  end if;

  insert into public.support_tickets (user_id, subject, category_slug) values (auth.uid(), v_subject, p_category) returning id into v_id;
  insert into public.support_ticket_messages (ticket_id, sender_id, body) values (v_id, auth.uid(), v_body);
  return v_id;
end;
$$;

revoke all on function public.create_support_ticket(text, text, text) from public, anon;
grant execute on function public.create_support_ticket(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Messages de ticket : limite de fréquence + pièce jointe dans le dossier du ticket
-- ---------------------------------------------------------------------------------------------------------------
create index if not exists support_ticket_messages_sender_idx on public.support_ticket_messages (sender_id, created_at desc);

create or replace function public.guard_support_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if new.attachment_path is not null then
    if new.attachment_path not like new.ticket_id::text || '/%' then
      raise exception 'La pièce jointe doit appartenir à ce ticket';
    end if;
    if new.attachment_name is null or char_length(trim(new.attachment_name)) = 0 then
      raise exception 'La pièce jointe doit avoir un nom';
    end if;
  end if;

  -- Le personnel (qui traite de nombreux tickets) et les appels internes (cron, SQL editor) ne sont pas limités.
  if private.in_client_context() and not public.is_staff(new.sender_id) then
    perform pg_advisory_xact_lock(hashtextextended('support_ticket_messages:' || new.sender_id::text, 0));
    select count(*) into v_count from public.support_ticket_messages
      where sender_id = new.sender_id and created_at > now() - interval '1 hour';
    if v_count >= 30 then
      raise exception 'Vous avez envoyé beaucoup de messages en peu de temps. Réessayez dans une heure.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists support_ticket_messages_guard on public.support_ticket_messages;
create trigger support_ticket_messages_guard
  before insert on public.support_ticket_messages
  for each row execute function public.guard_support_ticket_message();

-- ---------------------------------------------------------------------------------------------------------------
-- FAQ — ajout idempotent (une question déjà présente n'est jamais dupliquée ni écrasée)
-- ---------------------------------------------------------------------------------------------------------------
insert into public.faq_items (category_slug, question, answer, sort_order)
select v.c, v.q, v.a, v.o
from (values
  ('compte', $q$Comment faire vérifier mon compte étudiant ?$q$, $q$Ouvrez Profil, puis « Vérification » (ou le bandeau « Compte non vérifié » de votre profil). Choisissez votre document (carte d'étudiant recto et verso, certificat de scolarité ou reçu d'inscription), envoyez-le puis attendez la décision de notre équipe. Le résultat s'affiche sur cette même page ; en cas de refus, le motif est indiqué et vous pouvez refaire une demande.$q$, 1),
  ('compte', $q$Comment modifier mon profil et ma photo ?$q$, $q$Depuis Profil, puis « Modifier le profil » : nom, présentation, filière, niveau, ville et photo. Votre adresse e-mail se change dans « Informations personnelles » : un lien de confirmation est envoyé à la nouvelle adresse.$q$, 2),
  ('compte', $q$Puis-je changer d'université après l'inscription ?$q$, $q$L'université ne se modifie pas depuis l'application. Ouvrez un ticket (catégorie « Compte et profil ») en indiquant l'université souhaitée : notre équipe vous répondra.$q$, 3),
  ('compte', $q$Comment désactiver ou supprimer mon compte ?$q$, $q$Dans Profil > Paramètres > Compte, « Désactiver mon compte » masque votre profil, vos annonces et vos demandes aux autres étudiants. Vos données sont conservées et vous pouvez réactiver votre compte à tout moment en vous reconnectant. Pour une suppression définitive, ouvrez un ticket. Vous pouvez aussi y télécharger une copie de vos données.$q$, 4),
  ('paiements', $q$Quels moyens de paiement sont acceptés ?$q$, $q$Le paiement se fait par Mobile Money : MTN MoMo et Orange Money, avec un numéro camerounais (+237). Vous confirmez ensuite le paiement sur votre téléphone.$q$, 5),
  ('paiements', $q$Mon paiement a échoué mais j'ai été débité$q$, $q$Conservez le message de l'opérateur avec la référence de la transaction, puis ouvrez un ticket (catégorie « Paiements et Mobile Money ») en l'indiquant. Notre équipe vérifie la transaction et revient vers vous.$q$, 6),
  ('paiements', $q$Combien de temps ai-je pour payer ?$q$, $q$Un billet d'événement en attente de paiement est réservé 15 minutes. Passé ce délai, la place est libérée automatiquement et vous pouvez recommencer si des places restent.$q$, 7),
  ('paiements', $q$Les remboursements sont-ils automatiques ?$q$, $q$Non. Un remboursement n'est pas automatique : ouvrez un ticket en précisant l'achat, l'inscription ou le billet concerné et la référence du paiement. Notre équipe examine chaque demande.$q$, 8),
  ('billetterie', $q$Où trouver mon billet ?$q$, $q$Votre billet électronique, avec son QR code, s'affiche sur la page de l'événement dès que votre inscription est confirmée. Vous le retrouvez aussi dans Profil, onglet « Événements ».$q$, 9),
  ('billetterie', $q$Je n'ai pas reçu mon billet après le paiement$q$, $q$La confirmation de l'opérateur peut prendre quelques instants : rouvrez la page de l'événement. Si le billet n'apparaît toujours pas, ouvrez un ticket avec la référence du paiement Mobile Money.$q$, 10),
  ('billetterie', $q$Puis-je annuler mon inscription ?$q$, $q$Oui, depuis la page de l'événement, « Annuler mon inscription » : votre place est libérée et vous pouvez vous réinscrire s'il reste de la place. Un billet payant n'est pas remboursé automatiquement : ouvrez un ticket pour demander un remboursement.$q$, 11),
  ('billetterie', $q$Comment fonctionne le contrôle à l'entrée ?$q$, $q$L'organisateur scanne le QR code de votre billet. Un billet n'est valable qu'une seule fois : gardez-le pour vous et ne le partagez pas.$q$, 12),
  ('marketplace', $q$Comment savoir si un vendeur est fiable ?$q$, $q$Consultez son badge « vérifié », ses avis et son ancienneté sur sa page boutique. Échangez d'abord par la messagerie et privilégiez les remises en main propre sur le campus.$q$, 13),
  ('marketplace', $q$Comment fonctionne un achat groupé ?$q$, $q$Plusieurs acheteurs se regroupent autour d'une même annonce pour débloquer un prix plus bas par paliers, avec un objectif de participants et une date limite. Vous pouvez déjà suivre la progression des achats groupés dans le Marketplace ; la participation n'est pas encore ouverte.$q$, 14),
  ('marketplace', $q$L'article reçu ne correspond pas à l'annonce$q$, $q$Contactez d'abord le vendeur par la messagerie. Sans accord, ouvrez un litige depuis « Mes achats » : notre équipe examine la situation.$q$, 15),
  ('marketplace', $q$Comment publier une annonce ?$q$, $q$Depuis le Marketplace, bouton « Publier » : ajoutez des photos, un titre, une description, un prix, l'état de l'article et votre campus. Votre annonce est d'abord examinée par notre équipe, puis visible de tous une fois validée.$q$, 16),
  ('securite', $q$Comment signaler un utilisateur, une annonce ou une publication ?$q$, $q$Utilisez le bouton « Signaler » présent sur les annonces, les profils, les publications et les espaces. Notre équipe examine chaque signalement.$q$, 17),
  ('securite', $q$Quelles informations sont visibles par les autres ?$q$, $q$Les autres étudiants voient votre nom, votre photo, votre présentation, votre université et filière, vos annonces en ligne, vos avis et votre badge de vérification. Votre e-mail, votre téléphone, vos justificatifs, vos achats et vos conversations restent privés.$q$, 18),
  ('securite', $q$Comment bloquer quelqu'un ?$q$, $q$Depuis la conversation avec cette personne, utilisez « Bloquer » : elle ne peut plus vous écrire. Vous retrouvez et pouvez débloquer les personnes bloquées dans Profil > Paramètres > Confidentialité.$q$, 19),
  ('securite', $q$Je pense que mon compte est piraté$q$, $q$Changez immédiatement votre mot de passe dans Profil > Paramètres > Sécurité, puis « Déconnecter tous les autres appareils » dans « Appareils et connexions » et activez la double authentification. Ouvrez ensuite un ticket si vous constatez une activité que vous ne reconnaissez pas.$q$, 20)
) as v(c, q, a, o)
where not exists (select 1 from public.faq_items f where f.question = v.q);

-- Correction de la réponse déjà en base (le texte d'origine promettait une annonce visible dès sa publication).
update public.faq_items
   set answer = $q$Depuis le Marketplace, bouton « Publier » : ajoutez des photos, un titre, une description, un prix, l'état de l'article et votre campus. Votre annonce est d'abord examinée par notre équipe, puis visible de tous une fois validée.$q$
 where question = $q$Comment publier une annonce ?$q$
   and answer like '%visible dès sa publication%';
