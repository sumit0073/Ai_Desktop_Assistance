-- GoTrue stores phones as E.164 digits without a leading '+'.
-- Our earlier trigger copied metadata phones with '+', so SMS OTP lookup failed.

-- Remove orphan phone-only users (no email) that block the real email account's
-- normalized phone after we strip '+'.
delete from auth.identities i
using auth.users u
where i.user_id = u.id
  and u.email is null
  and u.phone in ('919631820308', '917348820668', '+919631820308', '+917348820668');

delete from auth.users
where email is null
  and phone in ('919631820308', '917348820668', '+919631820308', '+917348820668');

-- Normalize phones: strip leading '+'.
update auth.users
set phone = ltrim(phone, '+')
where phone like '+%';

update auth.users
set phone_change = ltrim(phone_change, '+')
where phone_change like '+%';

-- Sync any remaining metadata phones onto auth.users (digits only, no '+').
update auth.users u
set
  phone = meta.phone,
  phone_confirmed_at = coalesce(u.phone_confirmed_at, now())
from (
  select
    id,
    ltrim(
      nullif(trim(coalesce(raw_user_meta_data->>'phone', '')), ''),
      '+'
    ) as phone
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

-- Trigger: copy metadata phone without leading '+' and auto-confirm.
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
