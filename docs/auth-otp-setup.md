# Email + SMS OTP setup (System Bunny)

The desktop app supports password login and **OTP login** (email or SMS). OTP codes are entered **in the app** (no deep link).

## 1. Apply the phone sync migration

Already applied on the linked project when set up:

`supabase/migrations/20261014143000_auth_phone_from_metadata.sql`

This copies signup phone numbers from `user_metadata` onto `auth.users.phone` so SMS OTP can target those accounts.

## 2. Email via Amazon SES (Send Email hook — not Supabase mail)

**Same idea as Mini Task Manager:** your code talks to **Amazon SES SMTP** (`SMTP_*` in env). Supabase’s built-in mailer and Dashboard SMTP stay **off**.

1. Supabase Auth **creates** the token / OTP (it does not send mail)  
2. Edge Function `send-email` sends with **Nodemailer → SES SMTP** (like MiniTM’s `email.service`)  
3. User confirms / logs in / resets from that email  

Covers: **welcome/confirm** (`signup`), invite, **OTP login** (`magiclink` → code), **forgot password** (`recovery` → Reset button), email change.

Also apply migration `20261015110046_remove_auto_confirm_email_for_ses.sql` so signup is not auto-confirmed (otherwise no welcome/confirm email).

### 2a. Env keys (same as Mini Task Manager / OpsPick)

```env
AWS_SES_REGION=ap-south-1
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="System Bunny <hello@opspick.com>"
SEND_EMAIL_HOOK_SECRETS=v1,whsec_<base64-secret>
```

Never put these in `VITE_*`. Copy `SMTP_*` from `mini-task-manager/.env`. Generate the hook secret (Dashboard “Generate secret”, or a random `whsec_` value).

### 2b. Deploy Edge Function + secrets (hosted)

```bash
# From repo root (project must be linked)
npx supabase secrets set \
  AWS_SES_REGION="ap-south-1" \
  SMTP_HOST="email-smtp.ap-south-1.amazonaws.com" \
  SMTP_PORT="587" \
  SMTP_USER="..." \
  SMTP_PASS="..." \
  SMTP_FROM="System Bunny <hello@opspick.com>" \
  SEND_EMAIL_HOOK_SECRETS="v1,whsec_..."

npx supabase functions deploy send-email --no-verify-jwt
```

### 2c. Enable Send Email hook on the hosted project (required)

Deploying `send-email` alone is **not** enough. Until the hook is **enabled** on Auth, Supabase keeps using its **built-in mailer** (localhost reset links).

Push from this repo (preferred):

```bash
node scripts/push-auth-hooks.mjs
```

Or in Dashboard → **Authentication → Hooks → Send Email**:

1. Type: **HTTPS**
2. URL: `https://kjuywrbscqihdyfchrhr.supabase.co/functions/v1/send-email`
3. Secret: same as `SEND_EMAIL_HOOK_SECRETS` in `.env`
4. **Enable** the hook
5. Leave **Authentication → SMTP** **disabled**
6. **Providers → Email → Confirm email** **ON** (welcome/confirm via SES)
7. Email attempt cap: hosted Auth cannot delete rate limits entirely; this project sets  
   `rate_limit_email_sent` to **1_000_000** (effectively off). Re-run  
   `node scripts/raise-email-rate-limit.mjs` if the Dashboard reset it.

When the hook is enabled, Auth never sends through Supabase’s mailer — SES does.

### 2d. Local Supabase (`supabase start`)

`supabase/config.toml` already wires `[auth.hook.send_email]` to the local function. Put secrets in the environment / `supabase/functions/.env`, then:

```bash
npx supabase functions serve send-email --no-verify-jwt
```

### 2e. App flows (codes in-app, no localhost links)

| Auth event | Hook `email_action_type` | User action |
| --- | --- | --- |
| Signup / welcome | `signup` | Confirm email button (or code) |
| Email OTP login | `magiclink` | Enter OTP in the app |
| Forgot password | `recovery` | **Reset password** button (or code in app) |
| Email change | `email_change` | Confirm button / code |

Until the hook is deployed and enabled, use **password sign-in** or **SMS OTP**. Fallback: Forgot password → SMS (BlackSMS).

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
