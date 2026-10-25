
-- Correction : les paiements de mises en avant d'annonces étaient refusés (contrainte) et jamais réglés (pas de branche dans le règlement).

alter table public.payments drop constraint payments_exactly_one_target;
alter table public.payments add constraint payments_exactly_one_target
  check (num_nonnulls(order_id, course_enrollment_id, event_ticket_id, group_unblock_id, sponsorship_id) = 1);

create or replace function public.apply_payment_settlement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid;
  sp public.listing_sponsorships;
  v_start timestamptz;
  v_end timestamptz;
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    if new.order_id is not null then
      update public.orders set status = 'paid' where id = new.order_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'order_not_pending_payment_at_settlement', 'order_id', new.order_id));
      end if;
    elsif new.course_enrollment_id is not null then
      update public.course_enrollments set status = 'active' where id = new.course_enrollment_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'enrollment_not_pending_payment_at_settlement', 'course_enrollment_id', new.course_enrollment_id));
      end if;
    elsif new.group_unblock_id is not null then
      update public.group_buy_unblocks set status = 'paid' where id = new.group_unblock_id and status = 'pending_payment'
        returning user_id into v_user;
      if v_user is not null then
        delete from public.group_buy_blocks where user_id = v_user;
        perform public.create_notification(v_user, 'groupe', 'group_buy_unblocked', null, 'group_buy_unblock', new.group_unblock_id, '{}'::jsonb, 'gbu:' || new.group_unblock_id);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'unblock_not_pending_payment_at_settlement', 'group_unblock_id', new.group_unblock_id));
      end if;
    elsif new.sponsorship_id is not null then
      select * into sp from public.listing_sponsorships where id = new.sponsorship_id for update;
      if found and sp.status = 'pending_payment' then
        -- Les mises en avant s'enchaînent : la nouvelle période commence quand l'actuelle se termine.
        v_start := greatest(now(), coalesce(public.sponsored_until(sp.product_id), now()));
        v_end := v_start + (sp.days * interval '1 day');
        update public.listing_sponsorships
           set status = 'active', paid_at = now(), starts_at = v_start, ends_at = v_end
         where id = sp.id;
        perform public.create_notification(sp.user_id, 'produit', 'sponsorship_activated', null, 'product', sp.product_id,
          jsonb_build_object('days', sp.days, 'starts_at', v_start, 'ends_at', v_end), 'spa:' || sp.id::text);
      else
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'sponsorship_not_pending_payment_at_settlement', 'sponsorship_id', new.sponsorship_id));
      end if;
    else
      update public.event_tickets set status = 'valid' where id = new.event_ticket_id and status = 'pending_payment';
      if not found then
        insert into public.payment_ledger (payment_id, event_type, amount, currency, metadata)
        values (new.id, 'reconciliation_mismatch', new.amount, new.currency,
          jsonb_build_object('reason', 'ticket_not_pending_payment_at_settlement', 'event_ticket_id', new.event_ticket_id));
      end if;
    end if;
  end if;

  -- Paiement de mise en avant remboursé : la mise en avant est annulée.
  if new.status = 'refunded' and old.status is distinct from 'refunded' and new.sponsorship_id is not null then
    update public.listing_sponsorships
       set status = 'cancelled', cancel_reason = 'Paiement remboursé'
     where id = new.sponsorship_id and status <> 'cancelled'
     returning * into sp;
    if sp.id is not null then
      perform public.create_notification(sp.user_id, 'produit', 'sponsorship_cancelled', null, 'product', sp.product_id,
        jsonb_build_object('reason', 'Paiement remboursé', 'paid', true), 'spc:' || sp.id::text);
    end if;
  end if;

  insert into public.payment_ledger (payment_id, event_type, amount, currency)
  values (new.id, new.status::text, new.amount, new.currency);
  return new;
end;
$function$;
