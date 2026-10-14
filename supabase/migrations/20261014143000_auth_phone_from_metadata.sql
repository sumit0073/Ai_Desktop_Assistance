-- Copy signup phone from user_metadata onto auth.users.phone and auto-confirm it
-- so SMS OTP login works for accounts created with email + phone.

create or replace function public.auto_confirm_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_phone text;
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());

  meta_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
  if (new.phone is null or new.phone = '') and meta_phone is not null then
    -- Skip if another user already owns this phone (unique constraint).
    if not exists (
      select 1
      from auth.users existing
      where existing.phone = meta_phone
        and existing.id is distinct from new.id
    ) then
      new.phone := meta_phone;
    end if;
  end if;

  if new.phone is not null and new.phone <> '' then
    new.phone_confirmed_at := coalesce(new.phone_confirmed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_auto_confirm on auth.users;

create trigger on_auth_user_created_auto_confirm
  before insert on auth.users
  for each row
  execute function public.auto_confirm_user_email();

-- Backfill existing users that only stored phone in metadata.
update auth.users u
set
  phone = meta.phone,
  phone_confirmed_at = coalesce(u.phone_confirmed_at, now())
from (
  select
    id,
    nullif(trim(coalesce(raw_user_meta_data->>'phone', '')), '') as phone
  from auth.users
) as meta
where u.id = meta.id
  and (u.phone is null or u.phone = '')
  and meta.phone is not null
  and not exists (
    select 1
    from auth.users other
    where other.phone = meta.phone
      and other.id <> u.id
  );
