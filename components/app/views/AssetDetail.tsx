'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { STAGES, isActive, type MediaAsset } from '@/lib/media/types'
import { bytes, duration as fmtDuration } from '@/lib/sample'
import Icon from '../Icon'
import MediaPlayer from '../MediaPlayer'
import MetadataEditor from '../MetadataEditor'
import { VersionPanel } from './Recovery'
import CaptionsPanel from '../CaptionsPanel'
import TransformBuilder from '../TransformBuilder'
import { flatTree, request, useLibrary } from '../library'
import { CollectDialog, TagInput } from '../library-ui/dialogs'
import { Ago, dims, useMedia } from '../media'
import { Card, ModerationBadge, Segmented, StatusBadge, Tabs, TypeIcon, copyText, toast } from '../ui'
import { canManage, useAccount } from '../account'
import ShareLink, { createSignedLink, type SignedLink } from '../ShareLink'

type Tab = 'renditions' | 'embed' | 'transform' | 'captions'

const LINK_TTL = [
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '24 hours' },
  { value: '604800', label: '7 days' },
  { value: '2592000', label: '30 days' },
] as const

const expiryFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' })

/** Who can watch: anyone with the link, or only viewers holding a signed, expiring link. */
function PlaybackAccess({ id, policy, approved, link, setLink, onChange }: {
  id: string
  policy: 'public' | 'signed'
  approved: boolean
  link: SignedLink | null
  setLink: (link: SignedLink | null) => void
  onChange: (p: 'public' | 'signed') => void
}) {
  const [ttl, setTtl] = useState<string>('86400')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      setLink(await createSignedLink(id, Number(ttl)))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t create the link.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Playback access" meta={policy === 'signed' ? 'Signed links only' : 'Anyone with the link'}>
      <div className="access">
        <Segmented
          label="Who can watch"
          value={policy}
          onChange={(p) => (setLink(null), onChange(p))}
          options={[
            { value: 'public', label: 'Anyone with the link' },
            { value: 'signed', label: 'Signed links only' },
          ]}
        />
        <p className="access-note">
          {policy === 'signed'
            ? 'The plain share link, stream URL and embed stop working for viewers. Hand out signed links that expire instead; members of this workspace can always watch.'
            : 'Anyone who has the share link, stream URL or embed can watch. Switch to signed links to make every link expire.'}
        </p>
        {policy === 'signed' && approved && (
          <>
            <div className="copy-row">
              <select className="select" value={ttl} onChange={(e) => setTtl(e.target.value)} aria-label="Link lifetime">
                {LINK_TTL.map((o) => (
                  <option key={o.value} value={o.value}>
                    Valid for {o.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={create}>
                <Icon name="link" size={15} /> {busy ? 'Signing…' : 'Create signed link'}
              </button>
            </div>
            {link && (
              <>
                <p className="access-note">
                  Expires <time dateTime={link.expiresAt}>{expiryFormat.format(new Date(link.expiresAt))}</time>. For your own player, use the stream URL with the same token. To sign links on your own server, see Developers → Playback signing.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

export default function AssetDetail({ id, initial }: { id: string; initial: MediaAsset }) {
  const { get, loaded, remove, update, retry } = useMedia()
  const lib = useLibrary()
  const { workspace } = useAccount()
  const media = useMedia()
  const [collecting, setCollecting] = useState(false)
  const recent = get(id)
  const [detail, setDetail] = useState<MediaAsset | null>(initial)
  useEffect(() => {
    if (recent) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refreshDetail = async () => {
      try {
        const response = await fetch(`/api/assets/${id}`, { cache: 'no-store', signal: controller.signal })
        if (response.status === 404 && !controller.signal.aborted) setDetail(null)
        else if (response.ok) {
          const { asset } = await response.json() as { asset: MediaAsset }
          if (!controller.signal.aborted) setDetail(asset)
        }
      } catch { /* keep the last successful read */ }
      if (!controller.signal.aborted) timer = setTimeout(refreshDetail, isActive(detail ?? initial) ? 1500 : 30000)
    }
    void refreshDetail()
    return () => { clearTimeout(timer); controller.abort() }
  }, [id, recent, initial, detail?.status])
  const a = recent ?? detail
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('renditions')
  const [more, setMore] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('')
  const [issued, setIssued] = useState<{ id: string; link: SignedLink } | null>(null)
  const [opening, setOpening] = useState(false)
  useEffect(() => setOrigin(window.location.origin), [])

  if (!a) {
    return (
      <div className="empty">
        <Icon name="library" size={22} />
        <b>{loaded ? 'This asset was deleted or moved' : 'Loading…'}</b>
        <Link href="/dashboard/library" className="btn btn-ghost btn-sm">
          Back to the library
        </Link>
      </div>
    )
  }

  const signed = a.playback === 'signed'
  const signedLink = issued?.id === id && Date.parse(issued.link.expiresAt) > Date.now() ? issued.link : null
  const watch = signed ? signedLink?.embedUrl : origin && `${origin}/embed/${a.id}`
  const playlist = signed ? signedLink?.playbackUrl : a.playbackUrl
  const stream = playlist && origin ? new URL(playlist, origin).href : ''
  const embed = `<iframe src="${watch}" width="100%" style="aspect-ratio:16/9;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
  const ready = a.status === 'ready'
  // share links only work once the asset is approved (moderation)
  const shareable = ready && a.moderation === 'approved'
  const openSignedPlayer = async () => {
    setOpening(true)
    try {
      const link = await createSignedLink(id)
      window.location.assign(link.embedUrl)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t create the link.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <Link href="/dashboard/library" className="back-link">
        <Icon name="arrowLeft" size={15} /> Library
      </Link>

      <div className="asset-head">
        <div>
          <h1>{a.title}</h1>
          <div className="asset-head-meta">
            <StatusBadge status={a.status} progress={a.progress} />
            <ModerationBadge state={a.moderation} />
            <span>
              <TypeIcon type={a.type} />
              {a.type[0].toUpperCase() + a.type.slice(1)}
            </span>
            {a.width && <span>{dims(a)}</span>}
            {a.duration > 0 && <span>{fmtDuration(Math.round(a.duration))}</span>}
            <span>{bytes(a.size)}</span>
          </div>
        </div>
        <div className="page-actions">
          <ShareLink asset={a} />
          {shareable && (signed ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={opening} onClick={openSignedPlayer}>
              {opening ? 'Opening player…' : 'Open player'} <Icon name="play" size={14} />
            </button>
          ) : (
            <a href={`/embed/${a.id}`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              Open player <Icon name="external" size={14} />
            </a>
          ))}
          <div className="menu-wrap">
            <button type="button" className="icon-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Icon name="more" />
            </button>
            {more && (
              <div className="menu menu-right" role="menu" onMouseLeave={() => setMore(false)}>
                <button type="button" role="menuitem" onClick={() => (setMore(false), setTitle(a.title), setRenaming(true))}>
                  <Icon name="settings" size={15} /> Rename
                </button>
                {a.status !== 'uploading' && (
                  <a role="menuitem" href={`/api/media/${a.id}/original`} onClick={() => setMore(false)}>
                    <Icon name="file" size={15} /> Download original
                  </a>
                )}
                {(a.status === 'ready' || a.status === 'failed') && (
                  <button type="button" role="menuitem" onClick={() => (setMore(false), void retry(a.id))}>
                    <Icon name="refresh" size={15} /> Re-run pipeline
                  </button>
                )}
                <hr />
                <button type="button" role="menuitem" className="is-danger" onClick={() => (setMore(false), setConfirm(true))}>
                  <Icon name="trash" size={15} /> {a.status === 'uploading' ? 'Cancel upload' : 'Move to Trash'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {a.status === 'ready' && a.moderation !== 'approved' && (
        <div className={`banner ${a.moderation === 'rejected' ? 'is-bad' : 'is-review'}`} role="status">
          <Icon name={a.moderation === 'rejected' ? 'x' : 'clock'} />
          <div>
            <b>{a.moderation === 'rejected' ? 'Rejected — only your workspace can see this.' : 'In review — not public yet.'}</b>{' '}
            {a.moderationFlags.length ? a.moderationFlags.map((f) => f.reason).join(' · ') : a.moderation === 'pending' ? 'Every upload in this workspace is reviewed before it goes public.' : ''}
            {a.moderationNote && <small>Note: {a.moderationNote}</small>}
          </div>
          {canManage(workspace.role) && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  try {
                    await request('/api/moderation/decide', { method: 'POST', json: { ids: [a.id], decision: 'approve' } })
                    toast('Approved — it’s public by link now')
                    await media.refresh()
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Couldn’t approve.')
                  }
                }}
              >
                Approve
              </button>
              {a.moderation === 'pending' && (
                <Link href="/dashboard/review" className="btn btn-ghost btn-sm">
                  Review queue
                </Link>
              )}
            </>
          )}
        </div>
      )}

      {a.status === 'failed' && (
        <div className="banner is-bad" role="alert">
          <Icon name="alert" />
          <div>
            <b>Processing failed.</b> {a.error ?? 'FFmpeg couldn’t process this file.'}
            <small>The original is still stored. Re-run the pipeline after fixing the cause, or download the original.</small>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retry(a.id)}>
            Try again
          </button>
        </div>
      )}

      <div className="asset-layout">
        <div className="stack">
          <MediaPlayer asset={a} />

          {isActive(a) && (
            <Card title="Pipeline" meta={a.status === 'uploading' ? 'Uploading' : a.status === 'queued' ? 'Waiting for an encoder' : `${Math.round(a.progress)}%`}>
              <div className="stages stages-lg stages-4">
                {STAGES.map((s, i) => {
                  const now = a.status === 'uploading' ? 0 : a.status === 'queued' ? -1 : a.stage
                  const done = a.status === 'queued' ? i === 0 : i < now
                  return (
                    <span key={s} className={done ? 'is-done' : i === now ? 'is-now' : ''}>
                      <i />
                      {s}
                    </span>
                  )
                })}
              </div>
            </Card>
          )}

          {(ready || a.renditions.length > 0) && (
            <div>
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'renditions', label: 'Renditions', count: a.renditions.length },
                  ...(ready && a.type !== 'image' ? [{ value: 'embed' as Tab, label: 'Embed' }] : []),
                  ...(ready && a.type !== 'image' ? [{ value: 'captions' as Tab, label: 'Captions', count: a.captions.filter((c) => c.status === 'ready').length || undefined }] : []),
                  ...(ready && a.type !== 'audio' ? [{ value: 'transform' as Tab, label: 'Transform' }] : []),
                ]}
              />

              {tab === 'renditions' && (
                <Card flush>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Rendition</th>
                          <th>Codec</th>
                          <th className="num">Size</th>
                          <th className="num">Bitrate</th>
                          <th className="num">File size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.renditions.map((r) => (
                          <tr key={r.name}>
                            <td className="cell-strong">{r.name}</td>
                            <td className="muted">{r.codec}</td>
                            <td className="num">{r.width ? (r.height ? `${r.width} × ${r.height}` : `${r.width} px`) : '—'}</td>
                            <td className="num">{r.bitrate ? `${r.bitrate >= 1e6 ? (r.bitrate / 1e6).toFixed(1) + ' Mbps' : Math.round(r.bitrate / 1000) + ' kbps'}` : '—'}</td>
                            <td className="num">{bytes(r.size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {tab === 'transform' && <TransformBuilder asset={a} link={signedLink} onIssue={(link) => setIssued({ id, link })} />}

              {tab === 'captions' && <CaptionsPanel asset={a} />}

              {tab === 'embed' && (
                <div className="stack">
                  <PlaybackAccess
                    id={id}
                    policy={a.playback}
                    approved={shareable}
                    link={signedLink}
                    setLink={(link) => setIssued(link ? { id, link } : null)}
                    onChange={(playback) => void update(id, { playback })}
                  />
                  {shareable && watch && (
                    <>
                      <Card title="Share link" meta={signed ? 'Expires with the signed link' : 'Anyone with the link can watch'}>
                        <div className="copy-row">
                          <code>{watch}</code>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(watch, 'Share link copied')}>
                            <Icon name="copy" size={15} /> Copy
                          </button>
                        </div>
                      </Card>
                      {stream && (
                        <Card title="HLS stream" meta="For your own player">
                          <div className="copy-row">
                            <code>{stream}</code>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(stream, 'Stream URL copied')}>
                              <Icon name="copy" size={15} /> Copy
                            </button>
                          </div>
                        </Card>
                      )}
                      <Card
                        title="Embed code"
                        meta="Responsive iframe"
                        action={
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(embed, 'Embed code copied')}>
                            <Icon name="copy" size={15} /> Copy
                          </button>
                        }
                      >
                        <pre className="snippet">
                          <code>{embed}</code>
                        </pre>
                      </Card>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="stack">
          <Card title="Details">
            <dl className="details">
              <div>
                <dt>Asset ID</dt>
                <dd className="mono">{a.id}</dd>
              </div>
              <div>
                <dt>Original file</dt>
                <dd>{a.fileName}</dd>
              </div>
              {a.sourceInfo && (
                <div>
                  <dt>Source</dt>
                  <dd>{a.sourceInfo}</dd>
                </div>
              )}
              <div>
                <dt>Uploaded</dt>
                <dd>
                  <Ago iso={a.createdAt} />
                  {a.createdBy ? ` · ${a.createdBy}` : ''}
                </dd>
              </div>
              <div>
                <dt>Stored</dt>
                <dd>
                  {bytes(a.size)} original{a.outputSize ? ` + ${bytes(a.outputSize)} outputs` : ''}
                </dd>
              </div>
              {ready && a.type !== 'image' && (
                <div>
                  <dt>Audience</dt>
                  <dd>
                    <Link href={`/dashboard/analytics?asset=${a.id}`}>Views, retention and quality</Link>
                  </dd>
                </div>
              )}
              <div>
                <dt>Access</dt>
                <dd>
                  {a.moderation === 'approved'
                    ? signed
                      ? 'Signed links only · original is members-only'
                      : 'Anyone with the link can watch · original is members-only'
                    : a.moderation === 'pending'
                      ? 'Members only until it’s approved'
                      : 'Members only — rejected in review'}
                </dd>
              </div>
            </dl>
          </Card>
          <Card title="Custom fields">
            <MetadataEditor asset={a} />
          </Card>
          <Card title="Organise">
            <div className="organise">
              <label className="field-d">
                <span>Folder</span>
                <select className="select" value={a.folderId ?? ''} onChange={(e) => void update(a.id, { folderId: e.target.value || null })}>
                  <option value="">No folder</option>
                  {flatTree(lib.folders).map(({ folder, depth }) => (
                    <option key={folder.id} value={folder.id}>
                      {'\u00a0\u00a0'.repeat(depth)}
                      {depth ? '└ ' : ''}
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-d">
                <span>Tags</span>
                <TagInput value={a.tags} onChange={(tags) => void update(a.id, { tags })} />
              </div>
              <div className="field-d">
                <span>Collections</span>
                <div className="tags">
                  {lib.collections
                    .filter((c) => a.collectionIds.includes(c.id))
                    .map((c) => (
                      <button key={c.id} type="button" className="tag" title={`Remove from ${c.name}`} onClick={() => void lib.collect(c.id, [a.id], true)}>
                        {c.name} <Icon name="x" size={12} />
                      </button>
                    ))}
                  <button type="button" className="tag-add" onClick={() => setCollecting(true)}>
                    <Icon name="plus" size={13} /> Add
                  </button>
                </div>
              </div>
            </div>
          </Card>
          {ready && canManage(workspace.role) && <VersionPanel key={a.id} asset={a} onChanged={async () => {
            const updated = await request<{ asset: MediaAsset }>('/api/assets/' + a.id)
            setDetail(updated.asset)
            await Promise.all([media.refresh(), lib.reload()])
          }} />}
        </aside>
      </div>

      {collecting && <CollectDialog count={1} onClose={() => setCollecting(false)} onPick={(cid) => lib.collect(cid, [a.id])} />}

      {renaming && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setRenaming(false)}>
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
            onSubmit={async (e) => {
              e.preventDefault()
              if (title.trim() && (await update(a.id, { title: title.trim() }))) setRenaming(false)
            }}
          >
            <h2 id="rename-title">Rename asset</h2>
            <p>The title shows in your library and on the share page.</p>
            <input className="input" style={{ width: '100%' }} value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {confirm && (
        <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
            <h2 id="del-title">{a.status === 'uploading' ? 'Cancel upload' : 'Move to Trash'}?</h2>
            <p>{a.status === 'uploading' ? 'The incomplete upload will be discarded.' : `Share links for “${a.title}” will stop working. A workspace owner or admin can restore the asset for 30 days.`}</p>
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={async () => {
                  setConfirm(false)
                  if (await remove(a.id)) router.push('/dashboard/library')
                }}
              >
                {a.status === 'uploading' ? 'Cancel upload' : 'Move to Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
