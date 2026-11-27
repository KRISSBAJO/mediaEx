export const RECOVERY_SCHEMA = `
alter table "asset" add column if not exists "deletedAt" timestamptz;
alter table "asset" add column if not exists "trashRetryAt" timestamptz;
alter table "asset" add column if not exists "revisionId" uuid not null default gen_random_uuid();
create index if not exists asset_trash_expiry_idx on "asset" ("deletedAt",id) where "deletedAt" is not null;

alter table asset add column if not exists "reviewRequiredForReplacement" boolean not null default false;

alter table asset add column if not exists "revisionCreator" text;
alter table asset add column if not exists "revisionCreatedAt" timestamptz;
alter table asset add column if not exists "revisionReason" text;
alter table asset add column if not exists "processingMs" bigint;
alter table asset add column if not exists retired boolean not null default false;
alter table asset add column if not exists "policyGeneration" integer not null default 0;
alter table asset add column if not exists "sha256" text;
alter table asset add column if not exists "assignedReviewer" text references "user"(id) on delete set null;
alter table asset add column if not exists "rightsExpireAt" timestamptz;
alter table api_key add column if not exists "lastChangedBy" text;
alter table api_key add column if not exists "rateTokens" double precision;
alter table api_key add column if not exists "rateAt" timestamptz;
create or replace function mediaex_charge_key(k text, expected_hash text, capacity integer)
returns integer language plpgsql as $$
declare
  balance double precision;
  previous timestamptz;
  observed timestamptz;
begin
  select "rateTokens","rateAt" into balance,previous from api_key
    where id=k and hash=expected_hash and "revokedAt" is null for update;
  if not found then return -1; end if;
  observed := clock_timestamp();
  balance := least(capacity,coalesce(balance,capacity)+greatest(0,extract(epoch from observed-previous))*capacity/60.0);
  if balance < 1 then return greatest(1,ceil((1-balance)*60/capacity)::integer); end if;
  update api_key set "rateTokens"=balance-1,"rateAt"=observed,
    "lastUsedAt"=case when "lastUsedAt" > observed-interval '1 minute' then "lastUsedAt" else observed end where id=k;
  return 0;
end $$;
create table if not exists directory_member (
  id uuid primary key, org text not null references organization(id) on delete cascade,"userId" text not null references "user"(id) on delete cascade,
  "externalId" text not null,active boolean not null,unique(org,"userId"),unique(org,"externalId")
);
create table if not exists metadata_job (
  id uuid primary key,org text not null references organization(id) on delete cascade,creator text not null,field text not null,
  value jsonb not null,state text not null default 'preview',"createdAt" timestamptz not null default now()
);
create table if not exists metadata_job_item (
  job uuid not null references metadata_job(id) on delete cascade,asset text not null,status text not null default 'pending',error text,primary key(job,asset)
);
alter table metadata_job_item add column if not exists before_value jsonb;
create table if not exists media_reference (
  "organizationId" text not null references organization(id) on delete cascade,
  application text not null, resource text not null, slot text not null,
  "assetId" text references asset(id) on delete set null, "revisionId" uuid, generation integer not null,
  primary key ("organizationId",application,resource,slot)
);
create index if not exists media_reference_asset_idx on media_reference ("organizationId","assetId");
create table if not exists media_reference_event (
  "organizationId" text not null references organization(id) on delete cascade,
  application text not null, resource text not null, slot text not null,
  "assetId" text, "revisionId" uuid, generation integer not null, actor text not null, reason text not null,
  "createdAt" timestamptz not null default now(),
  primary key ("organizationId",application,resource,slot,generation)
);
create table if not exists asset_review_event (
  id bigint generated always as identity primary key,
  "organizationId" text not null references organization(id) on delete cascade,
  "assetId" text not null,
  "revisionId" uuid not null,
  state text not null check (state in ('in_review','changes_requested','approved')),
  actor text not null,
  comment text not null,
  "createdAt" timestamptz not null default now()
);
create index if not exists asset_review_revision_idx on asset_review_event ("organizationId","revisionId",id desc);

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
create table if not exists governance_audit (
  id bigint generated always as identity primary key, "organizationId" text not null references organization(id) on delete cascade,
  action text not null, actor text, details jsonb not null, "createdAt" timestamptz not null default now()
);
create index if not exists governance_audit_org_idx on governance_audit ("organizationId",id);
create or replace function mediaex_governance_audit() returns trigger language plpgsql as $$
declare r jsonb; verb text; author text; info jsonb;
begin
  if TG_OP='DELETE' then r:=to_jsonb(old); else r:=to_jsonb(new); end if;
  if not exists(select 1 from organization where id=r->>'organizationId') then return null; end if;
  if TG_TABLE_NAME='api_key' then
    verb:=case when TG_OP='INSERT' then 'key.created' when TG_OP='DELETE' then 'key.deleted'
      when new.hash is distinct from old.hash then 'key.rotated' else 'key.revoked' end;
    info:=jsonb_build_object('keyId',r->>'id','scope',r->>'scope');
    author:=case when TG_OP='INSERT' then r->>'createdBy' when TG_OP='UPDATE' then r->>'lastChangedBy' else null end;
  elsif TG_TABLE_NAME='member' then
    author:=nullif(current_setting('mediaex.actor',true),''); verb:='membership.'||lower(TG_OP); info:=jsonb_build_object('userId',r->>'userId','role',r->>'role');
  else
    author:=r->>'actor'; verb:=case TG_TABLE_NAME when 'asset_review_event' then 'review.'||(r->>'state')
      when 'media_reference_event' then 'reference.changed' else r->>'action' end;
    info:=r-'actor'-'organizationId'-'createdAt';
  end if;
  insert into governance_audit ("organizationId",action,actor,details) values(r->>'organizationId',verb,author,info);
  return null;
end $$;
create or replace trigger mediaex_audit_reviews after insert on asset_review_event for each row execute function mediaex_governance_audit();
create or replace trigger mediaex_audit_refs after insert on media_reference_event for each row execute function mediaex_governance_audit();
create or replace trigger mediaex_audit_recovery after insert on asset_recovery_event for each row execute function mediaex_governance_audit();
create or replace trigger mediaex_audit_keys after insert or delete or update of hash,"revokedAt" on api_key for each row execute function mediaex_governance_audit();
do $$ begin
  if to_regclass('member') is not null then
    create or replace trigger mediaex_audit_members after insert or delete or update of role on member for each row execute function mediaex_governance_audit();
  end if;
end $$;
create index if not exists asset_recovery_history_idx on asset_recovery_event ("organizationId","assetId",id desc);
`
