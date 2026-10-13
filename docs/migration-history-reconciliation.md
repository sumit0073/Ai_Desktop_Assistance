# Migration history reconciliation (investigation only)

**Status:** Investigation complete. **No remote changes executed.**  
Await operator approval before any `migration repair`, SQL apply, or `db push`.

## Observed facts

| Fact | Evidence |
| --- | --- |
| Project linked | `supabase/.temp/project-ref` = `kjuywrbscqihdyfchrhr` |
| CLI migration history (remote) | `npx supabase migration list` shows **all five** versions with **empty remote** column |
| `db push` failure | `42P07: relation "profiles" already exists` on `20261011163000_profiles_and_sessions.sql` |
| Inference | `public.profiles` (and likely related objects) was created **outside** `supabase_migrations.schema_migrations` — e.g. SQL Editor / manual apply of the first file (its header even says “Apply in Supabase SQL Editor”) |
| Schema dump | Blocked here (`docker` not installed); use Dashboard SQL Editor for verification queries below |

## What each local migration does

### 1. `20261011163000_profiles_and_sessions.sql`
Creates (non-idempotent):
- Tables: `public.profiles`, `public.sessions`
- Index: `profiles_phone_idx`, `sessions_user_id_started_at_idx`, `sessions_user_id_active_idx`
- Functions: `public.set_updated_at()`, `public.handle_new_user()`
- Triggers: `profiles_set_updated_at`, `on_auth_user_created` on `auth.users`
- RLS enabled + policies: `profiles_select_own`, `profiles_update_own`, `sessions_*_own`
- Grants for `authenticated` / `service_role`

### 2. `20261011180000_sessions_require_email_verified.sql`
Replaces `sessions_insert_own` so insert requires JWT `email_verified = true`.

### 3. `20261012120000_sessions_drop_email_verified.sql`
Replaces `sessions_insert_own` again — **removes** the email_verified check (back to uid-only).  
**Net of 1→2→3 for insert policy:** same as migration 1 / migration 3 final form.

### 4. `20261012130000_auto_confirm_email.sql`
- Function `public.auto_confirm_user_email()`
- Trigger `on_auth_user_created_auto_confirm` **before insert** on `auth.users`
- One-time `UPDATE auth.users SET email_confirmed_at = … WHERE null` (data mutation if re-run: mostly no-op if already confirmed)

### 5. `20261013140000_ai_quota_rate_limits.sql`
New quota tables/RPCs (`ai_rate_buckets`, `ai_inflight`, `ai_proxy_events`, `ai_begin_ai_request`, …).  
**Almost certainly not applied** (fresh work; would not cause the `profiles` error).

## Safe reconciliation plan (do not run until approved)

### Phase A — Backup
1. Supabase Dashboard → **Database → Backups** (confirm PITR / daily backup is available), **or**
2. Logical backup of affected schemas (operator machine with `pg_dump`).

### Phase B — Verify remote matches migrations 1–4 (read-only)

Run the SQL in **§ Verification queries** in the SQL Editor. Only if **all** checks for a migration pass, that version is a candidate for history repair.

### Phase C — Repair history (only verified versions)

Example (after approval and successful verification):

```bash
# Mark only versions whose full effects are already present remotely
npx supabase migration repair --status applied 20261011163000 --linked
npx supabase migration repair --status applied 20261011180000 --linked
npx supabase migration repair --status applied 20261012120000 --linked
npx supabase migration repair --status applied 20261012130000 --linked
```

**Do not** mark `20261013140000` applied unless quota objects already exist and match the migration.

If migration 2’s email_verified policy is **not** present (expected if 3 was applied, or 2 was never applied), still only mark 2 applied if you accept that the **net** desired state is migration 3’s policy **and** you document that 2 was superseded. Prefer verifying final state equals end of 3, then mark **1, 2, and 3** only when:
- Migration 1 objects exist fully, **and**
- Current `sessions_insert_own` matches migration 3 (uid-only), **and**
- You intentionally record 2 as applied-for-history even though its intermediate policy is gone (standard when replaying a chain that was applied out-of-band and later superseded).

If you are uncomfortable marking superseded migration 2, alternative (heavier): leave 2 unrepaired is **not** viable — CLI applies in order. So either mark the whole 1–3 prefix after verifying **final** state, or use a carefully reviewed squash (out of scope unless requested).

### Phase D — Apply remaining migrations

```bash
npx supabase db push
```

Expect only `20261013140000_ai_quota_rate_limits.sql` (and any later files) to run if 1–4 were correctly repaired.

### Phase E — Rollback considerations

| Action | Rollback |
| --- | --- |
| `migration repair --status applied` | `npx supabase migration repair --status reverted <version> --linked` (history only; does not drop objects) |
| Accidental object create from push | Restore from backup / PITR; do not ad-hoc DROP without a plan |
| Re-running migration 4’s UPDATE | Low risk (null → now); avoid re-apply if trigger already exists |

## Verification queries (read-only — run in SQL Editor)

```sql
-- A) Migration history table
-- Note: hosted schema_migrations has (version, name, statements) — no inserted_at.
select version, name
from supabase_migrations.schema_migrations
order by version;

-- B) Core tables from migration 1
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'sessions')
order by 1;

-- C) Expected columns
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'sessions')
order by table_name, ordinal_position;

-- D) Indexes
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles', 'sessions')
order by 1;

-- E) Triggers on profiles + auth.users
select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_name in (
  'profiles_set_updated_at',
  'on_auth_user_created',
  'on_auth_user_created_auto_confirm'
)
order by 1, 2, 3;

-- F) Functions
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'set_updated_at',
    'handle_new_user',
    'auto_confirm_user_email',
    'ai_begin_ai_request',
    'ai_quota_limits'
  )
order by 1;

-- G) RLS enabled?
select relname, relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and relname in ('profiles', 'sessions', 'ai_rate_buckets', 'ai_inflight', 'ai_proxy_events');

-- H) Policies (inspect sessions_insert_own definition carefully)
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'sessions')
order by tablename, policyname;

-- I) Quota objects (expect empty / missing if migration 5 not applied)
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'ai_%'
order by 1;

-- J) sessions constraint
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.sessions'::regclass;
```

### Pass criteria (summary)

| Version | Mark `applied` only if |
| --- | --- |
| `20261011163000` | Both tables, indexes, both functions, both triggers, RLS on, all listed policies/grants present; columns match |
| `20261011180000` | **Either** current policy still has `email_verified` **or** you deliberately mark it as part of a verified 1–3 chain whose **final** policy is migration 3 (document this) |
| `20261012120000` | `sessions_insert_own` with_check is uid-only (no `email_verified`) |
| `20261012130000` | Function + `on_auth_user_created_auto_confirm` exist |
| `20261013140000` | All `ai_*` tables + RPCs exist and match migration — **otherwise leave unrepaired and apply via `db push`** |

## Explicitly out of scope until approved

- `migration repair`
- `db push` / SQL Editor applies
- DROP / DELETE / reset
- Edge Function deploy
- Blind “mark all applied”

## Recommended next message from operator

1. Paste (redacted) results of verification queries A–J, **or**
2. Explicitly authorize: “Run verification SQL read-only against linked project,” then after review authorize repair/push.
