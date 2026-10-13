# Seecog / System Bunny production readiness

Statuses: `PASS` | `FAIL` | `BLOCKED` | `NOT TESTED`

Update this table only with evidence. Local unit tests do **not** mark deployment or live integration as `PASS`.

| Area | Status | Evidence / notes |
| --- | --- | --- |
| Code implementation (authenticated proxies, prod no client Groq fallback) | PASS | `chat-proxy` / `stt-proxy` + client proxy URLs |
| Durable Postgres rate limits + usage budgets (migration + RPC wiring) | PASS (code) / BLOCKED (deploy) | Migration `20261013140000_ai_quota_rate_limits.sql`; proxies call `ai_begin_ai_request`. **Not applied to a live project in this environment.** |
| Database permissions + RLS (counters not client-writable) | PASS (code) / BLOCKED (verify live) | RLS on; no grants/policies for `authenticated` on counter tables; RPC uses `auth.uid()` |
| Concurrency / quota unit tests | PASS | `src/lib/aiQuotaPolicy.test.ts` — fixed-window concurrency simulation |
| Unit and build tests | PASS | Re-run `npm run ci:quality` + `cargo test` per RC |
| Rate-limit migration deployment | BLOCKED | Project not linked (`supabase/.temp/project-ref` absent); no operator authorization for `db push` |
| Edge Function deployment (chat-proxy / stt-proxy) | BLOCKED | Live probe of configured proxy URLs returned `404 NOT_FOUND` (functions not deployed). CLI via `npx supabase` only; project not linked; deploy not authorized |
| Authenticated live chat + STT tests | NOT TESTED | `npm run test:live` → 1 skip-gate passed / 5 skipped (no `SEECOG_LIVE_PROXY_TESTS` / test user) |
| Usage-budget enforcement (live) | NOT TESTED | Requires deployed migration + deliberate over-budget test user |
| Provider-secret protection (no client key) | PASS (local bundle scan) / NOT TESTED (release artifact) | `check:bundle-secrets` locally; CI artifact pending |
| Release artifact secret scan | NOT TESTED | GitHub Actions `security-check-*` artifact |
| Windows device QA | NOT TESTED | Manual |
| macOS device QA | NOT TESTED | Manual |
| Secret rotation (exposed Groq key) | BLOCKED | Operator must revoke old key + set `GROQ_API_KEY` Edge secret; not verified here |

## Evidence required to flip blockers

| Area | Becomes PASS when |
| --- | --- |
| Rate-limit migration deployment | Migration applied on confirmed project; `select public.ai_quota_limits();` works; RPC callable as signed-in user |
| DB permissions verification | As `authenticated` via Data API: `select` on `ai_rate_buckets` fails; only RPC works |
| Live chat/STT | `npm run test:live` authenticated suite fully green |
| Usage-budget live | Test user hits daily cap → 429 + `budget_exhausted` / safe message |
| Release artifact scan | Actions artifact contains `[secret-check] OK` |
| Secret rotation | Old Groq key revoked; new key only in Edge secrets |

## Related docs

- [ai-quota.md](./ai-quota.md) — algorithm, limits, fail-closed
- [ai-monitoring.md](./ai-monitoring.md) — queries, alerts, incidents
- [proxy-deploy.md](./proxy-deploy.md) — CLI deploy sequence
- [ai-security.md](./ai-security.md) / [stt-security.md](./stt-security.md)
