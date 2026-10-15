-- Stop auto-confirming emails so Auth emits signup/confirm events.
-- Delivery is Amazon SES via the Send Email hook (not Supabase's mailer).

drop trigger if exists on_auth_user_created_auto_confirm on auth.users;

drop function if exists public.auto_confirm_user_email();
