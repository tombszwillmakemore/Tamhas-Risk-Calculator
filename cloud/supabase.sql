-- TRC (Tamhas Trading) cloud database. Paste this whole file into Supabase > SQL Editor > New query > Run.
-- It is safe to run again (every statement is "create or replace" / "if not exists").
--
-- What it creates
--   trc_records   one row per synced item (trade, trading account, money entry, saved item). Each row belongs to exactly one
--                 TRC login (owner). Deleted items stay as small "tombstones" so a delete reaches every device.
--   trc_push      saves a batch of changes. A change is applied only if it was based on the latest cloud version
--                 (compare-and-swap). Otherwise the cloud copy is returned as a CONFLICT for the person to review.
--   trc_pull      returns changes since the device's last sync, in commit order, never skipping late commits.
--   trc_usage     record count and size for the signed-in person.
--   trc_wipe      deletes all of the signed-in person's cloud records (needs a sign-in within the last 10 minutes).
--   trc_delete_account  deletes the login and every record (needs a sign-in within the last 10 minutes).
--
-- Security model
--   * Row-level security: a person can only ever read rows whose owner is their own login id (auth.uid()).
--   * Nobody (not even signed-in people) may insert, update or delete rows directly; all writes go through trc_push,
--     which always writes owner = auth.uid() and checks every input.
--   * Anonymous visitors have no access at all. The service-role key is never used by the app.

create schema if not exists extensions;

create sequence if not exists public.trc_rev;

create table if not exists public.trc_records (
  owner       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text        not null check (kind in ('trade', 'account', 'ledger', 'doc')),
  id          text        not null check (id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  version     integer     not null default 1 check (version >= 1),
  deleted     boolean     not null default false,
  fmt         smallint    not null default 1 check (fmt between 1 and 999),
  hash        text        not null check (hash ~ '^[0-9a-f]{8,64}$'),
  data        jsonb,
  device      text        check (device is null or length(device) <= 64),
  tx          bigint      not null default (pg_current_xact_id()::text::bigint),
  rev         bigint      not null default nextval('public.trc_rev'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (owner, kind, id),
  constraint trc_data_present check (deleted or (data is not null and jsonb_typeof(data) = 'object')),
  constraint trc_data_size check (data is null or pg_column_size(data) <= 262144)
);
create index if not exists trc_records_sync on public.trc_records (owner, tx, rev);

alter table public.trc_records enable row level security;
alter table public.trc_records force row level security;
drop policy if exists trc_read_own on public.trc_records;
create policy trc_read_own on public.trc_records for select to authenticated using (owner = auth.uid());

revoke all on public.trc_records from public, anon, authenticated;
grant select on public.trc_records to authenticated;
revoke all on sequence public.trc_rev from public, anon, authenticated;

-- Limits per person (free plan is 500 MB for everyone together).
create or replace function public.trc_limits() returns jsonb language sql immutable as $$
  select '{"max_records": 50000, "max_bytes": 52428800, "max_batch": 500}'::jsonb
$$;

-- A sign-in (password, magic link or recovery) within the last 10 minutes, read from the token's "amr" claim.
create or replace function public.trc_recent_signin() returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select max((a ->> 'timestamp')::bigint) from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
  ) >= extract(epoch from now())::bigint - 600, false)
$$;

create or replace function public.trc_push(items jsonb, client_fmt integer default 1, client_device text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.trc_limits();
  it jsonb; r public.trc_records%rowtype; out jsonb := '[]'::jsonb;
  k text; i text; h text; del boolean; d jsonb; base integer; n integer; used bigint; cnt bigint;
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if items is null or jsonb_typeof(items) <> 'array' then raise exception 'items must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(items) > (lim ->> 'max_batch')::int then raise exception 'batch too large' using errcode = '22023'; end if;
  client_fmt := greatest(1, least(coalesce(client_fmt, 1), 999));
  client_device := left(client_device, 64);
  select count(*), coalesce(sum(pg_column_size(t.data)), 0) into cnt, used from public.trc_records t where t.owner = me;

  for it in select value from jsonb_array_elements(items) loop
    k := it ->> 'kind'; i := it ->> 'id'; h := it ->> 'hash'; del := coalesce((it ->> 'deleted')::boolean, false);
    d := case when del then null else it -> 'data' end;
    base := case when jsonb_typeof(it -> 'base') = 'number' then (it ->> 'base')::int else null end;
    if k is null or k not in ('trade', 'account', 'ledger', 'doc') or i is null or i !~ '^[A-Za-z0-9_.:-]{1,80}$' or h is null or h !~ '^[0-9a-f]{8,64}$'
       or (not del and (d is null or jsonb_typeof(d) <> 'object')) then
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'invalid')); continue;
    end if;
    if d is not null and pg_column_size(d) > 262144 then
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'too_large')); continue;
    end if;

    select * into r from public.trc_records t where t.owner = me and t.kind = k and t.id = i for update;
    if not found then
      if cnt >= (lim ->> 'max_records')::bigint or used + coalesce(pg_column_size(d), 0) > (lim ->> 'max_bytes')::bigint then
        out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'quota')); continue;
      end if;
      insert into public.trc_records (owner, kind, id, version, deleted, fmt, hash, data, device)
        values (me, k, i, coalesce(base, 0) + 1, del, client_fmt, h, d, client_device)
        on conflict (owner, kind, id) do nothing
        returning * into r;
      if r.id is null then   -- another device inserted it a moment ago: report it as a conflict
        select * into r from public.trc_records t where t.owner = me and t.kind = k and t.id = i;
        out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'conflict', 'server', to_jsonb(r) - 'owner')); continue;
      end if;
      cnt := cnt + 1; used := used + coalesce(pg_column_size(d), 0);
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'applied', 'version', r.version, 'tx', r.tx, 'rev', r.rev));
    elsif r.hash = h and r.deleted = del then
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'same', 'version', r.version, 'tx', r.tx, 'rev', r.rev));
    elsif r.fmt > client_fmt then
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'too_old', 'fmt', r.fmt));
    elsif base is not null and r.version = base then
      if used - coalesce(pg_column_size(r.data), 0) + coalesce(pg_column_size(d), 0) > (lim ->> 'max_bytes')::bigint then
        out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'quota')); continue;
      end if;
      used := used - coalesce(pg_column_size(r.data), 0) + coalesce(pg_column_size(d), 0);
      update public.trc_records t set version = r.version + 1, deleted = del, fmt = client_fmt, hash = h, data = d, device = client_device,
             tx = pg_current_xact_id()::text::bigint, rev = nextval('public.trc_rev'), updated_at = now()
       where t.owner = me and t.kind = k and t.id = i
       returning * into r;
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'applied', 'version', r.version, 'tx', r.tx, 'rev', r.rev));
    else
      out := out || jsonb_build_array(jsonb_build_object('kind', k, 'id', i, 'status', 'conflict', 'server', to_jsonb(r) - 'owner'));
    end if;
  end loop;
  return out;
end $$;

-- Changes after (since_tx, since_rev), as one JSON array, only from transactions that can no longer be overtaken by an older one still running,
-- so a device never skips a change that commits late. Returns at most lim rows (max 1000) in order.
drop function if exists public.trc_pull(bigint, bigint, integer);
create or replace function public.trc_pull(since_tx bigint default 0, since_rev bigint default 0, lim integer default 500)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.r order by x.tx, x.rev), '[]'::jsonb) from (
    select to_jsonb(t) - 'owner' as r, t.tx, t.rev
      from public.trc_records t
     where t.owner = auth.uid()
       and (t.tx, t.rev) > (coalesce(since_tx, 0), coalesce(since_rev, 0))
       and t.tx < pg_snapshot_xmin(pg_current_snapshot())::text::bigint
     order by t.tx, t.rev
     limit greatest(1, least(coalesce(lim, 500), 1000))
  ) x
$$;

create or replace function public.trc_usage() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'records', count(*) filter (where not t.deleted),
    'deleted', count(*) filter (where t.deleted),
    'bytes', coalesce(sum(pg_column_size(t.data)), 0),
    'by_kind', coalesce((select jsonb_object_agg(x.kind, x.n) from (select kind, count(*) n from public.trc_records where owner = auth.uid() and not deleted group by kind) x), '{}'::jsonb),
    'limits', public.trc_limits())
  from public.trc_records t where t.owner = auth.uid()
$$;

create or replace function public.trc_wipe() returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n bigint;
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.trc_recent_signin() then raise exception 'sign in again first' using errcode = '42501'; end if;
  delete from public.trc_records where owner = me; get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $$;

create or replace function public.trc_delete_account() returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n bigint;
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.trc_recent_signin() then raise exception 'sign in again first' using errcode = '42501'; end if;
  select count(*) into n from public.trc_records where owner = me;
  delete from auth.users where id = me;            -- records are removed by "on delete cascade"
  return jsonb_build_object('deleted_records', n);
end $$;

revoke all on function public.trc_push(jsonb, integer, text), public.trc_pull(bigint, bigint, integer), public.trc_usage(), public.trc_wipe(),
  public.trc_delete_account(), public.trc_recent_signin(), public.trc_limits() from public, anon;
grant execute on function public.trc_push(jsonb, integer, text), public.trc_pull(bigint, bigint, integer), public.trc_usage(), public.trc_wipe(),
  public.trc_delete_account() to authenticated;
