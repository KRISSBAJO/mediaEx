'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { API_KEYS, DELIVERIES, WEBHOOKS } from '@/lib/sample'
import Icon from '../Icon'
import { Card, PageHead, copyText, toast } from '../ui'

type Key = (typeof API_KEYS)[number]

function sampleKey() {
  const abc = 'abcdef0123456789'
  let s = ''
  for (let i = 0; i < 32; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return `mx_test_${s}`
}

export default function Developers() {
  const params = useSearchParams()
  const [keys, setKeys] = useState<Key[]>(API_KEYS)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('Full access')
  const [created, setCreated] = useState<string | null>(null)
  const [revoke, setRevoke] = useState<Key | null>(null)
  const [nameErr, setNameErr] = useState('')

  useEffect(() => {
    if (params.get('new') === '1') setCreating(true)
  }, [params])

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(n)) return setNameErr('Use 2–40 lowercase letters, numbers or dashes.')
    if (keys.some((k) => k.name === n)) return setNameErr('A key with this name already exists.')
    const full = sampleKey()
    setKeys((ks) => [{ id: n, name: n, prefix: 'mx_test_', last4: full.slice(-4), created: 'Just now', lastUsed: 'Never', scope }, ...ks])
    setCreated(full)
    setCreating(false)
    setName('')
    setNameErr('')
  }

  return (
    <>
      <PageHead title="Developers" sub="API keys, webhooks and everything you need to build on MediaEX.">
        <a className="btn btn-ghost btn-sm" href="/#developers">
          <Icon name="book" size={15} /> API docs
        </a>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} /> Create API key
        </button>
      </PageHead>

      {created && (
        <div className="banner" role="status">
          <Icon name="key" />
          <div className="grow">
            <b>Copy your new key now — you won’t see it again.</b>
            <code className="key-reveal">{created}</code>
            <small>Sample key generated in your browser. It won’t authenticate against any API.</small>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(created, 'API key copied')}>
            <Icon name="copy" size={15} /> Copy
          </button>
          <button type="button" className="icon-btn is-quiet" aria-label="Dismiss" onClick={() => setCreated(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <div className="stack">
        <Card title="API keys" meta={`${keys.length} keys`} flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Scope</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th className="num">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <b className="cell-strong">{k.name}</b>
                    </td>
                    <td className="mono">
                      {k.prefix}••••••••{k.last4}
                      {k.prefix === 'mx_test_' && <span className="chip">test</span>}
                    </td>
                    <td className="muted">{k.scope}</td>
                    <td className="muted">{k.created}</td>
                    <td className="muted">{k.lastUsed}</td>
                    <td className="num">
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRevoke(k)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid-2">
          <Card
            title="Webhooks"
            meta={`${WEBHOOKS.length} endpoints`}
            flush
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toast('Adding endpoints needs the backend')}>
                <Icon name="plus" size={15} /> Add endpoint
              </button>
            }
          >
            <ul className="rows">
              {WEBHOOKS.map((w) => (
                <li key={w.id}>
                  <span className="file-kind">
                    <Icon name="link" size={16} />
                  </span>
                  <div className="grow">
                    <b className="mono-strong">{w.url}</b>
                    <small>{w.events.join(' · ')}</small>
                  </div>
                  <div className="row-end">
                    <span className={`dot-status ${w.status === 'healthy' ? 'is-good' : 'is-bad'}`}>{w.status === 'healthy' ? 'Healthy' : 'Failing'}</span>
                    <small>{w.success}% delivered</small>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Quickstart" meta="Node.js">
            <pre className="snippet">
              <code>
                <span className="k">import</span> {'{ MediaEX }'} <span className="k">from</span> <span className="s">&apos;@mediaex/sdk&apos;</span>
                {'\n\n'}
                <span className="k">const</span> mx = <span className="k">new</span> MediaEX({'{'} apiKey: process.env.MEDIAEX_KEY {'}'})
                {'\n'}
                <span className="k">const</span> {'{ data }'} = <span className="k">await</span> mx.assets.list({'{'} limit: <span className="s">10</span> {'}'})
              </code>
            </pre>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                copyText(
                  "import { MediaEX } from '@mediaex/sdk'\n\nconst mx = new MediaEX({ apiKey: process.env.MEDIAEX_KEY })\nconst { data } = await mx.assets.list({ limit: 10 })",
                  'Snippet copied',
                )
              }
            >
              <Icon name="copy" size={15} /> Copy
            </button>
          </Card>
        </div>

        <Card title="Recent webhook deliveries" meta="All endpoints" flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Event</th>
                  <th>Response</th>
                  <th className="num">Duration</th>
                  <th className="num">When</th>
                </tr>
              </thead>
              <tbody>
                {DELIVERIES.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.id}</td>
                    <td>{d.event}</td>
                    <td>
                      <span className={`dot-status ${d.code < 300 ? 'is-good' : 'is-bad'}`}>
                        {d.code} {d.code < 300 ? 'OK' : 'Service unavailable'}
                      </span>
                    </td>
                    <td className="num mono">{d.ms >= 10000 ? 'Timed out' : `${d.ms} ms`}</td>
                    <td className="num muted">{d.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {creating && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setCreating(false)}>
          <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="key-title" onSubmit={create} noValidate>
            <h2 id="key-title">Create API key</h2>
            <p>Keys act on behalf of this workspace. Give each service its own key so you can revoke one without breaking the rest.</p>
            <div className="dialog-body">
              <label className="field-d">
                <span>Name</span>
                <input
                  className="input"
                  value={name}
                  autoFocus
                  placeholder="e.g. production-web"
                  onChange={(e) => {
                    setName(e.target.value)
                    setNameErr('')
                  }}
                  aria-invalid={!!nameErr}
                />
                {nameErr ? <small className="is-bad">{nameErr}</small> : <small>Lowercase letters, numbers and dashes.</small>}
              </label>
              <label className="field-d">
                <span>Permissions</span>
                <select className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option>Full access</option>
                  <option>Upload only</option>
                  <option>Read only</option>
                </select>
              </label>
            </div>
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Create key
              </button>
            </div>
          </form>
        </div>
      )}

      {revoke && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setRevoke(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="revoke-title">
            <h2 id="revoke-title">Revoke “{revoke.name}”?</h2>
            <p>Any service using this key stops working immediately. You can’t undo this.</p>
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoke(null)} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setKeys((ks) => ks.filter((k) => k.id !== revoke.id))
                  toast(`Revoked ${revoke.name}`)
                  setRevoke(null)
                }}
              >
                Revoke key
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
