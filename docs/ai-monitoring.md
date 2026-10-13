# AI proxy monitoring (privacy-conscious)

## What is stored

Table `public.ai_proxy_events` (via `ai_log_proxy_event`):

| Column | Purpose |
| --- | --- |
| `request_id` | Correlate client + Edge logs |
| `user_id` | UUID only (`auth.uid()`) |
| `kind` | `chat` / `vision` / `stt` / `auth` / `system` |
| `event` | Safe category (see below) |
| `http_status` | Response class |
| `latency_ms` | Provider/proxy latency |
| `created_at` | Timestamp |

**Never logged:** Groq keys, JWTs, prompts, transcripts, raw audio, image payloads.

### Event categories

`allowed`, `rate_limited`, `budget_exhausted`, `inflight_limited`, `auth_fail`, `db_fail`, `provider_error`, `provider_timeout`, `ok`, `cancelled`

Edge stdout also emits compact lines: `[chat-proxy|stt-proxy] <requestId> …` without payload bodies.

## Practical queries (SQL Editor / service role)

```sql
-- Rate-limit rejections last hour
select kind, event, count(*)
from public.ai_proxy_events
where created_at > now() - interval '1 hour'
  and event in ('rate_limited', 'budget_exhausted', 'inflight_limited')
group by 1, 2
order by 3 desc;

-- Auth failures
select date_trunc('hour', created_at) as hour, count(*)
from public.ai_proxy_events
where event = 'auth_fail'
  and created_at > now() - interval '24 hours'
group by 1
order by 1;

-- Quota DB failures (fail-closed path)
select count(*) from public.ai_proxy_events
where event = 'db_fail' and created_at > now() - interval '1 hour';

-- Provider health
select kind, event, round(avg(latency_ms)) as avg_ms, count(*)
from public.ai_proxy_events
where event in ('ok', 'provider_error', 'provider_timeout')
  and created_at > now() - interval '1 hour'
group by 1, 2;

-- Budget exhaustion (daily)
select user_id, kind, count(*)
from public.ai_proxy_events
where event = 'budget_exhausted'
  and created_at > date_trunc('day', timezone('utc', now()))
group by 1, 2
order by 3 desc
limit 50;
```

## Suggested alerts

| Signal | Threshold (starting point) | Action |
| --- | --- | --- |
| `db_fail` count | > 5 in 5 minutes | Check Postgres / RPC migration applied |
| `auth_fail` spike | > 100 in 5 minutes | Possible credential stuffing; review Auth logs |
| `provider_timeout` / `provider_error` | > 20% of `ok`+errors | Check Groq status; consider backoff messaging |
| `budget_exhausted` | Sudden many distinct users | Confirm limits; check for abuse |
| `rate_limited` | Sustained high | Expected under load; watch for single-user abuse via per-user query |

Wire these in Supabase Logs / external APM as available. Exact tooling may vary by plan.

## Incident response (short)

1. Note `x-request-id` from the client error.
2. Search Edge logs and `ai_proxy_events` for that id.
3. Classify: auth / quota / provider / validation.
4. **Never** paste JWTs, audio, or prompts into tickets.
5. If keys may be exposed: rotate Groq key (`supabase secrets set GROQ_API_KEY`) and revoke the old key.
6. If DB quota RPC missing: apply migration `20261013140000_ai_quota_rate_limits.sql`, redeploy functions.

## Retention

```sql
select public.ai_cleanup_quota_data(14);
```

Keeps operational history without indefinite PII retention (user UUID only).
