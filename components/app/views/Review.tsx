'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { MediaAsset, ModerationSettings } from '@/lib/media/types'
import { canManage, useAccount } from '../account'
import Icon from '../Icon'
import { request } from '../library'
import { Dialog } from '../library-ui/dialogs'
import { Ago, useMedia } from '../media'
import { Card, PageHead, Tabs, Thumb, TypeIcon, toast } from '../ui'

type State = 'pending' | 'rejected' | 'approved'
const MODE_TEXT = {
  off: 'Moderation is off: uploads are public by link as soon as they’re ready.',
  all: 'Every upload waits here until someone approves it.',
  flagged: 'Uploads go public on their own unless a check flags them.',
}

export default function Review() {
  const { workspace } = useAccount()
  const manage = canManage(workspace.role)
  const media = useMedia()
  const [state, setState] = useState<State>('pending')
  const [items, setItems] = useState<MediaAsset[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [settings, setSettings] = useState<ModerationSettings | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([request<{ assets: MediaAsset[]; counts: Record<string, number> }>(`/api/moderation/queue?state=${state}`), request<ModerationSettings>('/api/moderation/settings')])
      setItems(q.assets)
      setCounts(q.counts)
      setSettings(s)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t load the review queue.')
    }
  }, [state])
  // reload when uploads finish or decisions are made elsewhere
  const signature = media.assets.map((a) => a.id + a.status + a.moderation).join('|')
  useEffect(() => {
    void load()
  }, [load, signature])
  useEffect(() => setSelected(new Set()), [state])

  const decide = async (ids: string[], decision: 'approve' | 'reject', note?: string) => {
    setBusy(true)
    try {
      await request('/api/moderation/decide', { method: 'POST', json: { ids, decision, note } })
      toast(`${decision === 'approve' ? 'Approved' : 'Rejected'} ${ids.length === 1 ? '1 asset' : `${ids.length} assets`}`)
      setSelected(new Set())
      await Promise.all([load(), media.refresh()])
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save the decision.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))
  const ids = [...selected]

  return (
    <>
      <PageHead title="Review" sub={settings ? MODE_TEXT[settings.mode] : 'Uploads waiting for a decision before they go public.'}>
        {manage && (
          <Link href="/dashboard/settings?tab=moderation" className="btn btn-ghost btn-sm">
            <Icon name="settings" size={14} /> Moderation settings
          </Link>
        )}
      </PageHead>

      <Tabs
        value={state}
        onChange={setState}
        tabs={[
          { value: 'pending', label: 'Waiting', count: counts.pending ?? 0 },
          { value: 'rejected', label: 'Rejected', count: counts.rejected ?? 0 },
          { value: 'approved', label: 'Recently approved' },
        ]}
      />

      {manage && state !== 'approved' && items && items.length > 0 && (
        <div className={`lib-bar ${selected.size ? 'is-selecting' : ''}`}>
          {selected.size ? (
            <>
              <button type="button" className="icon-btn is-quiet" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                <Icon name="x" size={16} />
              </button>
              <b>{selected.size} selected</b>
              <span className="grow" />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void decide(ids, 'approve')}>
                <Icon name="check" size={14} /> Approve
              </button>
              {state === 'pending' && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRejecting(ids)}>
                  Reject
                </button>
              )}
            </>
          ) : (
            <>
              <span className="lib-count">{items.length === 1 ? '1 asset' : `${items.length} assets`} · flagged first</span>
              <span className="grow" />
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSelected(new Set(items.map((a) => a.id)))}>
                Select all
              </button>
            </>
          )}
        </div>
      )}

      {items === null ? (
        <p className="quiet-note">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <div className="empty">
            <Icon name="check" size={22} />
            <b>{state === 'pending' ? 'Nothing waiting' : state === 'rejected' ? 'Nothing rejected' : 'No decisions yet'}</b>
            <p>
              {state === 'pending'
                ? settings?.mode === 'off'
                  ? 'Turn moderation on to hold new uploads here until someone approves them.'
                  : 'New uploads appear here when they need a decision.'
                : state === 'rejected'
                  ? 'Rejected assets stay private to the workspace. Approve one here to publish it.'
                  : 'Assets someone approved show here.'}
            </p>
            {manage && state === 'pending' && settings?.mode === 'off' && (
              <Link href="/dashboard/settings?tab=moderation" className="btn btn-ghost btn-sm">
                Turn on moderation
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <div className="review-grid">
          {items.map((a) => (
            <article key={a.id} className={`review-card ${selected.has(a.id) ? 'is-selected' : ''} ${a.moderationFlags.length ? 'is-flagged' : ''}`}>
              <div className="review-media">
                <Link href={`/dashboard/library/${a.id}`} aria-label={`Open ${a.title}`}>
                  <Thumb asset={a} />
                </Link>
                {manage && state !== 'approved' && (
                  <label className="asset-check" style={{ opacity: 1 }}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${a.title}`} />
                  </label>
                )}
              </div>
              <div className="review-body">
                <Link href={`/dashboard/library/${a.id}`} className="review-title">
                  {a.title}
                </Link>
                <small>
                  <TypeIcon type={a.type} /> {a.createdBy ?? 'Someone'} · <Ago iso={a.createdAt} />
                  {a.status !== 'ready' ? ' · still processing' : ''}
                </small>
                {a.moderationFlags.length > 0 ? (
                  <ul className="review-flags">
                    {a.moderationFlags.map((f, i) => (
                      <li key={i}>
                        <Icon name="alert" size={13} />
                        <span>
                          {f.reason}
                          {f.categories?.length ? <em> · {f.categories.join(', ')}</em> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : state === 'pending' ? (
                  <p className="review-ok">No flags — waiting because every upload is reviewed.</p>
                ) : null}
                {a.moderationNote && <p className="review-note">“{a.moderationNote}”</p>}
              </div>
              {manage && (
                <div className="review-actions">
                  {state !== 'approved' && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy || a.status !== 'ready'} onClick={() => void decide([a.id], 'approve')}>
                      Approve
                    </button>
                  )}
                  {state !== 'rejected' && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setRejecting([a.id])}>
                      {state === 'approved' ? 'Unpublish' : 'Reject'}
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {rejecting && <RejectDialog count={rejecting.length} onClose={() => setRejecting(null)} onReject={(note) => decide(rejecting, 'reject', note)} />}
    </>
  )
}

function RejectDialog({ count, onClose, onReject }: { count: number; onClose: () => void; onReject: (note?: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={`Reject ${count === 1 ? 'this asset' : `${count} assets`}?`}
      sub="Rejected assets stay in the library but can’t be watched outside the workspace. You can approve them later."
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true)
        if (await onReject(note.trim() || undefined)) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger btn-sm" disabled={busy}>
            {busy ? 'Rejecting…' : 'Reject'}
          </button>
        </>
      }
    >
      <label className="field-d">
        <span>Note for the team (optional)</span>
        <input className="input" autoFocus maxLength={300} placeholder="e.g. Contains an unreleased product" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Dialog>
  )
}
