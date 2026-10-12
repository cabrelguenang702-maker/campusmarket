-- 0030 — « Suivre un vendeur » (bouton de la boutique) : abonnements et compteur d'abonnés.
create table public.profile_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index profile_follows_followee_idx on public.profile_follows (followee_id);
alter table public.profile_follows enable row level security;

create policy profile_follows_select_own on public.profile_follows
  for select to authenticated using (follower_id = (select auth.uid()));
create policy profile_follows_insert_own on public.profile_follows
  for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and public.is_active_account()
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = followee_id and b.blocked_id = follower_id)
         or (b.blocker_id = follower_id and b.blocked_id = followee_id)
    )
  );
create policy profile_follows_delete_own on public.profile_follows
  for delete to authenticated using (follower_id = (select auth.uid()));
create trigger profile_follows_rate_limit before insert on public.profile_follows
  for each row execute function public.enforce_rate_limit('follower_id', '100', '86400');
revoke update on public.profile_follows from authenticated;

alter table public.seller_stats add column followers_count integer not null default 0 check (followers_count >= 0);

create function public.tg_profile_follows_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.seller_stats (seller_id, followers_count) values (new.followee_id, 1)
    on conflict (seller_id) do update set followers_count = public.seller_stats.followers_count + 1;
  else
    update public.seller_stats set followers_count = greatest(followers_count - 1, 0) where seller_id = old.followee_id;
  end if;
  return null;
end $$;
revoke all on function public.tg_profile_follows_count() from public, anon, authenticated;
create trigger profile_follows_count after insert or delete on public.profile_follows
  for each row execute function public.tg_profile_follows_count();
