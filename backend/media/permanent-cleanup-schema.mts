// Deliberately independent of the account, workspace, and asset foreign keys. All
// entry points (including Better Auth's workspace deletion) share the same handoff.
export const PERMANENT_CLEANUP_SCHEMA = `
create table if not exists media_permanent_cleanup (
  "assetId" text primary key, "organizationId" text not null, versions jsonb not null,
  receipts jsonb not null, attempts integer not null default 0, "lastError" text,
  "nextAttemptAt" timestamptz not null default now(), "createdAt" timestamptz not null default now()
);
create index if not exists media_permanent_cleanup_due on media_permanent_cleanup ("nextAttemptAt");
create index if not exists media_permanent_cleanup_org on media_permanent_cleanup ("organizationId");

create or replace function media_erasure_version(a jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('id',a->'id','organizationId',a->'organizationId','revisionId',a->'revisionId',
    'storageBackend',a->'storageBackend','originalKey',a->'originalKey','upload',a->'upload')
$$;

create or replace function enqueue_media_erasure(target text) returns void language plpgsql as $$
declare item asset%rowtype; versions jsonb; receipts jsonb;
begin
  select * into strict item from asset where id=target for update;
  if item.status='processing' or exists(select 1 from caption where "assetId"=target and status='processing') then
    raise exception 'Media processing is in progress. Retry deletion after it finishes.' using errcode='55P03';
  end if;
  select jsonb_build_array(media_erasure_version(to_jsonb(item))) || coalesce(jsonb_agg(media_erasure_version(snapshot->'asset')),'[]'::jsonb)
    into versions from asset_revision where "assetId"=target;
  select coalesce(jsonb_agg(jsonb_build_object('organizationId',"organizationId",'revisionId',"revisionId",'prefix',prefix)),'[]'::jsonb)
    into receipts from media_store_transfer where "assetId"=target;
  insert into media_permanent_cleanup ("assetId","organizationId",versions,receipts,"nextAttemptAt")
    values (target,item."organizationId",versions,receipts,
      case when jsonb_array_length(receipts)>0 or exists(select 1 from jsonb_array_elements(versions) v where v->>'storageBackend'='s3')
        then now()+interval '24 hours' else now() end);
end $$;

create or replace function enqueue_workspace_media_erasure() returns trigger language plpgsql as $$
declare target text;
begin
  for target in select id from asset where "organizationId"=old.id order by id for update loop
    perform enqueue_media_erasure(target);
  end loop;
  return old;
end $$;
create or replace trigger workspace_queue_media_erasure before delete on organization
  for each row execute function enqueue_workspace_media_erasure();

create or replace function delete_sole_member_workspaces() returns trigger language plpgsql as $$
declare workspace text;
begin
  for workspace in select o.id from organization o join member m on m."organizationId"=o.id
      where m."userId"=old.id order by o.id for update of o loop
    perform 1 from member where "organizationId"=workspace order by id for update;
    if (select count(*)=1 and bool_and("userId"=old.id) from member where "organizationId"=workspace) then
      delete from organization where id=workspace;
    end if;
  end loop;
  return old;
end $$;
create or replace trigger user_queue_sole_workspace_erasure before delete on "user"
  for each row execute function delete_sole_member_workspaces();
`
