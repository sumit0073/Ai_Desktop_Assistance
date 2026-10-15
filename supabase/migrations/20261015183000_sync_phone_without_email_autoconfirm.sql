-- Restore phone sync from signup metadata WITHOUT auto-confirming email.
-- Email verification is required (SES send-email delivers the signup OTP).

create or replace function public.sync_auth_user_phone_from_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_phone text;
begin
  -- Do NOT set email_confirmed_at — users must verify via OTP in the app.

  meta_phone := ltrim(
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    '+'
  );

  if (new.phone is null or new.phone = '') and meta_phone is not null then
    if not exists (
      select 1
      from auth.users existing
      where existing.phone = meta_phone
        and existing.id is distinct from new.id
    ) then
      new.phone := meta_phone;
    end if;
  elsif new.phone like '+%' then
    new.phone := ltrim(new.phone, '+');
  end if;

  if new.phone is not null and new.phone <> '' then
    new.phone_confirmed_at := coalesce(new.phone_confirmed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_auto_confirm on auth.users;
drop trigger if exists on_auth_user_created_sync_phone on auth.users;

create trigger on_auth_user_created_sync_phone
  before insert on auth.users
  for each row
  execute function public.sync_auth_user_phone_from_metadata();
