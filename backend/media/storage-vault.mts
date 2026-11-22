import { readFile } from 'node:fs/promises'
import { AwsClient } from 'aws4fetch'

export type StorageKey = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
export type Proof = { actor: string; checkedAt: string; previousVersion: number; earliestRetirement: string | null; performedBy?: { id: string; name: string } }
type Binding = { workspace: string; endpoint: string; bucket: string; region: string }
type RecordData = { binding: Binding; key: StorageKey; proof: Proof }
type Version = { version: number; record: RecordData }

export function trustedEndpoint(raw: string) {
  const u = new URL(raw)
  const loopback = ['127.0.0.1', '[::1]'].includes(u.hostname)
  if ((u.protocol !== 'https:' && !(loopback && u.protocol === 'http:')) || u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new Error('Use an HTTPS service origin. Plain HTTP is supported only on loopback.')
  }
  return u.origin
}

export function binding(env = process.env): Binding {
  const workspace = env.MEDIAEX_VAULT_WORKSPACE ?? ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspace)) throw new Error('A valid pilot workspace is required.')
  const bucket = env.S3_BUCKET ?? ''
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('A valid private bucket is required.')
  return { workspace, bucket, endpoint: trustedEndpoint(env.S3_ENDPOINT ?? ''), region: env.S3_REGION || 'auto' }
}

export function storageKey(value: unknown): StorageKey {
  const k = value as Partial<StorageKey> | null
  if (!k || typeof k.accessKeyId !== 'string' || !k.accessKeyId || typeof k.secretAccessKey !== 'string' || !k.secretAccessKey ||
      (k.sessionToken !== undefined && (typeof k.sessionToken !== 'string' || !k.sessionToken))) throw new Error('Invalid storage credential.')
  return { accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey, ...(k.sessionToken ? { sessionToken: k.sessionToken } : {}) }
}

export class StorageVault {
  readonly scope: Binding
  private origin: string
  private file: string
  constructor(mode: 'operator' | 'runtime', env = process.env) {
    this.scope = binding(env)
    this.origin = trustedEndpoint(env.MEDIAEX_VAULT_ADDR ?? '')
    this.file = (mode === 'operator' ? env.MEDIAEX_VAULT_OPERATOR_TOKEN_FILE : env.MEDIAEX_VAULT_TOKEN_FILE) ?? ''
    if (!this.file) throw new Error('Mount a scoped OpenBao token file for this operation.')
  }

  private async request(path: string, data?: object) {
    const token = (await readFile(this.file, 'utf8')).trim()
    if (!token) throw new Error('OpenBao token is unavailable.')
    return fetch(this.origin + '/v1/' + path, {
      method: data ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined,
    })
  }

  private path() { return 'mediaex/data/workspaces/' + this.scope.workspace + '/storage' }

  async current(): Promise<Version | null> {
    const res = await this.request(this.path())
    if (res.status === 404) return null
    if (!res.ok) throw new Error('OpenBao read failed (HTTP ' + res.status + ').')
    const { data } = await res.json()
    const record = data?.data as RecordData
    if (!Number.isSafeInteger(data?.metadata?.version) || data.metadata.version < 1 || !record?.binding ||
        Object.entries(this.scope).some(([k, v]) => record.binding[k as keyof Binding] !== v)) throw new Error('Vault storage binding mismatch.')
    return { version: data.metadata.version, record: { ...record, key: storageKey(record.key) } }
  }

  async actor() {
    const res = await this.request('auth/token/lookup-self')
    if (!res.ok) throw new Error('OpenBao could not identify the operator.')
    const { data } = await res.json()
    const actor = data?.display_name
    if (typeof actor !== 'string' || !actor || actor.length > 256) throw new Error('Operator identity is unavailable.')
    return actor
  }

  async activate(expected: number, key: StorageKey, proof: Proof) {
    const res = await this.request(this.path(), { options: { cas: expected }, data: { binding: this.scope, key, proof } })
    if (!res.ok) throw new Error('OpenBao refused activation (HTTP ' + res.status + '). Read status before retrying.')
    const { data } = await res.json()
    if (data?.version !== expected + 1) throw new Error('Check the active version before retrying.')
    return data.version as number
  }
}

// Coalesce overlapping reads, but never reuse a resolved credential for a later signing operation.
export function workspaceSigner(vault: StorageVault) {
  let pending: Promise<AwsClient> | undefined
  return () => {
    pending ??= vault.current().then(current => {
      if (!current) throw new Error('The workspace has no active storage credential.')
      return new AwsClient({ ...current.record.key, region: vault.scope.region, service: 's3' })
    }).finally(() => { pending = undefined })
    return pending
  }
}

export async function vaultStatus(orgId: string, role: string, identity: 'runtime' | 'operator' = 'runtime') {
  if (orgId !== process.env.MEDIAEX_VAULT_WORKSPACE || !['owner', 'admin'].includes(role)) return null
  try {
    const active = await new StorageVault(identity).current()
    if (!active) return { state: 'unconfigured' as const }
    const { actor, performedBy, checkedAt, previousVersion, earliestRetirement } = active.record.proof
    return { state: 'active' as const, version: active.version, actor: performedBy?.name || actor, checkedAt, previousVersion, earliestRetirement }
  } catch {
    return { state: 'unavailable' as const }
  }
}
