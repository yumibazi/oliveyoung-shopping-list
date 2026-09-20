-- Run once in your Supabase project's SQL Editor.
-- Only the signed-in owner can read or modify their shopping list.
create table if not exists public.shopping_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint shopping_sync_object check (jsonb_typeof(data) = 'object'),
  constraint shopping_sync_size check (octet_length(data::text) <= 8388608)
);
alter table public.shopping_sync enable row level security;
revoke all on public.shopping_sync from anon;
grant select, insert, update on public.shopping_sync to authenticated;
drop policy if exists shopping_owner_select on public.shopping_sync;
create policy shopping_owner_select on public.shopping_sync for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists shopping_owner_insert on public.shopping_sync;
create policy shopping_owner_insert on public.shopping_sync for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists shopping_owner_update on public.shopping_sync;
create policy shopping_owner_update on public.shopping_sync for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Atomic optimistic locking: no rows returned means another device saved first.
create or replace function public.save_shopping_sync(expected_version bigint, next_data jsonb)
returns setof public.shopping_sync
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if expected_version = 0 then
    return query insert into public.shopping_sync(user_id, data, version)
      values (auth.uid(), next_data, 1) on conflict (user_id) do nothing returning *;
  else
    return query update public.shopping_sync set data = next_data,
      version = shopping_sync.version + 1, updated_at = now()
      where user_id = auth.uid() and version = expected_version returning *;
  end if;
end;
$$;
revoke all on function public.save_shopping_sync(bigint, jsonb) from public, anon;
grant execute on function public.save_shopping_sync(bigint, jsonb) to authenticated;
