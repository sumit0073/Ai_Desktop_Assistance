-- Allow authenticated users to create sessions without email confirmation.

drop policy if exists "sessions_insert_own" on public.sessions;

create policy "sessions_insert_own"
  on public.sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
