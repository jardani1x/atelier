-- ATELIER cloud saves. Paste into the Supabase SQL editor and run once.
-- Row-level security is what keeps each account's designs private: the browser key is public by design.

create table if not exists public.atelier_projects (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  data text not null check (octet_length(data) <= 20971520),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);

alter table public.atelier_projects enable row level security;

drop policy if exists "atelier read own" on public.atelier_projects;
create policy "atelier read own" on public.atelier_projects
  for select to authenticated using ((select auth.uid()) = owner);

drop policy if exists "atelier insert own" on public.atelier_projects;
create policy "atelier insert own" on public.atelier_projects
  for insert to authenticated with check ((select auth.uid()) = owner);

drop policy if exists "atelier update own" on public.atelier_projects;
create policy "atelier update own" on public.atelier_projects
  for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);

drop policy if exists "atelier delete own" on public.atelier_projects;
create policy "atelier delete own" on public.atelier_projects
  for delete to authenticated using ((select auth.uid()) = owner);

revoke all on public.atelier_projects from anon;
grant select, insert, update, delete on public.atelier_projects to authenticated;
