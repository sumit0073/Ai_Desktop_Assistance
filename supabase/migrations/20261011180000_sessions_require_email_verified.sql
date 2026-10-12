-- Require a verified email before creating app sessions (defense in depth).
-- JWT claim email_verified is set by Supabase Auth after confirmation.

drop policy if exists "sessions_insert_own" on public.sessions;

create policy "sessions_insert_own"
  on public.sessions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and coalesce((select auth.jwt() ->> 'email_verified')::boolean, false) = true
  );
