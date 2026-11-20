'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  KEY_SCOPE_LABEL,
  KEY_SCOPES,
  WEBHOOK_EVENT_HELP,
  WEBHOOK_EVENTS,
  type ApiKey,
  type KeyScope,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEvent,
} from '@/lib/media/types'
import { canManage, useAccount } from '../account'
import Icon from '../Icon'
import { ConfirmDialog, Dialog } from '../library-ui/dialogs'
import { Ago } from '../media'
import { Card, PageHead, Tabs, copyText, toast } from '../ui'

const SCOPE_HELP: Record<KeyScope, string> = {
  read: 'List and read assets and folders.',
  upload: 'Everything in Read, plus uploading new files.',
  full: 'Everything, including editing and deleting assets.',
}

/** fetch + JSON + a toast on failure. Returns null when the request failed. */
async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: init?.json === undefined ? init?.headers : { 'content-type': 'application/json', ...init?.headers },
      body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
    })
    const text = await res.text()
    const body = text ? JSON.parse(text) : {}
    if (!res.ok) {
      toast(body.error ?? `Request failed (${res.status})`)
      return null
    }
    return body as T
  } catch {
    toast('Couldn’t reach MediaEX. Check your connection and try again.')
    return null
  }
}

const shortUrl = (u: string) => u.replace(/^https?:\/\//, '')

/* ------------------------------------------------ the one-time secret banner */
type Revealed = { kind: 'key' | 'webhook'; label: string; value: string }

function SecretBanner({ secret, onClose }: { secret: Revealed; onClose: () => void }) {
  return (
    <div className="banner" role="status">
      <Icon name="key" />
      <div>
        <b>{secret.kind === 'key' ? `Copy the key for ${secret.label} now. You won’t see it again.` : `Signing secret for ${secret.label}`}</b>
        <code className="key-reveal">{secret.value}</code>
        <small>
          {secret.kind === 'key'
            ? 'MediaEX stores only a hash of it. If it’s lost, revoke it and create a new one.'
            : 'Use it to check the MediaEX-Signature header on every delivery. Keep it on your server.'}
        </small>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(secret.value, secret.kind === 'key' ? 'API key copied' : 'Secret copied')}>
        <Icon name="copy" size={15} /> Copy
      </button>
      <button type="button" className="icon-btn is-quiet" aria-label="Dismiss" onClick={onClose}>
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}

/* ------------------------------------------------ dialogs */
function KeyDialog({ taken, onClose, onCreated }: { taken: string[]; onClose: () => void; onCreated: (key: ApiKey, secret: string) => void }) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<KeyScope>('full')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title="Create API key"
      sub="Keys act for this whole workspace. Give each service its own key, so you can revoke one without breaking the rest."
      onClose={onClose}
      onSubmit={async () => {
        const n = name.trim()
        if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(n)) return setErr('Use 2–40 lowercase letters, numbers or dashes.')
        if (taken.includes(n)) return setErr('A key with this name already exists.')
        setBusy(true)
        const r = await call<{ key: ApiKey; secret: string }>('/api/keys', { method: 'POST', json: { name: n, scope } })
        setBusy(false)
        if (r) onCreated(r.key, r.secret)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </>
      }
    >
      <label className="field-d">
        <span>Name</span>
        <input
          className="input"
          value={name}
          autoFocus
          placeholder="e.g. production-web"
          aria-invalid={!!err}
          onChange={(e) => {
            setName(e.target.value)
            setErr('')
          }}
        />
        {err ? <small className="is-bad">{err}</small> : <small>Lowercase letters, numbers and dashes.</small>}
      </label>
      <fieldset className="field-d dev-choices">
        <legend>Access</legend>
        {KEY_SCOPES.map((s) => (
          <label key={s} className="check">
            <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />
            <span>
              {KEY_SCOPE_LABEL[s]}
              <small>{SCOPE_HELP[s]}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  )
}

function EndpointDialog({
  endpoint,
  onClose,
  onSaved,
  onSecret,
  onDelete,
}: {
  endpoint: WebhookEndpoint | null
  onClose: () => void
  onSaved: (endpoints?: WebhookEndpoint[]) => void
  onSecret: (s: Revealed) => void
  onDelete: (e: WebhookEndpoint) => void
}) {
  const [url, setUrl] = useState(endpoint?.url ?? 'https://')
  const [description, setDescription] = useState(endpoint?.description ?? '')
  const [events, setEvents] = useState<WebhookEvent[]>(endpoint?.events ?? ['asset.ready', 'asset.failed'])
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const toggle = (e: WebhookEvent) => setEvents((xs) => (xs.includes(e) ? xs.filter((x) => x !== e) : [...xs, e]))
  const label = endpoint ? new URL(endpoint.url).host : ''

  return (
    <Dialog
      wide
      title={endpoint ? 'Edit endpoint' : 'Add webhook endpoint'}
      sub={endpoint ? <span className="mono">{endpoint.url}</span> : 'MediaEX sends a signed POST to this URL when the events you pick happen.'}
      onClose={onClose}
      onSubmit={async () => {
        if (!events.length || busy) return
        setBusy(true)
        if (endpoint) {
          const r = await call<{ endpoints: WebhookEndpoint[] }>(`/api/webhooks/${endpoint.id}`, { method: 'PATCH', json: { url: url.trim(), description, events, enabled } })
          setBusy(false)
          if (r) {
            toast('Endpoint saved')
            onSaved(r.endpoints)
          }
        } else {
          const r = await call<{ endpoint: WebhookEndpoint; secret: string }>('/api/webhooks', { method: 'POST', json: { url: url.trim(), description, events } })
          setBusy(false)
          if (r) {
            onSecret({ kind: 'webhook', label: new URL(r.endpoint.url).host, value: r.secret })
            onSaved()
          }
        }
      }}
      foot={
        <>
          {endpoint && (
            <button type="button" className="btn btn-quiet btn-sm is-danger dialog-foot-start" onClick={() => onDelete(endpoint)}>
              Delete endpoint
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !events.length}>
            {busy ? 'Saving…' : endpoint ? 'Save' : 'Add endpoint'}
          </button>
        </>
      }
    >
      <label className="field-d">
        <span>URL</span>
        <input className="input mono" type="url" autoFocus={!endpoint} value={url} placeholder="https://example.com/hooks/mediaex" onChange={(e) => setUrl(e.target.value)} />
        <small>HTTPS only. Answer with any 2xx status within 10 seconds; anything else is retried for about a day.</small>
      </label>
      <label className="field-d">
        <span>Description</span>
        <input className="input" maxLength={120} placeholder="What receives these (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset className="field-d dev-choices dev-events">
        <legend>Events</legend>
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e} className="check">
            <input type="checkbox" checked={events.includes(e)} onChange={() => toggle(e)} />
            <span>
              <code>{e}</code>
              <small>{WEBHOOK_EVENT_HELP[e]}</small>
            </span>
          </label>
        ))}
        {!events.length && <small className="is-bad">Pick at least one event.</small>}
      </fieldset>
      {endpoint && (
        <>
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              Enabled
              <small>While disabled, events for this endpoint are skipped, not queued.</small>
            </span>
          </label>
          <div className="dev-secret">
            <div>
              <b>Signing secret</b>
              <small>Rotating takes effect immediately: update your receiver straight after.</small>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const r = await call<{ secret: string }>(`/api/webhooks/${endpoint.id}/secret`)
                if (r) onSecret({ kind: 'webhook', label, value: r.secret })
              }}
            >
              Reveal
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const r = await call<{ secret: string }>(`/api/webhooks/${endpoint.id}/rotate`, { method: 'POST' })
                if (r) onSecret({ kind: 'webhook', label, value: r.secret })
              }}
            >
              <Icon name="refresh" size={14} /> Rotate
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

type DeliveryDetail = WebhookDelivery & { payload: unknown; responseBody: string | null }

function DeliveryDialog({ id, manage, onClose, onRetried }: { id: string; manage: boolean; onClose: () => void; onRetried: () => void }) {
  const [d, setD] = useState<DeliveryDetail | null>(null)
  useEffect(() => {
    void call<{ delivery: DeliveryDetail }>(`/api/webhooks/deliveries/${id}`).then((r) => r && setD(r.delivery))
  }, [id])
  return (
    <Dialog
      wide
      title={d ? d.event : 'Delivery'}
      sub={d ? <span className="mono">{d.url}</span> : 'Loading…'}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
          {manage && d && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (await call(`/api/webhooks/deliveries/${id}/retry`, { method: 'POST' })) {
                  toast('Sending again')
                  onRetried()
                  onClose()
                }
              }}
            >
              <Icon name="refresh" size={14} /> Send again
            </button>
          )}
        </>
      }
    >
      {d && (
        <>
          <dl className="dev-facts">
            <div>
              <dt>Result</dt>
              <dd>
                <DeliveryStatus d={d} />
              </dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>
                {d.attempts}
                {d.nextAttemptAt && d.attempts > 0 ? ` · next ${new Date(d.nextAttemptAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd className="mono">{d.durationMs === null ? '—' : `${d.durationMs} ms`}</dd>
            </div>
            <div>
              <dt>Delivery ID</dt>
              <dd className="mono">{d.id}</dd>
            </div>
          </dl>
          {d.error && <p className="dev-error">{d.error}</p>}
          <div className="field-d">
            <span>Request body</span>
            <pre className="snippet dev-json">
              <code>{JSON.stringify(d.payload, null, 2)}</code>
            </pre>
          </div>
          {d.responseBody !== null && (
            <div className="field-d">
              <span>Your response{d.responseStatus ? ` (${d.responseStatus})` : ''}</span>
              <pre className="snippet dev-json">
                <code>{d.responseBody || '(empty)'}</code>
              </pre>
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

function DeliveryStatus({ d }: { d: WebhookDelivery }) {
  if (d.status === 'succeeded') return <span className="dot-status is-good">Delivered · {d.responseStatus}</span>
  if (d.status === 'failed') return <span className="dot-status is-bad">Failed · {d.responseStatus ?? 'no answer'}</span>
  if (!d.attempts) return <span className="dot-status is-warn">Sending</span>
  return <span className="dot-status is-warn">Retrying · {d.responseStatus ?? 'no answer'}</span>
}

/* ------------------------------------------------ code samples */
function Quickstart({ origin }: { origin: string }) {
  const [tab, setTab] = useState<'list' | 'upload' | 'verify'>('list')
  const api = `${origin}/api/v1`
  const samples = {
    list: `curl ${api}/assets?limit=10 \\
  -H "Authorization: Bearer $MEDIAEX_KEY"

# search like the library: q, folder, type, status, tags, sort
curl "${api}/assets?q=launch&type=video&status=ready" \\
  -H "Authorization: Bearer $MEDIAEX_KEY"`,
    upload: `# 1 · start: tells you where to send the file
curl -X POST ${api}/uploads \\
  -H "Authorization: Bearer $MEDIAEX_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"fileName":"launch.mp4","size":48211337}'

# 2 · PUT the file to upload.url from that answer
#     (add the Authorization header when the URL is on ${new URL(origin).host})
curl -X PUT "$UPLOAD_URL" --data-binary @launch.mp4

# 3 · queue it; asset.ready arrives by webhook when it can stream
curl -X POST ${api}/uploads/$ASSET_ID/complete \\
  -H "Authorization: Bearer $MEDIAEX_KEY"`,
    verify: `import { createHmac, timingSafeEqual } from 'node:crypto'

// call with the raw request body, before any JSON parsing
export function verifyMediaEX(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false // too old: a replay
  const expected = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest()
  const given = Buffer.from(v1 ?? '', 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// verifyMediaEX(body, req.headers['mediaex-signature'], process.env.MEDIAEX_WEBHOOK_SECRET)`,
  }
  return (
    <Card
      title="Quickstart"
      meta="Copy, paste, run"
      className="dev-quick"
      action={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(samples[tab], 'Snippet copied')}>
          <Icon name="copy" size={15} /> Copy
        </button>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'list', label: 'List assets' },
          { value: 'upload', label: 'Upload' },
          { value: 'verify', label: 'Verify webhooks' },
        ]}
      />
      <pre className="snippet">
        <code>{samples[tab]}</code>
      </pre>
    </Card>
  )
}

/* ------------------------------------------------ playback signing */
/** The workspace secret that signs playback links for assets set to "Signed links only". */
function PlaybackSigning({ origin, manage }: { origin: string; manage: boolean }) {
  const [secret, setSecret] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const snippet = `import { createHmac } from 'node:crypto'

// a link to one asset that stops working after \`ttl\` seconds
export function signedLink(assetId, secret, ttl = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl
  const sig = createHmac('sha256', secret).update(\`\${assetId}:\${exp}\`).digest('base64url')
  return \`${origin}/embed/\${assetId}?token=\${exp}.\${sig}\`
}

// or ask the API for one:
// POST ${origin}/api/v1/assets/:id/playback-token  { "expiresIn": 3600 }`
  return (
    <Card
      title="Playback signing"
      meta="For assets set to signed links only"
      action={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(snippet, 'Snippet copied')}>
          <Icon name="copy" size={15} /> Copy
        </button>
      }
    >
      <p className="access-note">
        Sign links on your own server with this secret, so viewers get links that expire. The token also works on the stream URL (
        <code>?token=</code>). Rotating the secret ends every link signed with the old one.
      </p>
      {manage &&
        (secret ? (
          <div className="copy-row dev-sign-row">
            <code>{secret}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(secret, 'Signing secret copied')}>
              <Icon name="copy" size={15} /> Copy
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRotating(true)}>
              Rotate
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm dev-sign-row"
            onClick={async () => {
              const r = await call<{ secret: string }>('/api/playback/secret')
              if (r) setSecret(r.secret)
            }}
          >
            <Icon name="lock" size={15} /> Reveal signing secret
          </button>
        ))}
      <pre className="snippet">
        <code>{snippet}</code>
      </pre>
      {rotating && (
        <ConfirmDialog
          title="Rotate the signing secret?"
          sub="Every signed link and token handed out so far stops working straight away. Update the secret on your servers after rotating."
          action="Rotate secret"
          danger
          onClose={() => setRotating(false)}
          onConfirm={async () => {
            const r = await call<{ secret: string }>('/api/playback/secret/rotate', { method: 'POST' })
            if (r) {
              setSecret(r.secret)
              toast('New signing secret — old links have stopped working')
            }
            setRotating(false)
          }}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------ the page */
export default function Developers() {
  const params = useSearchParams()
  const { workspace } = useAccount()
  const manage = canManage(workspace.role)
  const [origin, setOrigin] = useState('https://your-mediaex-domain')
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null)
  const [filter, setFilter] = useState('')
  const [secret, setSecret] = useState<Revealed | null>(null)
  const [creatingKey, setCreatingKey] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [editing, setEditing] = useState<WebhookEndpoint | 'new' | null>(null)
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    const r = await call<{ keys: ApiKey[] }>('/api/keys')
    if (r) setKeys(r.keys)
  }, [])
  const loadEndpoints = useCallback(async () => {
    const r = await call<{ endpoints: WebhookEndpoint[] }>('/api/webhooks')
    if (r) setEndpoints(r.endpoints)
  }, [])
  const loadDeliveries = useCallback(async () => {
    const r = await call<{ deliveries: WebhookDelivery[] }>(`/api/webhooks/deliveries${filter ? `?endpoint=${encodeURIComponent(filter)}` : ''}`)
    if (r) setDeliveries(r.deliveries)
  }, [filter])

  useEffect(() => {
    setOrigin(window.location.origin)
    void loadKeys()
    void loadEndpoints()
  }, [loadKeys, loadEndpoints])
  useEffect(() => {
    void loadDeliveries()
  }, [loadDeliveries])
  /** the log and the endpoints' health, together (a delivery changes both) */
  const refresh = useCallback(() => {
    void loadDeliveries()
    void loadEndpoints()
  }, [loadDeliveries, loadEndpoints])
  // while something is on its way, keep the log and the endpoint stats fresh
  const inFlight = deliveries?.some((d) => d.status === 'pending' && !d.attempts) ?? false
  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [inFlight, refresh])
  useEffect(() => {
    if (params.get('new') === '1' && manage) setCreatingKey(true)
  }, [params, manage])

  const reveal = (s: Revealed) => {
    setSecret(s)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const test = async (e: WebhookEndpoint) => {
    if (await call(`/api/webhooks/${e.id}/test`, { method: 'POST' })) {
      toast(`Test event sent to ${new URL(e.url).host}`)
      setTimeout(refresh, 600)
    }
  }
  const health = (e: WebhookEndpoint) =>
    !e.enabled ? (
      <span className="dot-status muted">Disabled</span>
    ) : e.failures > 0 ? (
      <span className="dot-status is-bad">
        Failing · {e.failures} in a row
      </span>
    ) : e.stats.total ? (
      <span className="dot-status is-good">Healthy</span>
    ) : (
      <span className="dot-status muted">No deliveries yet</span>
    )

  return (
    <>
      <PageHead title="Developers" sub="API keys for your servers, webhooks for your workflows.">
        {manage && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreatingKey(true)}>
            <Icon name="plus" size={15} /> Create API key
          </button>
        )}
      </PageHead>

      {secret && <SecretBanner secret={secret} onClose={() => setSecret(null)} />}

      <div className="stack">
        <Card
          title="API keys"
          meta={keys ? `${keys.length} active` : 'Loading…'}
          flush
          hint={
            <>
              Send as <code>Authorization: Bearer mx_live_…</code> to <code>{origin}/api/v1</code>. Each key is rate limited; a 429 says when to retry.
            </>
          }
        >
          {keys?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Access</th>
                    <th>Created</th>
                    <th>Last used</th>
                    {manage && (
                      <th className="actions">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <b className="cell-strong">{k.name}</b>
                      </td>
                      <td className="mono">mx_live_••••{k.last4}</td>
                      <td className="muted">{KEY_SCOPE_LABEL[k.scope]}</td>
                      <td className="muted">
                        <Ago iso={k.createdAt} />
                        {k.createdBy ? ` · ${k.createdBy}` : ''}
                      </td>
                      <td className="muted">{k.lastUsedAt ? <Ago iso={k.lastUsedAt} /> : 'Never'}</td>
                      {manage && (
                        <td className="actions">
                          <button type="button" className="btn btn-quiet btn-sm is-danger" onClick={() => setRevoking(k)}>
                            Revoke
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            keys && (
              <div className="empty">
                <Icon name="key" size={22} />
                <b>No API keys yet</b>
                <p>{manage ? 'Create a key to list, upload and manage media from your own servers and scripts.' : 'Ask an owner or admin to create one.'}</p>
                {manage && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreatingKey(true)}>
                    <Icon name="plus" size={14} /> Create API key
                  </button>
                )}
              </div>
            )
          )}
        </Card>

        <div className="grid-2 even">
          <Card
            title="Webhook endpoints"
            meta={endpoints ? `${endpoints.length} ${endpoints.length === 1 ? 'endpoint' : 'endpoints'}` : 'Loading…'}
            flush
            action={
              manage ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={15} /> Add endpoint
                </button>
              ) : undefined
            }
          >
            {endpoints?.length ? (
              <ul className="rows dev-hooks">
                {endpoints.map((e) => (
                  <li key={e.id} className={e.enabled ? '' : 'is-off'}>
                    <span className="file-kind">
                      <Icon name="link" size={16} />
                    </span>
                    <div>
                      <b className="mono-strong" title={e.url}>
                        {shortUrl(e.url)}
                      </b>
                      <small>
                        {health(e)}
                        <span>
                          {e.events.length} {e.events.length === 1 ? 'event' : 'events'}
                          {e.stats.total ? ` · ${e.stats.succeeded} of ${e.stats.total} delivered this week` : ''}
                        </span>
                      </small>
                    </div>
                    {manage && (
                      <div className="dev-row-actions">
                        <button type="button" className="btn btn-quiet btn-sm" disabled={!e.enabled} onClick={() => test(e)}>
                          Test
                        </button>
                        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(e)}>
                          Edit
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              endpoints && (
                <div className="empty">
                  <Icon name="link" size={22} />
                  <b>No endpoints yet</b>
                  <p>Get a signed POST when an upload is ready, fails, is deleted or needs review — no polling.</p>
                </div>
              )
            )}
          </Card>

          <Quickstart origin={origin} />
          <PlaybackSigning origin={origin} manage={manage} />
        </div>

        <Card
          title="Recent deliveries"
          className="dev-log"
          meta={deliveries ? (deliveries.length >= 100 ? 'Newest 100' : `${deliveries.length} ${deliveries.length === 1 ? 'delivery' : 'deliveries'}`) : 'Loading…'}
          flush
          action={
            <div className="dev-log-actions">
              {endpoints && endpoints.length > 1 && (
                <select className="select select-sm" aria-label="Endpoint" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All endpoints</option>
                  {endpoints.map((e) => (
                    <option key={e.id} value={e.id}>
                      {shortUrl(e.url)}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="icon-btn is-quiet" aria-label="Refresh" onClick={refresh}>
                <Icon name="refresh" size={15} />
              </button>
            </div>
          }
        >
          {deliveries?.length ? (
            <div className="table-wrap">
              <table className="table is-clickable">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Endpoint</th>
                    <th>Result</th>
                    <th className="num">Duration</th>
                    <th className="num">When</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} tabIndex={0} onClick={() => setViewing(d.id)} onKeyDown={(e) => e.key === 'Enter' && setViewing(d.id)}>
                      <td className="mono">{d.event}</td>
                      <td className="muted mono dev-ellipsis">{shortUrl(d.url)}</td>
                      <td>
                        <DeliveryStatus d={d} />
                      </td>
                      <td className="num mono">{d.durationMs === null ? '—' : `${d.durationMs} ms`}</td>
                      <td className="num muted">
                        <Ago iso={d.createdAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            deliveries && (
              <div className="empty">
                <Icon name="clock" size={22} />
                <b>Nothing sent yet</b>
                <p>Every webhook MediaEX sends appears here with its payload and your server’s answer.</p>
              </div>
            )
          )}
        </Card>
      </div>

      {creatingKey && (
        <KeyDialog
          taken={keys?.map((k) => k.name) ?? []}
          onClose={() => setCreatingKey(false)}
          onCreated={(k, s) => {
            setKeys((ks) => [k, ...(ks ?? [])])
            setCreatingKey(false)
            reveal({ kind: 'key', label: k.name, value: s })
          }}
        />
      )}
      {revoking && (
        <ConfirmDialog
          title={`Revoke “${revoking.name}”?`}
          sub="Anything using this key stops working straight away. This can’t be undone."
          action="Revoke key"
          danger
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            const r = await call<{ keys: ApiKey[] }>(`/api/keys/${revoking.id}`, { method: 'DELETE' })
            if (!r) return false
            setKeys(r.keys)
            if (secret?.kind === 'key' && secret.label === revoking.name) setSecret(null)
            toast(`Revoked ${revoking.name}`)
            return true
          }}
        />
      )}
      {editing && (
        <EndpointDialog
          endpoint={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setEditing(null)
            if (list) setEndpoints(list)
            else void loadEndpoints()
          }}
          onSecret={reveal}
          onDelete={(e) => {
            setEditing(null)
            setDeleting(e)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this endpoint?"
          sub={
            <>
              <span className="mono">{deleting.url}</span> stops receiving events, and its delivery history is removed.
            </>
          }
          action="Delete endpoint"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const r = await call<{ endpoints: WebhookEndpoint[] }>(`/api/webhooks/${deleting.id}`, { method: 'DELETE' })
            if (!r) return false
            setEndpoints(r.endpoints)
            if (filter === deleting.id) setFilter('')
            else void loadDeliveries()
            toast('Endpoint deleted')
            return true
          }}
        />
      )}
      {viewing && <DeliveryDialog id={viewing} manage={manage} onClose={() => setViewing(null)} onRetried={() => setTimeout(refresh, 600)} />}
    </>
  )
}
