# System Bunny AI quota and rate limiting

Durable enforcement lives in Postgres (not Edge isolate memory).

## Algorithm

**Fixed windows (UTC)** with atomic upserts:

```sql
INSERT ... ON CONFLICT DO UPDATE
SET request_count = request_count + units
WHERE request_count + units <= limit
RETURNING request_count;
```

Postgres row locks serialize concurrent upserts on `(user_id, bucket, window_start)`, so two requests at `limit - 1` cannot both succeed.

`ai_begin_ai_request` runs minute (aggregate + kind), daily units, and inflight checks inside a subtransaction. Any denial rolls back partial bumps from that call, then logs a denial event.

Identity is always `auth.uid()` from the verified JWT. Client-supplied user IDs are ignored.

## Limits (estimated cost control — not exact Groq billing)

| Bucket | Limit |
| --- | --- |
| Aggregate (chat + vision + STT) | **40 requests / user / UTC minute** |
| Chat text | 30 / min · 500 units / UTC day |
| Vision | 10 / min · 80 units / UTC day |
| STT | 30 / min · 400 units / UTC day |
| In-flight | chat 3 · vision 2 · STT 2 |

**Unit estimates** (see `src/lib/aiQuotaPolicy.ts`):

- Chat text: `ceil(textChars / 4000)` (min 1)
- Vision: `5 + 3 * imageCount`
- STT: `ceil(audioBytes / 200000)` (min 1)

These are abuse/budget heuristics. Exact USD cost is not claimed when provider usage data is incomplete.

## Fail-closed behaviour

If `ai_begin_ai_request` RPC errors (DB down, timeout, mis-migration), proxies return **503** and **do not** call Groq.

## Counting policy

Quota is consumed **at request begin** (attempt-based):

- Prevents retry storms from bypassing limits
- Provider failures still consume minute/daily budget
- In-flight is released in `finally` / stream completion via `ai_end_ai_request`

If the provider succeeds but event logging fails, the user response still proceeds (metrics are best-effort).

## HTTP responses

| Condition | Status | Headers |
| --- | --- | --- |
| Rate / budget / inflight | 429 | `Retry-After`, `x-request-id` |
| Quota DB unavailable | 503 | `Retry-After` (often 30), `x-request-id` |

## Database permissions

| Object | `anon` / `authenticated` | Notes |
| --- | --- | --- |
| `ai_rate_buckets`, `ai_inflight`, `ai_proxy_events` | **No table grants**; RLS enabled, no client policies | Direct REST manipulation blocked |
| `ai_begin_ai_request`, `ai_end_ai_request`, `ai_log_proxy_event` | `EXECUTE` for `authenticated` | Uses `auth.uid()` only |
| `ai_cleanup_quota_data` | `service_role` only | Retention cleanup |

## Migration / deploy

```bash
# After linking the confirmed project:
supabase db push
# or apply supabase/migrations/20261013140000_ai_quota_rate_limits.sql in SQL Editor

supabase functions deploy stt-proxy
supabase functions deploy chat-proxy
```

Verify with concurrent authenticated requests and confirm 429 + `Retry-After` when over limit.

## Cleanup

```sql
select public.ai_cleanup_quota_data(14);
```

Schedule via Dashboard cron / `pg_cron` if available (optional).
