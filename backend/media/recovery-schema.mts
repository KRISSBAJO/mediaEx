export const RECOVERY_SCHEMA = `
alter table "asset" add column if not exists "deletedAt" timestamptz;
alter table "asset" add column if not exists "trashRetryAt" timestamptz;
alter table "asset" add column if not exists "revisionId" uuid not null default gen_random_uuid();
create index if not exists asset_trash_expiry_idx on "asset" ("deletedAt",id) where "deletedAt" is not null;

create table if not exists asset_revision (
  id uuid primary key,
  "organizationId" text not null references "organization"(id) on delete cascade,
  "assetId" text not null references "asset"(id) on delete cascade,
  snapshot jsonb not null,
  size bigint not null,
  "outputSize" bigint not null,
  "createdAt" timestamptz not null default now()
);
create index if not exists asset_revision_asset_idx on asset_revision ("assetId","createdAt" desc);

create table if not exists asset_recovery_event (
  id bigint generated always as identity primary key,
  "organizationId" text not null references "organization"(id) on delete cascade,
  "assetId" text not null,
  action text not null,
  actor text not null,
  "revisionId" uuid,
  "createdAt" timestamptz not null default now()
);
create index if not exists asset_recovery_history_idx on asset_recovery_event ("organizationId","assetId",id desc);
`
