// Against the isolated services created by test-storage-vault.py.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { storageForWorkspace, storage } from '../backend/media/storage.mts'
import { StorageVault, vaultStatus, type StorageKey } from '../backend/media/storage-vault.mts'
import { rotate } from '../backend/rotate-storage.mts'

const [file] = process.argv.slice(2)
const keys: StorageKey[] = JSON.parse(await readFile(file, 'utf8'))
const vault = new StorageVault('operator')
const prefix = vault.scope.workspace + '/continuity'
const asset = prefix + '/original.txt'
const content = randomBytes(48)
const store = storageForWorkspace(vault.scope.workspace)
assert.equal(store.kind, 's3')
const fetchMedia = (url: string) => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) })
const read = async (url: string) => {
  const response = await fetchMedia(url)
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), content)
}
function signedBy(url: string, key: StorageKey) {
  assert.ok(new URL(url).searchParams.get('X-Amz-Credential')?.startsWith(key.accessKeyId + '/'), 'Unexpected signing credential')
}
const initial = await rotate(vault, 0, keys[0])
assert.equal(initial.version, 1)
await store.putBuffer(asset, content, 'application/octet-stream')
const oldUrl = await store.readableUrl(asset)
signedBy(oldUrl, keys[0])
await read(oldUrl)
await assert.rejects(rotate(vault, 1, { accessKeyId: 'invalid', secretAccessKey: 'invalid' }))
assert.equal((await vault.current())?.version, 1)
await read(await store.readableUrl(asset))
const replacement = await rotate(vault, 1, keys[1])
assert.equal(replacement.version, 2)
assert.equal(replacement.previousVersion, 1)
assert.ok(Date.parse(replacement.earliestRetirement!) - Date.parse(replacement.checkedAt) >= 86400000)
const newUrl = await store.readableUrl(asset)
signedBy(newUrl, keys[1])
await read(newUrl)
await read(oldUrl)
await assert.rejects(rotate(vault, 1, keys[0]), /changed/)
await assert.rejects(vault.activate(1, keys[0], replacement), /refused/)
assert.equal((await vault.current())?.version, 2)
const otherKey = 'studio-b/continuity/original.txt'
const secondStudio = storage({ storageBackend: 's3', organizationId: 'studio-b' })
await assert.rejects(secondStudio.readableUrl(asset), /belongs to another workspace/)
await assert.rejects(store.readableUrl(otherKey), /belongs to another workspace/)
await assert.rejects(secondStudio.readableUrl(otherKey), /unavailable for this workspace/)
if (process.env.MEDIAEX_TEST_PROVIDER_POLICY === '1') {
  const { AwsClient } = createRequire(new URL('../backend/package.json', import.meta.url))('aws4fetch')
  const client = new AwsClient({ ...keys[1], region: vault.scope.region, service: 's3', retries: 0 })
  const denied = await client.fetch(vault.scope.endpoint + '/' + vault.scope.bucket + '/' + otherKey, {
    method: 'PUT', body: 'fixture', redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  assert.equal(denied.status, 403, 'Storage provider must reject a valid key outside its studio')
  assert.ok((await denied.text()).includes('<Code>AccessDenied</Code>'), 'Expected S3 AccessDenied')
}
assert.equal(await vaultStatus('studio-b', 'owner'), null)
assert.equal(await vaultStatus(vault.scope.workspace, 'member'), null)
const status = await vaultStatus(vault.scope.workspace, 'owner')
assert.ok(status?.state === 'active' && status.version === 2 && status.actor.includes('pilot-operator'))
for (const key of keys) assert.ok(!JSON.stringify(status).includes(key.secretAccessKey))
await store.remove(asset)
console.log('Passed media proof, failed replacement, stale version, old URL continuity, workspace routing, and owner-only status.')
