// Retention rules (see retention.mts). Deleting a folder deletes its rules, so a rule never
// silently widens from one folder to the whole workspace.
export const RETENTION_SCHEMA = `
create table if not exists retention_rule (
  id text primary key,
  "organizationId" text not null references organization(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  "folderId" text references folder(id) on delete cascade,
  "includeSubfolders" boolean not null default true,
  kinds text[] not null,
  tag text,
  basis text not null check (basis in ('created', 'unplayed')),
  days integer not null check (days between 1 and 3650),
  "createdBy" text references "user"(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "lastRunAt" timestamptz,
  "lastMoved" integer not null default 0,
  "totalMoved" bigint not null default 0
);
create unique index if not exists retention_rule_org_name on retention_rule ("organizationId", lower(name));
create index if not exists retention_rule_due on retention_rule ("lastRunAt") where enabled;
create table if not exists retention_rule_event (
  id bigint generated always as identity primary key,
  "organizationId" text not null references organization(id) on delete cascade,
  "ruleId" text not null,
  name text not null,
  action text not null,
  "actorId" text references "user"(id) on delete set null,
  moved integer,
  "createdAt" timestamptz not null default now()
);
create index if not exists retention_rule_event_org on retention_rule_event ("organizationId", id desc);
`
