import { audit, baseURL } from '../auth.mts'
import { rotate, verifyReplacement } from '../rotate-storage.mts'
import { HttpError } from './assets.mts'
import { StorageVault, storageKey, vaultStatus } from './storage-vault.mts'

// Each proof runs FFmpeg and writes temporary media. The vault also checks the
// expected version atomically when concurrent operators use different processes.
let busy = false

async function readCandidate(req: Request) {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Send a JSON request.')
  }
  const reader = req.body?.getReader()
  if (!reader) throw new HttpError(400, 'A replacement credential is required.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16384) {
        await reader.cancel()
        throw new HttpError(413, 'Credential input is too large.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!Number.isSafeInteger(input.version) || input.version < 0 || !['verify', 'rotate'].includes(input.action)) throw new Error()
    return { action: input.action as 'verify' | 'rotate', version: input.version as number, key: storageKey(input.key) }
  } catch { throw new HttpError(400, 'Enter a replacement key and the current version.') }
}

export async function manageCredential(req: Request, workspace: string, admin: { id: string; name: string }) {
  if (process.env.MEDIAEX_PROCESS_ROLE !== 'storage-operator' || workspace !== process.env.MEDIAEX_VAULT_WORKSPACE) {
    throw new HttpError(404, 'Storage administration is unavailable for this workspace.')
  }
  if (req.method === 'GET') {
    return Response.json(await vaultStatus(workspace, 'admin', 'operator'), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Use GET for status or POST for a credential operation.')
  if (req.headers.get('origin') !== new URL(baseURL).origin) throw new HttpError(403, 'Open this page in MediaEX to continue.')
  if (busy) throw new HttpError(409, 'Another credential check is running. Refresh the status before retrying.')
  busy = true
  try {
    const { action, version, key } = await readCandidate(req)
    let activeVersion = version
    try {
      const vault = new StorageVault('operator')
      if (action === 'verify') await verifyReplacement(vault, version, key)
      else activeVersion = (await rotate(vault, version, key, { id: admin.id, name: admin.name })).version
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.startsWith('The active version changed.') || message.startsWith('OpenBao refused activation (HTTP 400)')) {
        throw new HttpError(409, 'The credential version may have changed. Refresh the status before retrying.')
      }
      if (message === 'Supply a distinct replacement key.') throw new HttpError(400, message)
      throw new HttpError(502, 'Credential verification or activation could not be confirmed. Refresh the active version before retrying.')
    }
    await audit({ adminId: admin.id, action: 'storage-credential.' + action, targetType: 'workspace', targetId: workspace,
      details: { previousVersion: version, version: activeVersion } })
    return Response.json({ version: activeVersion, action }, { headers: { 'Cache-Control': 'private, no-store' } })
  } finally { busy = false }
}
