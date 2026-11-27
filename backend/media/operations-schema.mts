// A compact workspace usage ledger survives asset deletion. Detailed events contain references and categories only.
export const OPERATIONS_SCHEMA = /* sql */ `
create table if not exists media_delivery_day (org text not null references "organization"(id) on delete cascade, day date not null, bytes bigint not null, responses bigint not null, redirects bigint not null, primary key (org,day));
alter table asset add column if not exists "cleanupRetryAt" timestamptz;
create table if not exists workspace_usage_day (
  org_id text not null references "organization"(id) on delete cascade,
  day date not null,
  player_bytes bigint not null default 0,
  primary key (org_id, day)
);
create index if not exists workspace_usage_day_retention on workspace_usage_day(day);
create table if not exists workspace_processing_completion (
  id bigint generated always as identity primary key,
  org_id text not null references "organization"(id) on delete cascade,
  completed_at timestamptz not null,
  media_seconds double precision not null
);
alter table workspace_processing_completion add column if not exists processing_ms bigint;
alter table workspace_processing_completion add column if not exists asset_id text;
alter table workspace_processing_completion add column if not exists revision_id uuid;
create unique index if not exists workspace_processing_revision_idx on workspace_processing_completion(org_id,asset_id,revision_id);
create index if not exists workspace_processing_period on workspace_processing_completion(org_id, completed_at);
create index if not exists workspace_processing_retention on workspace_processing_completion(completed_at);
create table if not exists workspace_media_error (
  id bigint generated always as identity primary key,
  org_id text not null references "organization"(id) on delete cascade,
  category text not null,
  reference text not null,
  asset_id text,
  http_status integer,
  recorded_at timestamptz not null default now()
);
create index if not exists workspace_media_error_lookup on workspace_media_error(org_id, recorded_at desc, id desc);
create index if not exists workspace_media_error_retention on workspace_media_error(recorded_at);

create or replace function mediaex_capture_asset_usage() returns trigger language plpgsql as $$
begin
  if old.status = 'processing' and new.status = 'ready' and new."readyAt" is not null then
    insert into workspace_processing_completion (org_id, completed_at, media_seconds,asset_id,revision_id,processing_ms)
    values (new."organizationId", new."readyAt", case when new.type='image' then 0 else greatest(new.duration,0) end,new.id,new."revisionId",new."processingMs") on conflict (org_id,asset_id,revision_id) do nothing;
  elsif new.status = 'failed' and old.status <> 'failed' then
    insert into workspace_media_error (org_id, category, reference, asset_id)
    values (new."organizationId", 'encoding', new.id, new.id);
  end if;
  return new;
end $$;
create or replace trigger mediaex_asset_usage after update of status, "readyAt" on asset
for each row execute function mediaex_capture_asset_usage();

create or replace function mediaex_capture_view_usage() returns trigger language plpgsql as $$
declare delta bigint := new.bytes;
declare first_failure boolean := new.errors > 0;
begin
  if tg_op = 'UPDATE' then
    delta := new.bytes - old.bytes;
    first_failure := first_failure and old.errors = 0;
  end if;
  if delta > 0 then
    insert into workspace_usage_day (org_id, day, player_bytes)
    values (new."organizationId", (now() at time zone 'UTC')::date, delta)
    on conflict (org_id, day) do update set player_bytes = workspace_usage_day.player_bytes + excluded.player_bytes;
  end if;
  if first_failure then
    insert into workspace_media_error (org_id, category, reference, asset_id)
    values (new."organizationId", 'playback', new."assetId", new."assetId");
  end if;
  return new;
end $$;
create or replace trigger mediaex_view_usage after insert or update of bytes, errors on view_session
for each row execute function mediaex_capture_view_usage();

create or replace function mediaex_capture_caption_error() returns trigger language plpgsql as $$
begin
  insert into workspace_media_error (org_id, category, reference, asset_id)
  select a."organizationId", 'captions', new.lang, a.id from asset a where a.id = new."assetId";
  return new;
end $$;
create or replace trigger mediaex_caption_error after update of status on caption
for each row when (new.status = 'failed' and old.status <> 'failed') execute function mediaex_capture_caption_error();

create or replace function mediaex_capture_webhook_error() returns trigger language plpgsql as $$
begin
  insert into workspace_media_error (org_id, category, reference, http_status)
  values (new."organizationId", 'webhook', new.id, new."responseStatus");
  return new;
end $$;
create or replace trigger mediaex_webhook_error after update of status on webhook_delivery
for each row when (new.status = 'failed' and old.status <> 'failed') execute function mediaex_capture_webhook_error();

-- Seed the initial thirty days once, in the same transaction as trigger installation.
create table if not exists workspace_usage_bootstrap (version integer primary key);
do $$
begin
  insert into workspace_usage_bootstrap values (1) on conflict do nothing;
  if found then
    insert into workspace_usage_day (org_id, day, player_bytes)
    select "organizationId", ("lastSeenAt" at time zone 'UTC')::date, sum(bytes)
      from view_session where "lastSeenAt" >= now() - interval '30 days'
      group by 1, 2 on conflict (org_id, day) do update set player_bytes = workspace_usage_day.player_bytes + excluded.player_bytes;
    insert into workspace_media_error (org_id, category, reference, asset_id, recorded_at)
    select "organizationId", 'encoding', id, id, "updatedAt" from asset where status = 'failed' and "updatedAt" >= now() - interval '30 days';
    insert into workspace_media_error (org_id, category, reference, asset_id, recorded_at)
    select a."organizationId", 'captions', c.lang, a.id, c."updatedAt" from caption c join asset a on a.id = c."assetId"
      where c.status = 'failed' and c."updatedAt" >= now() - interval '30 days';
    insert into workspace_media_error (org_id, category, reference, http_status, recorded_at)
    select "organizationId", 'webhook', id, "responseStatus", "createdAt" from webhook_delivery where status = 'failed' and "createdAt" >= now() - interval '30 days';
    insert into workspace_media_error (org_id, category, reference, asset_id, recorded_at)
    select "organizationId", 'playback', "assetId", "assetId", "lastSeenAt" from view_session where errors > 0 and "lastSeenAt" >= now() - interval '30 days';
  end if;
  insert into workspace_usage_bootstrap values (2) on conflict do nothing;
  if found then
    insert into workspace_processing_completion (org_id, completed_at, media_seconds)
    select "organizationId", "readyAt", greatest(duration, 0) from asset
      where "readyAt" >= now() - interval '400 days' and type <> 'image';
  end if;
end $$;
`
