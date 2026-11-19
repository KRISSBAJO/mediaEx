'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { STAGES, isActive } from '@/lib/media/types'
import { bytes, duration as fmtDuration } from '@/lib/sample'
import Icon from '../Icon'
import MediaPlayer from '../MediaPlayer'
import { Ago, dims, useMedia } from '../media'
import { Card, StatusBadge, Tabs, TypeIcon, copyText } from '../ui'

type Tab = 'renditions' | 'embed'

export default function AssetDetail({ id }: { id: string }) {
  const { get, loaded, remove, update, retry } = useMedia()
  const a = get(id)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('renditions')
  const [more, setMore] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [tagInput, setTagInput] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
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

  const watch = `${origin}/embed/${a.id}`
  const stream = a.playbackUrl ? `${origin}${a.playbackUrl}` : ''
  const embed = `<iframe src="${watch}" width="100%" style="aspect-ratio:16/9;border:0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
  const ready = a.status === 'ready'

  const saveTags = async (next: string[]) => {
    if (await update(a.id, { tags: next })) setTagInput(null)
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
          {ready && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(watch, 'Share link copied — anyone with it can watch')}>
              <Icon name="link" size={15} /> Copy share link
            </button>
          )}
          {ready && (
            <a href={`/embed/${a.id}`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              Open player <Icon name="external" size={14} />
            </a>
          )}
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
                  <Icon name="trash" size={15} /> Delete asset
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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

              {tab === 'embed' && (
                <div className="stack">
                  <Card title="Share link" meta="Anyone with the link can watch">
                    <div className="copy-row">
                      <code>{watch}</code>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(watch, 'Share link copied')}>
                        <Icon name="copy" size={15} /> Copy
                      </button>
                    </div>
                  </Card>
                  <Card title="HLS stream" meta="For your own player">
                    <div className="copy-row">
                      <code>{stream}</code>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(stream, 'Stream URL copied')}>
                        <Icon name="copy" size={15} /> Copy
                      </button>
                    </div>
                  </Card>
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
              <div>
                <dt>Access</dt>
                <dd>Anyone with the link can watch · original is members-only</dd>
              </div>
            </dl>
          </Card>
          <Card title="Tags">
            <div className="tags">
              {a.tags.map((t) => (
                <button key={t} type="button" className="tag" title={`Remove ${t}`} onClick={() => void saveTags(a.tags.filter((x) => x !== t))}>
                  {t} <Icon name="x" size={12} />
                </button>
              ))}
              {tagInput === null ? (
                <button type="button" className="tag-add" onClick={() => setTagInput('')}>
                  <Icon name="plus" size={13} /> Add
                </button>
              ) : (
                <form
                  className="tag-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const t = tagInput.trim()
                    if (t) void saveTags([...a.tags, t])
                    else setTagInput(null)
                  }}
                >
                  <input className="input" autoFocus value={tagInput} maxLength={32} placeholder="New tag" aria-label="New tag" onChange={(e) => setTagInput(e.target.value)} onBlur={() => !tagInput.trim() && setTagInput(null)} />
                </form>
              )}
            </div>
          </Card>
        </aside>
      </div>

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
            <h2 id="del-title">Delete “{a.title}”?</h2>
            <p>The original and every rendition are removed from storage, and share links and embeds stop playing. This can’t be undone.</p>
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
                Delete asset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
