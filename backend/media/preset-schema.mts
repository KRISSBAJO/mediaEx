export const PRESET_SCHEMA = `
create table if not exists upload_preset (
  id text primary key,
  "organizationId" text not null references organization(id) on delete cascade,
  name text not null,
  "folderId" text,
  policy jsonb not null,
  "isDefault" boolean not null default false
);
create unique index if not exists upload_preset_org_name on upload_preset ("organizationId", lower(name));
create unique index if not exists upload_preset_default on upload_preset ("organizationId") where "isDefault";
create table if not exists upload_preset_event (
  id bigint generated always as identity primary key,
  "organizationId" text not null references organization(id) on delete cascade,
  "actorId" text references "user"(id) on delete set null,
  action text not null, "presetId" text not null, name text not null,
  "createdAt" timestamptz not null default now()
);
create index if not exists upload_preset_event_org on upload_preset_event ("organizationId", id desc);
alter table asset add column if not exists "uploadPolicy" jsonb;
alter table asset add column if not exists "uploadExpiresAt" timestamptz;
update asset set "uploadExpiresAt" = now() + interval '7 days' where status = 'uploading' and "uploadExpiresAt" is null;
create index if not exists asset_upload_expiry on asset ("uploadExpiresAt") where status = 'uploading';
`
