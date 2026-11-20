import assert from 'node:assert/strict'
import test from 'node:test'
import { LIBRARY_INDEXES } from '../backend/media/schema.mts'
import { pool } from '../backend/auth.mts'
import { assetPage, searchAssets, workspaceAssetSummary } from '../backend/media/asset-search.mts'

// Run against a disposable Postgres database. All fixture tables are connection-local.
test('library pages and counts cover every matching active asset in the workspace', async t => {
  assert.ok(process.env.DATABASE_URL, 'set DATABASE_URL to a local test database')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'use a local test database')
  const db = await pool.connect()
  t.after(async () => { db.release(true); await pool.end() })
  t.mock.method(pool, 'query', (sql, args) => db.query(sql, args))
  await db.query(`
    create temporary table "user" (id text, name text);
    create temporary table collection_asset ("assetId" text, "collectionId" text, "addedAt" timestamptz);
    create temporary table caption ("assetId" text, lang text, label text, source text, status text, error text);
    create temporary table asset_variant ("assetId" text, bytes bigint);
    create temporary table asset_revision ("organizationId" text, size bigint, "outputSize" bigint);
    create temporary table asset (
      id text primary key, "organizationId" text, "createdBy" text, title text, "fileName" text,
      size bigint, "outputSize" bigint, duration real, "createdAt" timestamptz, "deletedAt" timestamptz,
      status text, "folderId" text, type text, moderation text, progress real,
      "sourceInfo" text, tags text[], metadata jsonb, "uploadExpiresAt" timestamptz
    );
    insert into asset
    select 'asset-' || lpad(i::text, 4, '0'), case when i=602 then 'other' else 'workspace' end, null,
      (array['Film clip', 'A film clip', 'Other title'])[1+i%3], 'film-' || i || '.mp4',
      i%4, 1, (i%5)::real/2, timestamptz '2025-01-01 00:00:00+00' + (i%7)*interval '1 microsecond',
      case when i=601 then now() end, case when i%2=0 then 'uploading' else 'ready' end,
      case when i%2=0 then 'folder-1' end, case when i%2=0 then 'video' else 'image' end,
      case when i%2=0 then 'pending' else 'approved' end, 100, null, array['library'], '{"field":"test"}'::jsonb
    from generate_series(1,602) i;
    insert into asset_variant values ('asset-0001',25);
    insert into asset_revision values ('workspace',10,8);
    insert into collection_asset values ('asset-0001','collection-1',now());
  `)
  await db.query(LIBRARY_INDEXES)
  await db.query('analyze asset')
  const page = (query, cursor = {}) => assetPage('workspace', query, new URLSearchParams(cursor))
  const ids = result => result.assets.map(a => a.id)
  const scope = `"organizationId"='workspace' and "deletedAt" is null`
  const orders = {
    new: '"createdAt" desc, id desc',
    old: '"createdAt" asc, id asc',
    name: 'lower(title) asc, "createdAt" desc, id desc',
    size: 'size desc, id desc',
    long: 'duration desc, "createdAt" desc, id desc',
    relevance: `case when lower(title) like 'film%' then 0 when title ilike '%film%' then 1 else 2 end,
      "createdAt" desc, id desc`,
  }
  for (const [sort, order] of Object.entries(orders)) {
    const q = { sort, q: 'film' }
    const expected = (await db.query(`select id from asset where ${scope} order by ${order}`)).rows.map(a => a.id)
    let current = await page(q)
    assert.equal(current.previous, null)
    const pages = []
    do {
      assert.equal(current.total, 600)
      assert.equal(current.bytes, 1500)
      assert.equal(current.assets.length, 50)
      pages.push(ids(current))
      if (!current.next) break
      current = await page(q, { after: current.next })
    } while (pages.length < 13)
    assert.deepEqual(pages.flat(), expected, sort)
    for (let i = pages.length - 2; i >= 0; i--) {
      assert.ok(current.previous)
      current = await page(q, { before: current.previous })
      assert.deepEqual(ids(current), pages[i], sort)
    }
    assert.equal(current.previous, null)
    assert.deepEqual((await searchAssets('workspace', q, 60, 501)).map(a => a.id), expected.slice(501, 561), 'v1 offset')
  }
  assert.deepEqual(await workspaceAssetSummary('workspace'), {
    total: 600, unfiled: 300, uploaded: 300, active: 300, failed: 0, pending: 300,
    bytes: 1500, committedBytes: 1245, video: 300, audio: 0, image: 300,
  })
  const match = await page({ q: 'film-1.mp4', collection: 'collection-1', meta: { field: 'test' }, tags: ['library'] })
  assert.deepEqual(ids(match), ['asset-0001'])
  assert.equal(match.total, 1)
  assert.equal((await page({ q: 'missing' })).total, 0)
  const q = { sort: 'old' }
  const first = await page(q)
  const after = first.next
  const second = await page(q, { after })
  await assert.rejects(() => page({ sort: 'size' }, { after }), e => e.status === 400)
  await assert.rejects(() => assetPage('other', q, new URLSearchParams({ after })), e => e.status === 400)
  await assert.rejects(() => page(q, { after: 'broken' }), e => e.status === 400)
  // Removing the boundary row does not invalidate its cursor.
  await db.query('delete from asset where id=$1', [ids(first).at(-1)])
  assert.deepEqual(ids(await page(q, { after })), ids(second))
  await db.query('delete from asset where not (id=any($1::text[]))', [ids(first)])
  const emptyTail = await page(q, { after })
  assert.deepEqual(ids(emptyTail), [])
  assert.equal(emptyTail.total, 49)
})
