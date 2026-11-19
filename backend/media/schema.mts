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
`
