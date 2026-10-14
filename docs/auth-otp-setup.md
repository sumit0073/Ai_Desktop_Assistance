# Email + SMS OTP setup (System Bunny)

The desktop app supports password login and **OTP login** (email or SMS). OTP codes are entered **in the app** (no deep link).

## 1. Apply the phone sync migration

Already applied on the linked project when set up:

`supabase/migrations/20261014143000_auth_phone_from_metadata.sql`

This copies signup phone numbers from `user_metadata` onto `auth.users.phone` so SMS OTP can target those accounts.

## 2. Email OTP (hosted Dashboard)

1. Configure **custom SMTP** (e.g. Amazon SES from OpsPick) under Authentication → SMTP.
2. Open **Authentication → Email Templates → Magic Link**.
3. Use a code template, for example:

```html
<h2>Your System Bunny sign-in code</h2>
<p>Enter this code in the app:</p>
<p><strong>{{ .Token }}</strong></p>
```

4. Set **Site URL** (URL Configuration) away from `http://localhost:1420` for non-dev use.

## 3. SMS OTP via BlackSMS (Send SMS hook)

Supabase has no built-in BlackSMS provider. System Bunny uses the same pattern as **OpsPick / MiniTaskManager**:

1. Supabase Auth generates the OTP  
2. Edge Function `send-sms` delivers it through **BlackSMS**  
3. App verifies with `verifyOtp({ phone, token, type: 'sms' })`

### Deploy / secrets

```bash
# From repo root (project must be linked)
npx supabase secrets set \
  BLACKSMS_API_KEY="..." \
  BLACKSMS_SENDER_ID="617" \
  BLACKSMS_ROUTE="1" \
  BLACKSMS_SMS_URL="https://blacksms.in/sms" \
  SEND_SMS_HOOK_SECRETS="v1,whsec_<base64-secret>"

npx supabase functions deploy send-sms --no-verify-jwt
```

Copy `BLACKSMS_*` from MiniTaskManager `.env` (same account / sender).

### Enable in Dashboard

1. **Authentication → Providers → Phone** → enable Phone (Twilio fields can stay empty when using the hook).
2. **Authentication → Hooks → Send SMS**:
   - Type: **HTTPS**
   - URL: `https://kjuywrbscqihdyfchrhr.supabase.co/functions/v1/send-sms`
   - Secret: same value as `SEND_SMS_HOOK_SECRETS` (`v1,whsec_...`)
3. Save and enable the hook.

BlackSMS expects **Indian** numbers (`+91` → 10-digit local). Recharge the BlackSMS wallet before live tests.

## 4. App environment

No extra Vite keys for OTP beyond:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 5. Local Supabase (optional)

`supabase/config.toml` wires `[auth.hook.send_sms]` to the local `send-sms` function. Put secrets in `supabase/functions/.env`:

```env
SEND_SMS_HOOK_SECRETS=v1,whsec_...
BLACKSMS_API_KEY=...
BLACKSMS_SENDER_ID=617
BLACKSMS_ROUTE=1
BLACKSMS_SMS_URL=https://blacksms.in/sms
```

Then:

```bash
npx supabase functions serve send-sms --no-verify-jwt
```

## 6. How login works in the app

1. Login → **Sign in with OTP**
2. Choose **Email** or **SMS**
3. **Send code** → `signInWithOtp` (`shouldCreateUser: false`)
4. Enter 6-digit code → `verifyOtp` (`email` or `sms`)
5. Session is stored like password login

Users must already have an account (sign up with email/password + phone). SMS only works after the phone is on `auth.users.phone`.
