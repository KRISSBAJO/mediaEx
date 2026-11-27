import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { pool } from '../backend/auth.mts'
import { reviewAsset } from '../backend/media/reviews.mts'

test('review decisions require the current file, current submission, and a different reviewer', async t => {
  const revisionId = randomUUID()
  const events = []
  const orgId = 'test-workspace'
  const assetId = 'ast_example'
  const owner = { orgId, userId: 'owner', role: 'owner', scope: 'full', via: 'session' }
  const reviewer = { ...owner, userId: 'reviewer', role: 'admin' }
  const db = {
    async query(sql, args) {
      if (['begin','rollback','commit'].includes(sql)) return {}
      if (sql.startsWith('select "assignedReviewer"')) return { rows: args[1] === orgId ? [{ revisionId, status: 'ready' }] : [] }
      if (sql.startsWith('select id,state')) return { rows: events }
      if (sql.startsWith('insert into asset_review_event')) {
        events.unshift({ id: String(events.length+1), state: args[3], actor: args[4], comment: args[5] })
        return {}
      }
      throw Error('Unexpected query')
    },
    release() {}
  }
  t.mock.method(pool, 'connect', async () => db)
  const send = (actor, action, overrides={}) => reviewAsset(actor, new Request('http://localhost', {
    method:'POST', body:JSON.stringify({ action, revisionId, expectedEvent:events[0]?.id ?? null, comment:'Adjusted crop', ...overrides })
  }), assetId)
  await assert.rejects(send({...owner, orgId:'other'}, 'submit'), e=>e.status===404)
  await send(owner, 'submit')
  await assert.rejects(send(owner, 'approve'), e=>e.status===403)
  await assert.rejects(send({...reviewer,role:'member'}, 'approve'), e=>e.status===403)
  await assert.rejects(send(reviewer, 'approve', {revisionId:randomUUID()}), e=>e.status===409)
  await assert.rejects(send(reviewer, 'request_changes', {comment:'  '}), e=>e.status===400)
  await send(reviewer, 'request_changes')
  await send(owner, 'submit')
  await assert.rejects(send(reviewer, 'approve', {expectedEvent:'1'}), e=>e.status===409)
  const result = await (await send(reviewer, 'approve')).json()
  assert.equal(result.revisionId, revisionId)
  assert.deepEqual(result.history.map(event=>event.state), ['approved','in_review','changes_requested','in_review'])
  await assert.rejects(send(reviewer, 'approve'), e=>e.status===409)
})
