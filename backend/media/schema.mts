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
`
