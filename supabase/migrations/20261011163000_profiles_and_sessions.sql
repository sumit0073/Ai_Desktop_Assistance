-- Profiles + app sessions linked to auth.users, with RLS.
-- Apply in Supabase SQL Editor, or: supabase db push

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid not null references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id)
);

comment on table public.profiles is 'User profile data linked 1:1 with auth.users';
comment on column public.profiles.full_name is 'Display / legal full name';
comment on column public.profiles.phone is 'Contact phone number';

create index profiles_phone_idx on public.profiles (phone);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-create profile from signup metadata (full_name, phone)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- sessions (app usage windows — not auth.sessions)
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id),
  constraint sessions_end_after_start
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.sessions is 'App session windows (start/end) owned by a user';
comment on column public.sessions.started_at is 'When the session began';
comment on column public.sessions.ended_at is 'When the session ended; null while active';

create index sessions_user_id_started_at_idx
  on public.sessions (user_id, started_at desc);

create index sessions_user_id_active_idx
  on public.sessions (user_id)
  where ended_at is null;

-- ---------------------------------------------------------------------------
-- Grants (Data API)
-- ---------------------------------------------------------------------------
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.sessions to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

-- profiles: users can read/update only their own row
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Inserts come from the auth trigger (security definer), not the client.
-- No insert/delete policies for authenticated on profiles.

-- sessions: full CRUD on own rows only
create policy "sessions_select_own"
  on public.sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "sessions_insert_own"
  on public.sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "sessions_update_own"
  on public.sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "sessions_delete_own"
  on public.sessions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
