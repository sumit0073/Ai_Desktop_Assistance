# Speech-to-text secret management

## Critical rule

The Groq API key must **never** ship in:

- the React/Vite bundle (`VITE_*`)
- the Tauri/Rust binary
- installer artifacts
- CI variables that Vite inlines into the frontend

Production transcription goes through an **authenticated Supabase Edge Function** (`stt-proxy`) that holds `GROQ_API_KEY` as a server secret.

## Architecture

```
Desktop app (signed-in Supabase user)
  → Authorization: Bearer <user access_token>
  → POST VITE_STT_PROXY_URL  (…/functions/v1/stt-proxy)
  → Edge Function verifies JWT via supabase.auth.getUser()
  → Edge Function calls Groq with GROQ_API_KEY
  → { text, requestId } → client sanitizes → TranscriptResult
```

CORS is **not** authentication. The function requires a valid user JWT.

## Request / response contract

**POST** `multipart/form-data`

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | WAV/WebM/etc., max 3 MiB |
| `model` | no | `whisper-large-v3` (default) or `whisper-large-v3-turbo` |
| `prompt` | no | Max 900 chars (Whisper context/vocab) |
| `language` | no | Default `en` |

**Headers**

- `Authorization: Bearer <supabase access_token>` (required)
- `apikey: <VITE_SUPABASE_ANON_KEY>` (recommended for Supabase gateway)

**200 response**

```json
{ "text": "transcribed words", "requestId": "uuid" }
```

Errors return `{ "message": "...", "requestId": "..." }` with 4xx/5xx. Upstream Groq bodies and secrets are never forwarded.

## Deploy the Edge Function

Full checklist: [proxy-deploy.md](./proxy-deploy.md) and [production-readiness.md](./production-readiness.md).

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/cli), project access, linked project.

```bash
# From repo root
supabase login
supabase link --project-ref <your-project-ref>

# Server-side secret (never a VITE_ variable; use a rotated key)
supabase secrets set GROQ_API_KEY=...

# Deploy
supabase functions deploy stt-proxy
supabase functions deploy chat-proxy
```

**Rate limits** are in-memory per Edge isolate (best-effort only).

Confirm in the dashboard: **Edge Functions → stt-proxy**, and that `GROQ_API_KEY` appears under **Project Settings → Edge Functions → Secrets**.

Default URL:

```text
https://<project-ref>.supabase.co/functions/v1/stt-proxy
```

## Production client build

Set **only** public values for Vite:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
VITE_STT_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/stt-proxy
VITE_CHAT_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/chat-proxy
VITE_GROQ_MODEL=openai/gpt-oss-20b
VITE_GROQ_VISION_MODEL=qwen/qwen3.8-27b
```

Do **not** set `VITE_GROQ_API_KEY`, `VITE_ALLOW_DIRECT_GROQ_STT`, or
`VITE_ALLOW_DIRECT_GROQ_CHAT` for production CI/releases.

GitHub Actions should use repository secrets/vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STT_PROXY_URL`
- `VITE_CHAT_PROXY_URL`

Chat/vision uses the separate `chat-proxy` — see [ai-security.md](./ai-security.md).
Rotate any Groq key that was previously shipped in a client build.
Run `npm run check:bundle-secrets` after production builds.

## Local development

**Preferred:** run the proxy locally or against your linked project and set `VITE_STT_PROXY_URL`.

**Explicit insecure opt-in (local only):**

```env
VITE_ALLOW_DIRECT_GROQ_STT=true
VITE_GROQ_API_KEY=gsk_...
```

Production builds **refuse** direct Groq STT even if these are present.

## Verify the bundle has no Groq secret

After `npm run build`:

```bash
# Should print nothing (no matches)
rg -i "gsk_|VITE_GROQ_API_KEY\\s*=\\s*[^y]" dist || true
```

Never paste secret values into logs. A green frontend build alone does not prove protection — confirm production env omits the key and the proxy is deployed.

## Auth prerequisite

Seecog already uses Supabase Auth (`AuthContext` + `supabase-js` session). Demo mode has **no** access token; STT via proxy requires a real signed-in session.
