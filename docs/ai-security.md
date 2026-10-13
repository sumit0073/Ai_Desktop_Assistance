# Chat / vision AI secret management

## Critical rule

Provider API keys (Groq, etc.) must **never** ship in:

- the React/Vite bundle (`VITE_*` secrets)
- the Tauri/Rust binary
- installer artifacts
- CI variables that Vite inlines into the frontend

Production chat and screenshot analysis go through an **authenticated Supabase Edge Function** (`chat-proxy`) that holds `GROQ_API_KEY` as a server secret. Speech-to-text uses the separate `stt-proxy` (see [stt-security.md](./stt-security.md)).

## Architecture

```
Desktop app (signed-in Supabase user)
  → Authorization: Bearer <user access_token>
  → POST VITE_CHAT_PROXY_URL  (…/functions/v1/chat-proxy)
  → Edge Function verifies JWT via supabase.auth.getUser()
  → Edge Function streams Groq chat.completions with GROQ_API_KEY
  → SSE text/event-stream → client (analyzeWithAi)
```

CORS is **not** authentication. The function requires a valid user JWT.

Demo mode has **no** access token; chat via the proxy requires a real signed-in session.

## Request / response contract

**POST** `application/json`

```json
{
  "model": "openai/gpt-oss-20b",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.35,
  "stream": true
}
```

Vision messages use OpenAI-style parts with **data URLs only**:

```json
{
  "type": "image_url",
  "image_url": { "url": "data:image/png;base64,..." }
}
```

| Constraint | Limit |
| --- | --- |
| Models | `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` only |
| Messages | max 20 |
| Text chars (aggregate) | 120_000 |
| Images | max 2; data URL only; ~2.1M chars each |
| Temperature | 0–1 |
| Stream | required (`true`) |

**Headers**

- `Authorization: Bearer <supabase access_token>` (required)
- `apikey: <VITE_SUPABASE_ANON_KEY>` (recommended for Supabase gateway)

**200 response:** `text/event-stream` (OpenAI/Groq chat.completion.chunk frames).

Errors return JSON `{ "message": "...", "requestId": "..." }` with 4xx/5xx. Upstream Groq bodies and secrets are never forwarded. Logs include request id, user id, model, and size metrics — not prompts or images.

## Deploy the Edge Function

Full checklist: [proxy-deploy.md](./proxy-deploy.md) and [production-readiness.md](./production-readiness.md).

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set GROQ_API_KEY=...
supabase functions deploy chat-proxy
supabase functions deploy stt-proxy
```

Default URL:

```text
https://<project-ref>.supabase.co/functions/v1/chat-proxy
```

**Rate limits** are in-memory per Edge isolate (best-effort only).

## Production client build

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
VITE_STT_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/stt-proxy
VITE_CHAT_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/chat-proxy
VITE_GROQ_MODEL=openai/gpt-oss-20b
VITE_GROQ_VISION_MODEL=qwen/qwen3.8-27b
```

Do **not** set `VITE_GROQ_API_KEY`, `VITE_ALLOW_DIRECT_GROQ_CHAT`, or `VITE_ALLOW_DIRECT_GROQ_STT` for production CI/releases.

GitHub Actions secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STT_PROXY_URL`
- `VITE_CHAT_PROXY_URL`

## Local development

**Preferred:** point at deployed (or local) functions:

```env
VITE_CHAT_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/chat-proxy
VITE_STT_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/stt-proxy
```

**Explicit insecure opt-in (local only):**

```env
VITE_ALLOW_DIRECT_GROQ_CHAT=true
VITE_ALLOW_DIRECT_GROQ_STT=true
VITE_GROQ_API_KEY=...
```

Production builds **refuse** direct Groq even if these are present. Client key reads are gated behind `import.meta.env.DEV` so production minification can drop them.

## Verify the bundle has no Groq secret

```bash
npm run build
npm run check:bundle-secrets
```

Never paste secret values into logs. A green frontend build alone does not prove protection — confirm production env omits the key, proxies are deployed, and release artifacts are scanned.
