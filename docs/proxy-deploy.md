# Deploy Seecog chat-proxy and stt-proxy

**This document does not deploy anything.** Do not run deploy commands until you have
explicitly confirmed the target Supabase **project ref** (Dashboard → Project Settings → General).

Never print, commit, or paste secret values into issues, chat logs, or Vite `VITE_*` variables.

**Docker is not used and not required.** Prefer hosted/linked CLI flows
(`link`, `db query --linked`, `db push`, `secrets set`, `functions deploy`).
Do not introduce Docker Desktop, `supabase start`, or local container workflows
unless the operator explicitly asks for them.

## What the code expects

| Item | Value in repo |
| --- | --- |
| Function directories | `supabase/functions/stt-proxy/`, `supabase/functions/chat-proxy/` |
| Config | `supabase/config.toml` → `verify_jwt = true` for both |
| Server secret name | `GROQ_API_KEY` (Edge Function secret only) |
| Client STT URL | `VITE_STT_PROXY_URL` → `…/functions/v1/stt-proxy` |
| Client chat URL | `VITE_CHAT_PROXY_URL` → `…/functions/v1/chat-proxy` |
| Auth | `Authorization: Bearer <Supabase user access_token>` + recommended `apikey: <anon key>` |
| Demo mode | No JWT → proxies must reject (do not weaken this) |

## Safe operator sequence

### 0. Confirm project ref

1. Open the Supabase Dashboard for the **intended** project (prod or staging — pick one deliberately).
2. Copy **Project Settings → General → Reference ID**.
3. Write it down locally; use that exact value in every command below.

### 1. Install the Supabase CLI (official options)

Pick one official method:

**npm (cross-platform)**

```bash
npm install -g supabase
supabase --version
```

**Scoop (Windows)**

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
supabase --version
```

**Homebrew (macOS)**

```bash
brew install supabase/tap/supabase
supabase --version
```

Docs: https://supabase.com/docs/guides/cli/getting-started

If CLI install fails in an automated environment, stop here — deployment is **BLOCKED** until the operator installs the CLI on a trusted machine.

### 2. Log in and link the selected project

```bash
supabase login
supabase link --project-ref <YOUR_CONFIRMED_PROJECT_REF>
```

Verify the CLI reports the same project ref you confirmed in step 0. If it does not match, **abort** — do not deploy.

### 3. Rotate the previously exposed Groq key

A Groq key that lived in a client `.env` or bundle must be treated as compromised.

1. Open https://console.groq.com/keys
2. **Create a new key** (do not reuse the old value).
3. **Revoke / delete the old key** in the Groq console.
4. Store the new key only in a password manager or secrets store — not in the repo, not in `VITE_*`, not in GitHub Actions frontend build secrets.

Mark `Secret rotation` as **PASS** in `production-readiness.md` only after you have revoked the old key and confirmed a new one is in use server-side.

### 4. Set the server-side secret

```bash
# Paste the NEW key when prompted / via your shell — never commit the command history with the value.
supabase secrets set GROQ_API_KEY
```

Or:

```bash
supabase secrets set GROQ_API_KEY=<NEW_ROTATED_KEY>
```

Confirm in Dashboard: **Project Settings → Edge Functions → Secrets** that `GROQ_API_KEY` exists (value hidden).

Both functions read **only** `Deno.env.get("GROQ_API_KEY")`.

### 4b. Apply AI quota migration (required)

```bash
supabase db push
# or run supabase/migrations/20261013140000_ai_quota_rate_limits.sql in the SQL Editor
```

Smoke-check (as a SQL editor / service role session):

```sql
select public.ai_quota_limits();
```

### 5. Deploy both Edge Functions

```bash
supabase functions deploy stt-proxy
supabase functions deploy chat-proxy
```

Expected URLs:

```text
https://<YOUR_CONFIRMED_PROJECT_REF>.supabase.co/functions/v1/stt-proxy
https://<YOUR_CONFIRMED_PROJECT_REF>.supabase.co/functions/v1/chat-proxy
```

Evidence for **Supabase deployment = PASS**:

- Both deploy commands exit 0
- Dashboard lists `stt-proxy` and `chat-proxy`
- Unauthenticated probes below return 4xx (not 200)

### 6. Configure GitHub Actions (release builds)

Repository → **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | public anon / publishable key only |
| `VITE_STT_PROXY_URL` | `https://<ref>.supabase.co/functions/v1/stt-proxy` |
| `VITE_CHAT_PROXY_URL` | `https://<ref>.supabase.co/functions/v1/chat-proxy` |

Optional **Variables** (names only): `VITE_GROQ_MODEL`, `VITE_GROQ_VISION_MODEL`.

**Do not** add `GROQ_API_KEY` or `VITE_GROQ_API_KEY` to secrets that the workflow writes into the Vite `.env`. Release workflows refuse `.env` lines containing `GROQ_API_KEY` or `ALLOW_DIRECT_GROQ`.

### 7. Verify unauthenticated rejection

```bash
# Expect 401 (or other 4xx) — never 200
curl -sS -o stt-unauth.json -w "%{http_code}\n" \
  -X POST "$VITE_STT_PROXY_URL" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"

curl -sS -o chat-unauth.json -w "%{http_code}\n" \
  -X POST "$VITE_CHAT_PROXY_URL" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-oss-20b","messages":[{"role":"user","content":"ping"}],"stream":true}'
```

Inspect JSON for `message` / `requestId` only. Bodies must not contain Groq key material. Delete the temp JSON files afterward.

### 8. Opt-in live authenticated tests

Create a **dedicated** Supabase Auth user for tests (not demo mode, prefer not your personal admin account).

**PowerShell**

```powershell
$env:SEECOG_LIVE_PROXY_TESTS = "1"
$env:VITE_SUPABASE_URL = "https://<ref>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "<anon-key>"
$env:VITE_CHAT_PROXY_URL = "https://<ref>.supabase.co/functions/v1/chat-proxy"
$env:VITE_STT_PROXY_URL = "https://<ref>.supabase.co/functions/v1/stt-proxy"
$env:LIVE_TEST_EMAIL = "<dedicated-test-user@example.com>"
$env:LIVE_TEST_PASSWORD = "<dedicated-test-password>"
npm run test:live
```

**bash**

```bash
export SEECOG_LIVE_PROXY_TESTS=1
export VITE_SUPABASE_URL=https://<ref>.supabase.co
export VITE_SUPABASE_ANON_KEY=<anon-key>
export VITE_CHAT_PROXY_URL=https://<ref>.supabase.co/functions/v1/chat-proxy
export VITE_STT_PROXY_URL=https://<ref>.supabase.co/functions/v1/stt-proxy
export LIVE_TEST_EMAIL=<dedicated-test-user@example.com>
export LIVE_TEST_PASSWORD=<dedicated-test-password>
npm run test:live
```

Evidence for **Live authenticated proxy tests = PASS**:

- Vitest reports the suite `live proxy integration (authenticated)` with **0 skipped** in that suite
- Auth rejection cases and signed-in chat/STT cases all pass
- Ordinary `npm test` still does **not** run live cases

If credentials are missing, `npm run test:live` reports the suite `live proxy integration (not configured — skipped)` — that is **NOT TESTED**, not PASS.

### 9. Clean release workflow + bundle-secret artifact

1. Trigger **Build Windows Installer** (and macOS if shipping) via Actions or a `v*` tag.
2. Confirm the job fails fast if proxy URL secrets are missing.
3. Confirm **Quality gates** run before packaging.
4. Download artifact `security-check-windows` (or `security-check-macos-*`).
5. Confirm the log contains: `[secret-check] OK — no Groq secret patterns found in dist/`

Evidence for **Release artifact secret scan = PASS**: that artifact from a successful release run on the commit you intend to ship.

## Rate limiting (Postgres — durable)

In-memory Maps are **removed**. Both proxies call `ai_begin_ai_request` (see [ai-quota.md](./ai-quota.md)).

| Function | Implementation | Durable across isolates? |
| --- | --- | --- |
| `stt-proxy` / `chat-proxy` | Postgres fixed-window + daily units + inflight | **Yes** (after migration applied) |

**Required before production traffic:** apply
`supabase/migrations/20261013140000_ai_quota_rate_limits.sql`, then redeploy functions.
Without the migration, proxies **fail closed** (503) when the RPC is missing.
