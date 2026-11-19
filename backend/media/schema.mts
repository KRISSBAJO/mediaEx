/**
 * Media tables. Applied by scripts/migrate.mts after the auth tables (the asset table references them).
 * Keep this file free of imports: Node loads it directly in the migration script.
 * Every statement is idempotent, so the migration is safe to run on every start.
 */
export const MEDIA_SCHEMA = /* sql */ `
create table if not exists "asset" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "createdBy"      text references "user"("id") on delete set null,
  "title"          text not null,
  "type"           text not null,
  "status"         text not null default 'uploading',
  "stage"          integer not null default 0,
  "progress"       real not null default 0,
  "error"          text,
  "fileName"       text not null,
  "mimeType"       text,
  "size"           bigint not null default 0,
  "outputSize"     bigint not null default 0,
  "duration"       real not null default 0,
  "width"          integer,
  "height"         integer,
  "sourceInfo"     text,
  "renditions"     jsonb not null default '[]'::jsonb,
  "tags"           text[] not null default '{}',
  "originalKey"    text not null,
  "thumbKey"       text,
  "posterKey"      text,
  "playlistKey"    text,
  "attempts"       integer not null default 0,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now(),
  "readyAt"        timestamptz
);
create index if not exists "asset_org_created_idx" on "asset" ("organizationId", "createdAt" desc);
create index if not exists "asset_work_idx" on "asset" ("status", "createdAt") where "status" in ('queued', 'processing');

-- organisation: nested folders (an asset lives in at most one), collections (an asset can be in many), saved searches
create table if not exists "folder" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "parentId"       text references "folder"("id") on delete cascade,
  "name"           text not null,
  "createdBy"      text references "user"("id") on delete set null,
  "createdAt"      timestamptz not null default now()
);
create unique index if not exists "folder_name_idx" on "folder" ("organizationId", coalesce("parentId", ''), lower("name"));
alter table "asset" add column if not exists "folderId" text references "folder"("id") on delete set null;
create index if not exists "asset_folder_idx" on "asset" ("organizationId", "folderId");
create index if not exists "asset_tags_idx" on "asset" using gin ("tags");

create table if not exists "collection" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "name"           text not null,
  "description"    text,
  "createdBy"      text references "user"("id") on delete set null,
  "createdAt"      timestamptz not null default now(),
  "updatedAt"      timestamptz not null default now()
);
create unique index if not exists "collection_name_idx" on "collection" ("organizationId", lower("name"));
create table if not exists "collection_asset" (
  "collectionId" text not null references "collection"("id") on delete cascade,
  "assetId"      text not null references "asset"("id") on delete cascade,
  "addedAt"      timestamptz not null default now(),
  primary key ("collectionId", "assetId")
);
create index if not exists "collection_asset_asset_idx" on "collection_asset" ("assetId");

create table if not exists "saved_search" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "userId"         text not null references "user"("id") on delete cascade,
  "name"           text not null,
  "query"          jsonb not null,
  "createdAt"      timestamptz not null default now()
);
create index if not exists "saved_search_owner_idx" on "saved_search" ("organizationId", "userId");

-- custom metadata: fields per workspace, values per asset ({ fieldId: value })
create table if not exists "metadata_field" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "key"            text not null,
  "label"          text not null,
  "type"           text not null,
  "options"        jsonb not null default '[]'::jsonb,
  "required"       boolean not null default false,
  "help"           text,
  "position"       integer not null default 0,
  "createdAt"      timestamptz not null default now()
);
create unique index if not exists "metadata_field_key_idx" on "metadata_field" ("organizationId", "key");
alter table "asset" add column if not exists "metadata" jsonb not null default '{}'::jsonb;
create index if not exists "asset_metadata_idx" on "asset" using gin ("metadata");

-- moderation: per-workspace settings and a review state on every asset (existing assets stay approved)
create table if not exists "workspace_setting" (
  "organizationId" text primary key references "organization"("id") on delete cascade,
  "moderationMode" text not null default 'off',
  "blocklist"      text[] not null default '{}',
  "aiReview"       boolean not null default false,
  "updatedAt"      timestamptz not null default now()
);
alter table "asset" add column if not exists "moderation" text not null default 'approved';
alter table "asset" add column if not exists "moderationFlags" jsonb not null default '[]'::jsonb;
alter table "asset" add column if not exists "moderationNote" text;
alter table "asset" add column if not exists "moderatedBy" text references "user"("id") on delete set null;
alter table "asset" add column if not exists "moderatedAt" timestamptz;
create index if not exists "asset_moderation_idx" on "asset" ("organizationId", "moderation") where "moderation" <> 'approved';

-- developer platform: API keys (only a hash is stored), webhook endpoints and their deliveries
create table if not exists "api_key" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "name"           text not null,
  "scope"          text not null default 'full',
  "hash"           text not null unique,
  "last4"          text not null,
  "createdBy"      text references "user"("id") on delete set null,
  "createdAt"      timestamptz not null default now(),
  "lastUsedAt"     timestamptz,
  "revokedAt"      timestamptz
);
create index if not exists "api_key_org_idx" on "api_key" ("organizationId");
alter table "asset" add column if not exists "uploadedVia" text;

create table if not exists "webhook_endpoint" (
  "id"             text primary key,
  "organizationId" text not null references "organization"("id") on delete cascade,
  "url"            text not null,
  "description"    text,
  "events"         text[] not null default '{}',
  "secret"         text not null,
  "enabled"        boolean not null default true,
  "failures"       integer not null default 0,
  "createdAt"      timestamptz not null default now()
);
create index if not exists "webhook_endpoint_org_idx" on "webhook_endpoint" ("organizationId");
create table if not exists "webhook_delivery" (
  "id"             text primary key,
  "endpointId"     text not null references "webhook_endpoint"("id") on delete cascade,
  "organizationId" text not null,
  "event"          text not null,
  "payload"        jsonb not null,
  "status"         text not null default 'pending',
  "attempts"       integer not null default 0,
  "nextAttemptAt"  timestamptz not null default now(),
  "responseStatus" integer,
  "responseBody"   text,
  "durationMs"     integer,
  "error"          text,
  "createdAt"      timestamptz not null default now(),
  "deliveredAt"    timestamptz
);
create index if not exists "webhook_delivery_due_idx" on "webhook_delivery" ("nextAttemptAt") where "status" = 'pending';
create index if not exists "webhook_delivery_org_idx" on "webhook_delivery" ("organizationId", "createdAt" desc);

-- cached on-the-fly transformations (the files live under <asset>/derived/)
create table if not exists "asset_variant" (
  "assetId"   text not null references "asset"("id") on delete cascade,
  "key"       text not null,
  "params"    text not null,
  "format"    text not null,
  "bytes"     integer not null,
  "createdAt" timestamptz not null default now(),
  primary key ("assetId", "key")
);
`
