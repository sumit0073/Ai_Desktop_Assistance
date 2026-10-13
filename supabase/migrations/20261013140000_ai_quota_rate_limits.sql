-- Durable AI rate limits + usage budgets for Edge Function proxies.
-- Atomic enforcement via SECURITY DEFINER RPCs that use auth.uid() only
-- (never trust a client-supplied user id).
--
-- Apply: supabase db push   (or SQL Editor on the confirmed project)
-- Ordinary authenticated clients cannot read/write counter tables.

-- ---------------------------------------------------------------------------
-- Tables (RLS on, no policies for authenticated/anon → deny by default)
-- ---------------------------------------------------------------------------

create table public.ai_rate_buckets (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, bucket, window_start),
  constraint ai_rate_buckets_count_nonneg check (request_count >= 0),
  constraint ai_rate_buckets_bucket_nonempty check (char_length(bucket) between 1 and 64)
);

comment on table public.ai_rate_buckets is
  'Fixed-window AI request counters (minute/day). Privileged RPC only.';

create index ai_rate_buckets_window_start_idx
  on public.ai_rate_buckets (window_start);

create table public.ai_inflight (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  inflight integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind),
  constraint ai_inflight_nonneg check (inflight >= 0),
  constraint ai_inflight_kind_check check (kind in ('chat', 'vision', 'stt'))
);

comment on table public.ai_inflight is
  'Per-user in-flight expensive AI requests. Privileged RPC only.';

create table public.ai_proxy_events (
  id bigint generated always as identity primary key,
  request_id uuid,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null,
  event text not null,
  http_status integer,
  latency_ms integer,
  created_at timestamptz not null default now(),
  constraint ai_proxy_events_kind_check
    check (kind in ('chat', 'vision', 'stt', 'auth', 'system')),
  constraint ai_proxy_events_event_check
    check (event in (
      'allowed',
      'rate_limited',
      'budget_exhausted',
      'inflight_limited',
      'auth_fail',
      'db_fail',
      'provider_error',
      'provider_timeout',
      'ok',
      'cancelled'
    ))
);

comment on table public.ai_proxy_events is
  'Privacy-conscious proxy metrics (no prompts, audio, or tokens).';

create index ai_proxy_events_created_at_idx
  on public.ai_proxy_events (created_at desc);

create index ai_proxy_events_user_created_idx
  on public.ai_proxy_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges: no Data API access for clients
-- ---------------------------------------------------------------------------

alter table public.ai_rate_buckets enable row level security;
alter table public.ai_inflight enable row level security;
alter table public.ai_proxy_events enable row level security;

revoke all on table public.ai_rate_buckets from public, anon, authenticated;
revoke all on table public.ai_inflight from public, anon, authenticated;
revoke all on table public.ai_proxy_events from public, anon, authenticated;

grant all on table public.ai_rate_buckets to service_role;
grant all on table public.ai_inflight to service_role;
grant all on table public.ai_proxy_events to service_role;

-- ---------------------------------------------------------------------------
-- Limit policy (keep in sync with src/lib/aiQuotaPolicy.ts)
-- ---------------------------------------------------------------------------
-- Aggregate: 40 req / user / minute across chat + vision + stt
-- chat:      30 / min,  500 estimated units / UTC day
-- vision:    10 / min,   80 estimated units / UTC day
-- stt:       30 / min,  400 estimated units / UTC day
-- inflight:  chat 3, vision 2, stt 2

create or replace function public.ai_quota_limits()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'agg_per_minute', 40,
    'chat_per_minute', 30,
    'vision_per_minute', 10,
    'stt_per_minute', 30,
    'chat_daily_units', 500,
    'vision_daily_units', 80,
    'stt_daily_units', 400,
    'chat_inflight', 3,
    'vision_inflight', 2,
    'stt_inflight', 2
  );
$$;

revoke all on function public.ai_quota_limits() from public, anon;
grant execute on function public.ai_quota_limits() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal atomic bump (rolls back with the outer function on failure)
-- ---------------------------------------------------------------------------

create or replace function public.ai_bump_bucket(
  p_user_id uuid,
  p_bucket text,
  p_window_start timestamptz,
  p_limit integer,
  p_units integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_units < 1 then
    raise exception 'invalid_units' using errcode = '22023';
  end if;
  if p_limit < 1 then
    raise exception 'invalid_limit' using errcode = '22023';
  end if;

  insert into public.ai_rate_buckets as b (user_id, bucket, window_start, request_count)
  values (p_user_id, p_bucket, p_window_start, p_units)
  on conflict (user_id, bucket, window_start)
  do update
    set request_count = b.request_count + excluded.request_count
  where b.request_count + excluded.request_count <= p_limit
  returning b.request_count into v_count;

  if v_count is null then
    -- At limit (or would exceed). Row lock from concurrent upserts serializes this.
    return null;
  end if;

  return v_count;
end;
$$;

revoke all on function public.ai_bump_bucket(uuid, text, timestamptz, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Begin request: consume minute + daily + inflight atomically
-- Identity: auth.uid() only
-- ---------------------------------------------------------------------------

create or replace function public.ai_begin_ai_request(
  p_kind text,
  p_units integer default 1,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  limits jsonb := public.ai_quota_limits();
  minute_start timestamptz := date_trunc('minute', timezone('utc', now()));
  day_start timestamptz := date_trunc('day', timezone('utc', now()));
  kind_minute_limit integer;
  kind_daily_limit integer;
  kind_inflight_limit integer;
  agg_limit integer := (limits ->> 'agg_per_minute')::integer;
  units integer := greatest(coalesce(p_units, 1), 1);
  retry_after integer;
  new_inflight integer;
  deny_reason text;
  deny_event text;
begin
  if uid is null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'unauthorized',
      'retry_after_seconds', null
    );
  end if;

  if p_kind not in ('chat', 'vision', 'stt') then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'invalid_kind',
      'retry_after_seconds', null
    );
  end if;

  kind_minute_limit := (limits ->> (p_kind || '_per_minute'))::integer;
  kind_daily_limit := (limits ->> (p_kind || '_daily_units'))::integer;
  kind_inflight_limit := (limits ->> (p_kind || '_inflight'))::integer;

  begin
    -- Aggregate minute (shared across chat-proxy + stt-proxy)
    if public.ai_bump_bucket(uid, 'agg_minute', minute_start, agg_limit, 1) is null then
      deny_reason := 'aggregate_rate_limited';
      deny_event := 'rate_limited';
      raise exception 'ai_quota_denied' using errcode = 'P0001';
    end if;

    -- Per-kind minute
    if public.ai_bump_bucket(
      uid, p_kind || '_minute', minute_start, kind_minute_limit, 1
    ) is null then
      deny_reason := 'kind_rate_limited';
      deny_event := 'rate_limited';
      raise exception 'ai_quota_denied' using errcode = 'P0001';
    end if;

    -- Daily estimated units (UTC day)
    if public.ai_bump_bucket(
      uid, p_kind || '_daily', day_start, kind_daily_limit, units
    ) is null then
      deny_reason := 'budget_exhausted';
      deny_event := 'budget_exhausted';
      raise exception 'ai_quota_denied' using errcode = 'P0001';
    end if;

    -- In-flight concurrency
    insert into public.ai_inflight as i (user_id, kind, inflight, updated_at)
    values (uid, p_kind, 1, timezone('utc', now()))
    on conflict (user_id, kind)
    do update
      set inflight = i.inflight + 1,
          updated_at = timezone('utc', now())
    where i.inflight < kind_inflight_limit
    returning i.inflight into new_inflight;

    if new_inflight is null then
      deny_reason := 'inflight_limited';
      deny_event := 'inflight_limited';
      raise exception 'ai_quota_denied' using errcode = 'P0001';
    end if;

    insert into public.ai_proxy_events (request_id, user_id, kind, event, http_status)
    values (p_request_id, uid, p_kind, 'allowed', null);

    return jsonb_build_object(
      'allowed', true,
      'reason', null,
      'retry_after_seconds', null,
      'inflight', new_inflight,
      'units', units
    );
  exception
    when sqlstate 'P0001' then
      -- Sub-block rollback undoes partial bumps; log denial outside that work.
      if deny_event = 'budget_exhausted' then
        retry_after := greatest(
          1,
          (extract(epoch from (day_start + interval '1 day' - timezone('utc', now()))))::integer
        );
      else
        retry_after := greatest(
          1,
          (extract(epoch from (minute_start + interval '1 minute' - timezone('utc', now()))))::integer
        );
      end if;

      insert into public.ai_proxy_events (request_id, user_id, kind, event, http_status)
      values (p_request_id, uid, p_kind, coalesce(deny_event, 'rate_limited'), 429);

      return jsonb_build_object(
        'allowed', false,
        'reason', coalesce(deny_reason, 'rate_limited'),
        'retry_after_seconds', retry_after
      );
  end;
end;
$$;

revoke all on function public.ai_begin_ai_request(text, integer, uuid)
  from public, anon;
grant execute on function public.ai_begin_ai_request(text, integer, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- End request: release inflight (best-effort; never raises to clients)
-- ---------------------------------------------------------------------------

create or replace function public.ai_end_ai_request(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_kind not in ('chat', 'vision', 'stt') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  end if;

  update public.ai_inflight
  set inflight = greatest(inflight - 1, 0),
      updated_at = timezone('utc', now())
  where user_id = uid and kind = p_kind;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.ai_end_ai_request(text) from public, anon;
grant execute on function public.ai_end_ai_request(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Structured event log (no sensitive payloads)
-- ---------------------------------------------------------------------------

create or replace function public.ai_log_proxy_event(
  p_request_id uuid,
  p_kind text,
  p_event text,
  p_http_status integer default null,
  p_latency_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if p_kind not in ('chat', 'vision', 'stt', 'auth', 'system') then
    return;
  end if;
  if p_event not in (
    'allowed', 'rate_limited', 'budget_exhausted', 'inflight_limited',
    'auth_fail', 'db_fail', 'provider_error', 'provider_timeout', 'ok', 'cancelled'
  ) then
    return;
  end if;

  insert into public.ai_proxy_events (
    request_id, user_id, kind, event, http_status, latency_ms
  ) values (
    p_request_id, uid, p_kind, p_event, p_http_status, p_latency_ms
  );
end;
$$;

revoke all on function public.ai_log_proxy_event(uuid, text, text, integer, integer)
  from public, anon;
grant execute on function public.ai_log_proxy_event(uuid, text, text, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cleanup helper (manual or scheduled). Safe to re-run.
-- ---------------------------------------------------------------------------

create or replace function public.ai_cleanup_quota_data(
  p_retain_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cut timestamptz := timezone('utc', now()) - make_interval(days => greatest(p_retain_days, 1));
  deleted_buckets integer;
  deleted_events integer;
begin
  -- Only service_role should call this in practice.
  delete from public.ai_rate_buckets where window_start < cut;
  get diagnostics deleted_buckets = row_count;
  delete from public.ai_proxy_events where created_at < cut;
  get diagnostics deleted_events = row_count;
  return jsonb_build_object(
    'deleted_buckets', deleted_buckets,
    'deleted_events', deleted_events,
    'cutoff', cut
  );
end;
$$;

revoke all on function public.ai_cleanup_quota_data(integer) from public, anon, authenticated;
grant execute on function public.ai_cleanup_quota_data(integer) to service_role;
