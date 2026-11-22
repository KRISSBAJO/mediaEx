import type { PoolClient } from 'pg'
import { pool } from '../auth.mts'
import { requireMember, HttpError } from './assets.mts'
import { vaultStatus } from './storage-vault.mts'

type Database = Pick<PoolClient, 'query'>
export type OperationalError = {
  id: string
  category: 'encoding' | 'captions' | 'playback' | 'webhook'
  reference: string
  assetId: string | null
  deliveryId: string | null
  title: string | null
  httpStatus: number | null
  recordedAt: string
}
type CurrentStorage = {
  originalBytes: number
  encodedBytes: number
  transformBytes: number
  versionBytes: number
  reservedBytes: number
  reservations: number
  expiredBytes: number
  expiredUploads: number
}
export type OperationsReport = CurrentStorage & {
  processingMinutes: number
  playerBytes: number
  errors: number
  details: OperationalError[] | null
  cleanupEnabled: boolean
  storageCredential: Awaited<ReturnType<typeof vaultStatus>>
}

export const cleanupEnabled = () => process.env.MEDIA_CLEAN_EXPIRED_UPLOADS === 'on'

async function currentStorage(orgId: string, db: Database) {
  const { rows } = await db.query<CurrentStorage>(`
      select
        coalesce(sum(size) filter (where status <> 'uploading'), 0)::float8 as "originalBytes",
        coalesce(sum("outputSize") filter (where status <> 'uploading'), 0)::float8 as "encodedBytes",
        (select coalesce(sum(v.bytes), 0)::float8 from asset_variant v join asset a on a.id = v."assetId"
          where a."organizationId" = $1) as "transformBytes",
        (select coalesce(sum(size + "outputSize"), 0)::float8 from asset_revision where "organizationId" = $1) as "versionBytes",
        coalesce(sum(size) filter (where status = 'uploading' and "deletedAt" is null and ("uploadExpiresAt" > now() or "uploadExpiresAt" is null)), 0)::float8 as "reservedBytes",
        count(*) filter (where status = 'uploading' and "deletedAt" is null and ("uploadExpiresAt" > now() or "uploadExpiresAt" is null))::int as reservations,
        coalesce(sum(size) filter (where status = 'uploading' and "deletedAt" is null and "uploadExpiresAt" <= now()), 0)::float8 as "expiredBytes",
        count(*) filter (where status = 'uploading' and "deletedAt" is null and "uploadExpiresAt" <= now())::int as "expiredUploads"
      from asset where "organizationId" = $1`, [orgId])
  return rows[0]
}

export async function committedStorage(orgId: string, db: Database = pool) {
  const s = await currentStorage(orgId, db)
  return s.originalBytes + s.encodedBytes + s.transformBytes + s.versionBytes + s.reservedBytes
}

export async function processingMinutesForPeriod(orgId: string, start: Date, end: Date, db: Database = pool) {
  const { rows } = await db.query<{ minutes: number }>(`
    select coalesce(sum(media_seconds), 0) / 60 as minutes from workspace_processing_completion
    where org_id = $1 and completed_at >= $2 and completed_at < $3`, [orgId, start, end])
  return rows[0].minutes
}

export async function workspaceOperations(orgId: string, role: string, db: Database = pool): Promise<OperationsReport> {
  const [current, activity, details] = await Promise.all([
    currentStorage(orgId, db),
    db.query<{ processingMinutes: number; playerBytes: number; errors: number }>(`
      select (select coalesce(sum(media_seconds), 0) / 60 from workspace_processing_completion where org_id = $1
                and completed_at >= ((now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC'
                and completed_at <= now()) as "processingMinutes",
             coalesce(sum(player_bytes), 0)::float8 as "playerBytes",
             (select count(*)::int from workspace_media_error where org_id = $1 and recorded_at >= now() - interval '30 days') as errors
      from workspace_usage_day where org_id = $1 and day between (now() at time zone 'UTC')::date - 29 and (now() at time zone 'UTC')::date`, [orgId]),
    role === 'owner' || role === 'admin' ? db.query<OperationalError>(`
      select e.id::text, e.category, e.reference, a.id as "assetId", a.title, d.id as "deliveryId", e.http_status as "httpStatus",
             e.recorded_at as "recordedAt" from workspace_media_error e
      left join asset a on a.id = e.asset_id and a."organizationId" = e.org_id and a."deletedAt" is null
      left join webhook_delivery d on e.category = 'webhook' and d.id = e.reference and d."organizationId" = e.org_id
      where e.org_id = $1 and e.recorded_at >= now() - interval '30 days'
      order by e.recorded_at desc, e.id desc limit 50`, [orgId]) : null,
  ])
  return { ...current, ...activity.rows[0], details: details?.rows ?? null, cleanupEnabled: cleanupEnabled(), storageCredential: await vaultStatus(orgId, role) }
}

export async function handleOperations(req: Request) {
  if (req.method !== 'GET') throw new HttpError(405, 'Use GET to read workspace usage.')
  const { orgId, role } = await requireMember(req.headers)
  return Response.json(await workspaceOperations(orgId, role), { headers: { 'Cache-Control': 'private, no-store' } })
}
