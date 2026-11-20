import assert from 'node:assert/strict'
import { test } from 'node:test'
import { legacyStorageKind, newStorageKind, storage } from '../backend/media/storage.mts'

const cloud = {
  S3_BUCKET: 'fixture',
  S3_ENDPOINT: 'https://storage.example.test',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'fixture-id',
  S3_SECRET_ACCESS_KEY: 'fixture-secret',
}

test('single-store deployments keep their original storage selection', () => {
  assert.equal(legacyStorageKind({}), 'local')
  assert.equal(newStorageKind('old-workspace', cloud), 's3')
  assert.equal(legacyStorageKind({ ...cloud, MEDIAEX_LEGACY_STORAGE: 'local' }), 'local')
  assert.throws(() => legacyStorageKind({ MEDIAEX_LEGACY_STORAGE: 'typo' }), /must be/)
})

test('an explicit pilot changes only new uploads in exact workspace IDs', () => {
  const pilot = { ...cloud, MEDIAEX_S3_WORKSPACE_IDS: 'alpha, beta ' }
  assert.equal(legacyStorageKind(pilot), 'local')
  assert.equal(newStorageKind('alpha', pilot), 's3')
  assert.equal(newStorageKind('beta', pilot), 's3')
  assert.equal(newStorageKind('alph', pilot), 'local')
  assert.equal(newStorageKind('alpha', { ...pilot, MEDIAEX_S3_WORKSPACE_IDS: '' }), 'local')
  assert.equal(legacyStorageKind({ ...pilot, MEDIAEX_LEGACY_STORAGE: 's3' }), 's3')
})

test('reads follow the recorded asset store even after the allowlist changes', t => {
  const vars = { ...cloud, MEDIAEX_LEGACY_STORAGE: 'local', MEDIAEX_S3_WORKSPACE_IDS: '' }
  for (const [key, value] of Object.entries(vars)) {
    const original = process.env[key]
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original })
    process.env[key] = value
  }
  delete process.env.S3_SECRET_ACCESS_KEY
  assert.throws(() => storage({ storageBackend: 's3' }), /unavailable/)
  assert.throws(() => storage({}), /Unrecognized/)
  process.env.S3_SECRET_ACCESS_KEY = cloud.S3_SECRET_ACCESS_KEY
  assert.equal(storage({ storageBackend: 's3' }).kind, 's3')
  process.env.MEDIAEX_S3_WORKSPACE_IDS = 'alpha'
  assert.equal(storage({ storageBackend: 'local' }).kind, 'local')
})
