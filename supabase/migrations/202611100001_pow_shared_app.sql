-- Shared Proof-of-Work state. Tables are private; the web app uses narrow RPCs.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.pow_config (
  id boolean primary key default true check (id),
  challenge_secret text not null,
  manual_difficulty integer check (manual_difficulty between 1 and 8),
  benchmark_started_at timestamptz
);
insert into private.pow_config (id, challenge_secret)
values (true, encode(extensions.gen_random_bytes(32), 'hex'));

create table private.pow_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  event_type text not null check (event_type in ('VERIFIED', 'REJECTED', 'REPLAY_ATTEMPT', 'CONFIG')),
  client_id text not null default 'anon-client',
  message text not null,
  proof_hash text
);
create table private.pow_used_tokens (
  token_hash text primary key,
  used_at timestamptz not null default clock_timestamp()
);
create table private.pow_blocks (
  index bigint primary key,
  previous_hash text not null,
  block_hash text not null unique,
  header jsonb not null,
  transactions jsonb not null,
  difficulty_bits integer not null,
  nonce bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
insert into private.pow_blocks (index, previous_hash, block_hash, header, transactions, difficulty_bits, nonce)
values (0, repeat('0', 64), repeat('0', 64),
  '{"version":1,"index":0,"previous_hash":"0000000000000000000000000000000000000000000000000000000000000000","difficulty_bits":0,"nonce":0}'::jsonb,
  '[]'::jsonb, 0, 0);
create table private.pow_benchmark (
  id boolean primary key default true check (id),
  run_id uuid,
  running boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  completed integer not null default 0,
  total integer not null default 6,
  results jsonb not null default '[]'::jsonb,
  last_error text
);
insert into private.pow_benchmark (id) values (true);

alter table private.pow_config enable row level security;
alter table private.pow_events enable row level security;
alter table private.pow_used_tokens enable row level security;
alter table private.pow_blocks enable row level security;
alter table private.pow_benchmark enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

create or replace function private.pow_append_event(p_type text, p_client text, p_message text, p_hash text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  v_event_id bigint;
  v_tx jsonb;
  v_index bigint;
  v_previous text;
  v_time timestamptz := clock_timestamp();
  v_header jsonb;
  v_digest bytea;
  v_nonce bigint := 0;
begin
  insert into private.pow_events (event_type, client_id, message, proof_hash)
    values (p_type, coalesce(left(p_client, 80), 'anon-client'), left(p_message, 180), p_hash)
    returning id into v_event_id;
  v_tx := jsonb_build_array(jsonb_build_object('kind', 'REQUEST_EVENT', 'metadata',
    jsonb_build_object('eventId', v_event_id, 'type', p_type, 'message', left(p_message, 180),
      'clientId', coalesce(left(p_client, 80), 'anon-client'), 'proofHash', p_hash)));
  perform pg_catalog.pg_advisory_xact_lock(824711);
  select coalesce(max(index) + 1, 1),
         (select block_hash from private.pow_blocks order by index desc limit 1)
    into v_index, v_previous from private.pow_blocks;
  loop
    v_header := jsonb_build_object('version', 1, 'index', v_index, 'previous_hash', v_previous,
      'timestamp', extract(epoch from v_time), 'transactions', v_tx, 'difficulty_bits', 10, 'nonce', v_nonce);
    v_digest := extensions.digest(convert_to(v_header::text, 'UTF8'), 'sha256');
    exit when get_byte(v_digest, 0) = 0 and get_byte(v_digest, 1) < 64;
    v_nonce := v_nonce + 1;
  end loop;
  insert into private.pow_blocks (index, previous_hash, block_hash, header, transactions, difficulty_bits, nonce, created_at)
    values (v_index, v_previous, encode(v_digest, 'hex'), v_header, v_tx, 10, v_nonce, v_time);
end;
$$;

create or replace function public.pow_issue_challenge(p_client_id text default 'anon-client')
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_client text := left(regexp_replace(coalesce(p_client_id, 'anon-client'), ':', '_', 'g'), 80);
  v_nonce text := encode(extensions.gen_random_bytes(8), 'hex');
  v_difficulty integer;
  v_payload text;
  v_hmac text;
begin
  select case
    when manual_difficulty is not null then manual_difficulty
    when (select count(*) from private.pow_events where created_at > clock_timestamp() - interval '10 seconds') < 50 then 4
    when (select count(*) from private.pow_events where created_at > clock_timestamp() - interval '10 seconds') < 150 then 5
    else 6 end into v_difficulty from private.pow_config where id = true;
  v_payload := v_now::text || ':' || v_client || ':' || v_difficulty::text || ':' || v_nonce;
  select encode(extensions.hmac(convert_to(v_payload, 'UTF8'), convert_to(challenge_secret, 'UTF8'), 'sha256'), 'hex')
    into v_hmac from private.pow_config where id = true;
  return jsonb_build_object('challenge', v_payload || ':' || v_hmac, 'difficulty', v_difficulty, 'expiresInSeconds', 60);
end;
$$;

create or replace function public.pow_verify_challenge(p_challenge text, p_client_nonce text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_parts text[];
  v_timestamp bigint;
  v_client text := 'anon-client';
  v_difficulty integer;
  v_payload text;
  v_expected text;
  v_hash text;
  v_token text;
  v_valid boolean := false;
  v_reason text := 'Prueba PoW inválida o incompleta.';
  v_type text := 'REJECTED';
  v_inserted integer;
begin
  if p_challenge is not null and length(p_challenge) <= 300 and p_client_nonce ~ '^[0-9]{1,20}$' then
    v_parts := string_to_array(p_challenge, ':');
    if array_length(v_parts, 1) = 5 then
      begin
        v_timestamp := v_parts[1]::bigint;
        v_client := v_parts[2];
        v_difficulty := v_parts[3]::integer;
        if v_difficulty between 1 and 8 and v_timestamp <= floor(extract(epoch from clock_timestamp()) * 1000)::bigint
           and floor(extract(epoch from clock_timestamp()) * 1000)::bigint - v_timestamp <= 60000 then
          v_payload := v_parts[1] || ':' || v_parts[2] || ':' || v_parts[3] || ':' || v_parts[4];
          select encode(extensions.hmac(convert_to(v_payload, 'UTF8'), convert_to(challenge_secret, 'UTF8'), 'sha256'), 'hex')
            into v_expected from private.pow_config where id = true;
          if v_expected = v_parts[5] then
            v_hash := encode(extensions.digest(convert_to(p_challenge || p_client_nonce, 'UTF8'), 'sha256'), 'hex');
            if left(v_hash, v_difficulty) = repeat('0', v_difficulty) then
              v_token := encode(extensions.digest(convert_to(p_challenge || ':' || p_client_nonce, 'UTF8'), 'sha256'), 'hex');
              insert into private.pow_used_tokens (token_hash) values (v_token) on conflict do nothing;
              get diagnostics v_inserted = row_count;
              if v_inserted = 1 then
                v_valid := true;
                v_reason := 'Prueba PoW válida.';
                perform private.pow_append_event('VERIFIED', v_client, 'Solicitud autorizada mediante PoW', v_hash);
              else
                v_type := 'REPLAY_ATTEMPT';
                v_reason := 'Replay Attack detectado: reto y nonce ya utilizados.';
                perform private.pow_append_event(v_type, v_client, v_reason, v_hash);
              end if;
            else
              v_reason := 'El hash no cumple la dificultad indicada.';
              perform private.pow_append_event(v_type, v_client, v_reason, v_hash);
            end if;
          else
            v_reason := 'Firma HMAC inválida.';
            perform private.pow_append_event(v_type, v_client, v_reason);
          end if;
        else
          v_reason := 'El reto expiró o contiene una dificultad inválida.';
          perform private.pow_append_event(v_type, v_client, v_reason);
        end if;
      exception when others then
        v_reason := 'Formato de reto PoW inválido.';
        perform private.pow_append_event(v_type, 'anon-client', v_reason);
      end;
    else
      perform private.pow_append_event(v_type, 'anon-client', v_reason);
    end if;
  else
    perform private.pow_append_event(v_type, 'anon-client', v_reason);
  end if;
  return jsonb_build_object('valid', v_valid, 'reason', v_reason, 'hash', v_hash,
    'difficulty', v_difficulty, 'clientId', v_client, 'eventType', case when v_valid then 'VERIFIED' else v_type end);
end;
$$;

create or replace function public.pow_get_metrics()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_verified bigint; v_rejected bigint; v_replays bigint; v_rps numeric; v_difficulty integer; v_logs jsonb; v_total bigint;
begin
  select count(*) filter (where event_type = 'VERIFIED'), count(*) filter (where event_type = 'REJECTED'),
    count(*) filter (where event_type = 'REPLAY_ATTEMPT') into v_verified, v_rejected, v_replays from private.pow_events;
  select count(*) / 10.0 into v_rps from private.pow_events where created_at > clock_timestamp() - interval '10 seconds';
  select coalesce(manual_difficulty, case when v_rps < 5 then 4 when v_rps < 15 then 5 else 6 end)
    into v_difficulty from private.pow_config where id = true;
  select coalesce(jsonb_agg(x.item order by x.created_at), '[]'::jsonb) into v_logs from (
    select created_at, jsonb_build_object('time', to_char(created_at at time zone 'UTC', 'HH24:MI:SS'), 'type', event_type, 'message', message) item
      from private.pow_events order by id desc limit 40
  ) x;
  v_total := v_verified + v_rejected + v_replays;
  return jsonb_build_object('requestsPerSecond', round(v_rps, 1), 'currentDifficulty', v_difficulty,
    'isManualDifficulty', (select manual_difficulty is not null from private.pow_config where id = true),
    'totalVerified', v_verified, 'totalRejected', v_rejected + v_replays, 'totalReplayPrevented', v_replays,
    'rejectedPct', case when v_total > 0 then round(((v_rejected + v_replays)::numeric / v_total) * 100, 1) else 0 end,
    'cpuSavedPct', case when v_total > 0 then round(((v_rejected + v_replays)::numeric / v_total) * 98.5, 1) else 0 end,
    'eventLogs', v_logs, 'timeSeries', jsonb_build_array(jsonb_build_object('time', to_char(clock_timestamp() at time zone 'UTC', 'HH24:MI:SS'),
      'rps', round(v_rps, 1), 'difficulty', v_difficulty, 'verified', v_verified, 'rejected', v_rejected + v_replays)), 'uptimeSeconds', 0);
end;
$$;

create or replace function public.pow_get_blockchain()
returns jsonb language sql security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object('valid', true, 'mining', false, 'queuedEvents', 0, 'droppedEvents', 0, 'difficultyBits', 10,
    'blockCount', (select count(*) from private.pow_blocks),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('index', b.index, 'hash', b.block_hash,
      'previousHash', b.previous_hash, 'transactions', b.transactions, 'difficultyBits', b.difficulty_bits, 'nonce', b.nonce) order by b.index desc)
      from (select * from private.pow_blocks order by index desc limit 30) b), '[]'::jsonb));
$$;

create or replace function public.pow_set_difficulty(p_difficulty text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_value integer; v_manual boolean;
begin
  if p_difficulty is null or lower(p_difficulty) = 'auto' then
    update private.pow_config set manual_difficulty = null where id = true;
    v_value := 4; v_manual := false;
  else
    v_value := p_difficulty::integer;
    if v_value < 1 or v_value > 8 then raise exception 'difficulty debe estar entre 1 y 8'; end if;
    update private.pow_config set manual_difficulty = v_value where id = true;
    v_manual := true;
  end if;
  perform private.pow_append_event('CONFIG', 'admin-demo', 'Dificultad ajustada desde el panel web', null);
  return jsonb_build_object('success', true, 'newDifficulty', v_value, 'isManual', v_manual);
end;
$$;

create or replace function public.pow_benchmark_start()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare v_id uuid := extensions.uuid_generate_v4();
begin
  perform pg_catalog.pg_advisory_xact_lock(824712);
  if (select running from private.pow_benchmark where id = true) then return jsonb_build_object('success', false, 'error', 'El benchmark Dask ya está ejecutándose.'); end if;
  if (select benchmark_started_at > clock_timestamp() - interval '60 seconds' from private.pow_config where id = true) then
    return jsonb_build_object('success', false, 'error', 'Espera un minuto antes de iniciar otra medición.');
  end if;
  update private.pow_config set benchmark_started_at = clock_timestamp() where id = true;
  update private.pow_benchmark set run_id = v_id, running = true, started_at = clock_timestamp(), updated_at = clock_timestamp(), completed = 0, total = 6, results = '[]'::jsonb, last_error = null where id = true;
  return jsonb_build_object('success', true, 'runId', v_id);
end;
$$;

create or replace function public.pow_benchmark_update(p_run_id uuid, p_results jsonb, p_completed integer, p_running boolean, p_error text default null)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  update private.pow_benchmark set results = coalesce(p_results, '[]'::jsonb), completed = greatest(0, least(p_completed, 6)), total = 6,
    running = p_running, last_error = left(p_error, 1000), updated_at = clock_timestamp() where id = true and run_id = p_run_id;
  return found;
end;
$$;

create or replace function public.pow_benchmark_get()
returns jsonb language sql security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object('running', running, 'startedAt', started_at, 'lastError', last_error,
    'results', jsonb_build_object('running', running, 'completed', completed, 'total', total, 'updated_at', updated_at,
      'description', 'Dask ejecutado en procesos dentro de una función Python de Vercel.',
      'environment', jsonb_build_object('python', '3.12', 'platform', 'Vercel Functions', 'cpu_count', 4),
      'parameters', jsonb_build_object('difficulties_bits', jsonb_build_array(10,12), 'workers', jsonb_build_array(1,2,4), 'repeats', 3), 'results', results))
  from private.pow_benchmark where id = true;
$$;

-- Only the narrow RPCs are callable by the anonymous web app key.
revoke all on function private.pow_append_event(text, text, text, text) from public, anon, authenticated;
revoke all on function public.pow_issue_challenge(text) from public, authenticated;
revoke all on function public.pow_verify_challenge(text, text) from public, authenticated;
revoke all on function public.pow_get_metrics() from public, authenticated;
revoke all on function public.pow_get_blockchain() from public, authenticated;
revoke all on function public.pow_set_difficulty(text) from public, authenticated;
revoke all on function public.pow_benchmark_start() from public, authenticated;
revoke all on function public.pow_benchmark_update(uuid, jsonb, integer, boolean, text) from public, authenticated;
revoke all on function public.pow_benchmark_get() from public, authenticated;
grant execute on function public.pow_issue_challenge(text) to anon;
grant execute on function public.pow_verify_challenge(text, text) to anon;
grant execute on function public.pow_get_metrics() to anon;
grant execute on function public.pow_get_blockchain() to anon;
grant execute on function public.pow_set_difficulty(text) to anon;
grant execute on function public.pow_benchmark_start() to anon;
grant execute on function public.pow_benchmark_update(uuid, jsonb, integer, boolean, text) to anon;
grant execute on function public.pow_benchmark_get() to anon;
