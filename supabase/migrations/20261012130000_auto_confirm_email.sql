-- Workaround when the dashboard "Confirm email" toggle cannot be turned off:
-- auto-confirm emails so users can sign in immediately after signup.

create or replace function public.auto_confirm_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Hosted Auth still inserts users as unconfirmed when Confirm email is on.
  -- Setting the timestamp here allows password login without a confirmation link.
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_auto_confirm on auth.users;

create trigger on_auth_user_created_auto_confirm
  before insert on auth.users
  for each row
  execute function public.auto_confirm_user_email();

-- Confirm any existing users who are stuck unverified.
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;
