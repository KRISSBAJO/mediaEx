'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { Folder, MediaType, RetentionDraft, RetentionEvent, RetentionPreview, RetentionRule } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import { canManage, useAccount } from '../account'
import Icon from '../Icon'
import { flatTree, request, useLibrary } from '../library'
import { ago, useMedia } from '../media'
import { Card, LoadFailed, toast } from '../ui'

const endpoint = '/api/assets/retention'
const KINDS: { value: MediaType; label: string }[] = [
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'image', label: 'Images' },
]
const QUICK_DAYS = [7, 30, 90, 180, 365]
type Draft = RetentionDraft & { id?: string }
const fresh = (): Draft => ({ name: '', enabled: true, folderId: null, includeSubfolders: true, kinds: ['video', 'audio', 'image'], tag: null, basis: 'created', days: 90 })
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

const bodyOf = (r: Draft | RetentionRule): RetentionDraft => ({
  name: r.name, enabled: r.enabled, folderId: r.folderId, includeSubfolders: r.includeSubfolders, kinds: r.kinds, tag: r.tag, basis: r.basis, days: r.days,
})

/** "Move videos and audio in Drafts and its subfolders tagged “raw” to Trash 90 days after upload." */
export function describeRule(r: RetentionDraft, folders: Folder[]) {
  const what = r.kinds.length === 3 ? 'all media' : KINDS.filter((k) => r.kinds.includes(k.value)).map((k) => k.label.toLowerCase()).join(' and ') || 'media'
  const folder = r.folderId ? folders.find((f) => f.id === r.folderId) : null
  const where = r.folderId ? ` in ${folder ? folder.name : 'a deleted folder'}${r.includeSubfolders ? ' and its subfolders' : ''}` : ''
  const tag = r.tag ? ` tagged “${r.tag}”` : ''
  const days = Number.isInteger(r.days) && r.days > 0 ? plural(r.days, 'day') : 'some days'
  const when = r.basis === 'created' ? `${days} after upload` : `after ${days} without a play`
  return `Move ${what}${where}${tag} to Trash ${when}.`
}

/** Settings → Retention: rules that move old or unwatched media to Trash automatically. */
export default function SettingsRetention() {
  const { workspace } = useAccount()
  const { folders, reload: reloadLibrary } = useLibrary()
  const media = useMedia()
  const manage = canManage(workspace.role)
  const [rules, setRules] = useState<RetentionRule[] | null>(null)
  const [events, setEvents] = useState<RetentionEvent[]>([])
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<RetentionPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'save' | 'run' | 'delete'; rule?: RetentionRule; preview?: RetentionPreview | null } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const r = await request<{ rules: RetentionRule[]; events: RetentionEvent[] }>(endpoint)
      setRules(r.rules)
      setEvents(r.events)
      setLoadError('')
    } catch (e) {
      setLoadError(message(e, 'Could not load retention rules.'))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload, workspace.id])

  // Live preview while editing: what the draft would move to Trash right now.
  const valid = !!draft && draft.kinds.length > 0 && Number.isInteger(draft.days) && draft.days >= 1 && draft.days <= 3650
  const previewKey = draft && valid ? JSON.stringify({ ...bodyOf(draft), name: 'preview', enabled: true }) : ''
  useEffect(() => {
    if (!previewKey) {
      setPreview(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      request<RetentionPreview>(endpoint + '/preview', { method: 'POST', json: JSON.parse(previewKey), signal: controller.signal })
        .then((p) => {
          setPreview(p)
          setPreviewError('')
        })
        .catch((e) => {
          if (!controller.signal.aborted) setPreviewError(message(e, 'Could not check this rule.'))
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [previewKey])

  const edit = (d: Draft | null) => {
    setError('')
    setPreview(null)
    setPreviewError('')
    setDraft(d)
  }

  const save = async () => {
    if (!draft) return
    setBusy('save')
    setError('')
    try {
      const id = draft.id
      await request(id ? `${endpoint}/${id}` : endpoint, { method: id ? 'PUT' : 'POST', json: bodyOf(draft) })
      setConfirm(null)
      edit(null)
      await reload()
      toast(id ? 'Retention rule saved' : 'Retention rule created')
    } catch (e) {
      setConfirm(null)
      setError(message(e, 'Could not save this rule.'))
    } finally {
      setBusy('')
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft || busy) return
    // Turning on a rule that matches media now gets one explicit confirmation.
    if (draft.enabled && preview && preview.count > 0) setConfirm({ kind: 'save', preview })
    else void save()
  }

  const toggle = async (rule: RetentionRule) => {
    setBusy(rule.id)
    try {
      await request(`${endpoint}/${rule.id}`, { method: 'PUT', json: { ...bodyOf(rule), enabled: !rule.enabled } })
      await reload()
      toast(rule.enabled ? 'Rule paused' : 'Rule resumed')
    } catch (e) {
      toast(message(e, 'Could not change this rule.'))
    } finally {
      setBusy('')
    }
  }

  const askRun = async (rule: RetentionRule) => {
    setError('')
    setConfirm({ kind: 'run', rule, preview: null })
    try {
      const p = await request<RetentionPreview>(endpoint + '/preview', { method: 'POST', json: { ...bodyOf(rule), enabled: true } })
      setConfirm((c) => (c?.rule?.id === rule.id ? { ...c, preview: p } : c))
    } catch (e) {
      setError(message(e, 'Could not check this rule.'))
    }
  }

  const run = async (rule: RetentionRule) => {
    setBusy('run')
    try {
      const { moved } = await request<{ moved: number }>(`${endpoint}/${rule.id}/run`, { method: 'POST' })
      setConfirm(null)
      await Promise.all([reload(), media.refresh(), reloadLibrary()])
      toast(moved ? `${plural(moved, 'asset')} moved to Trash` : 'Nothing matched this rule')
    } catch (e) {
      setError(message(e, 'Could not run this rule.'))
    } finally {
      setBusy('')
    }
  }

  const remove = async (rule: RetentionRule) => {
    setBusy('delete')
    try {
      await request(`${endpoint}/${rule.id}`, { method: 'DELETE' })
      setConfirm(null)
      if (draft?.id === rule.id) edit(null)
      await reload()
      toast('Retention rule deleted')
    } catch (e) {
      setError(message(e, 'Could not delete this rule.'))
    } finally {
      setBusy('')
    }
  }

  if (loadError) return <LoadFailed what="retention rules" detail={loadError} onRetry={reload} />
  if (!rules) return <p className="quiet-note">Loading retention rules…</p>

  return (
    <div className="stack">
      <Card
        flush
        title="Retention rules"
        meta={rules.length ? `${rules.filter((r) => r.enabled).length} of ${rules.length} on` : undefined}
        action={manage && !draft && <button className="btn btn-primary btn-sm" onClick={() => edit(fresh())}><Icon name="plus" size={15} />New rule</button>}
        hint={<>Rules move matching media to <Link href="/dashboard/trash">Trash</Link>, where you can restore it for 30 days. Media that is still uploading or encoding, or under a site-admin takedown, is never moved.</>}
      >
        {rules.length === 0 ? (
          <div className="retention-empty">
            <Icon name="clock" size={22} />
            <div>
              <b>No retention rules yet</b>
              <p>Clear out raw footage, old drafts or clips nobody watches, without doing it by hand. For example: “Videos tagged raw go to Trash 30 days after upload.”</p>
            </div>
          </div>
        ) : (
          <ul className="rows retention-rows">
            {rules.map((r) => (
              <li key={r.id} className={r.enabled ? '' : 'is-paused'}>
                <div>
                  <b>
                    {r.name}
                    <span className={`status ${r.enabled ? 'status-ready' : 'status-queued'}`}>{r.enabled ? 'On' : 'Paused'}</span>
                  </b>
                  <p className="retention-desc">{describeRule(r, folders)}</p>
                  <small>
                    {r.lastRunAt ? `Last checked ${ago(r.lastRunAt).toLowerCase()} · moved ${r.lastMoved.toLocaleString()}` : r.enabled ? 'First check within 15 minutes' : 'Not run yet'}
                    {r.totalMoved > 0 && ` · ${r.totalMoved.toLocaleString()} in total`}
                  </small>
                </div>
                {manage && (
                  <div className="row-end retention-actions">
                    <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void askRun(r)}>Run now</button>
                    <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void toggle(r)}>{busy === r.id ? '…' : r.enabled ? 'Pause' : 'Resume'}</button>
                    <button className="btn btn-quiet btn-sm" disabled={!!busy} onClick={() => edit(r)}>Edit</button>
                    <button className="btn btn-quiet btn-sm" aria-label={`Delete ${r.name}`} disabled={!!busy} onClick={() => setConfirm({ kind: 'delete', rule: r })}><Icon name="trash" size={15} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!manage && <p className="access-note">Only workspace owners and admins can create or change retention rules.</p>}

      {draft && (
        <Card title={draft.id ? `Edit ${draft.name || 'rule'}` : 'New retention rule'}>
          <form onSubmit={submit} className="retention-form">
            <fieldset disabled={!!busy}>
              <label className="setting-field">
                <span>Name</span>
                <input className="input" required autoFocus maxLength={80} placeholder="Clear raw footage" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>

              <div className="retention-group">
                <h3>Which media</h3>
                <div className="retention-kinds" role="group" aria-label="Media types">
                  {KINDS.map((k) => (
                    <label key={k.value} className="retention-check">
                      <input type="checkbox" checked={draft.kinds.includes(k.value)} onChange={(e) => setDraft({ ...draft, kinds: e.target.checked ? [...draft.kinds, k.value] : draft.kinds.filter((x) => x !== k.value) })} />
                      <Icon name={k.value} size={15} />
                      {k.label}
                    </label>
                  ))}
                </div>
                {!draft.kinds.length && <small className="is-bad">Choose at least one media type.</small>}
                <div className="retention-pair">
                  <label className="setting-field">
                    <span>Folder</span>
                    <select className="select" value={draft.folderId ?? ''} onChange={(e) => setDraft({ ...draft, folderId: e.target.value || null })}>
                      <option value="">Whole library</option>
                      {flatTree(folders).map(({ folder, depth }) => (
                        <option key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.name}</option>
                      ))}
                    </select>
                    {draft.folderId && (
                      <label className="retention-check is-plain">
                        <input type="checkbox" checked={draft.includeSubfolders} onChange={(e) => setDraft({ ...draft, includeSubfolders: e.target.checked })} />
                        Include subfolders
                      </label>
                    )}
                  </label>
                  <label className="setting-field">
                    <span>Only with tag <em>(optional)</em></span>
                    <input className="input" maxLength={32} placeholder="e.g. raw" value={draft.tag ?? ''} onChange={(e) => setDraft({ ...draft, tag: e.target.value || null })} />
                  </label>
                </div>
              </div>

              <div className="retention-group">
                <h3>When it goes to Trash</h3>
                <div className="seg retention-basis" role="radiogroup" aria-label="Condition">
                  <button type="button" role="radio" aria-checked={draft.basis === 'created'} className={draft.basis === 'created' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, basis: 'created' })}>After upload</button>
                  <button type="button" role="radio" aria-checked={draft.basis === 'unplayed'} className={draft.basis === 'unplayed' ? 'is-on' : ''} onClick={() => setDraft({ ...draft, basis: 'unplayed' })}>Not played for</button>
                </div>
                <div className="retention-days">
                  <input className="input" type="number" min={1} max={3650} step={1} required aria-label="Days" value={Number.isNaN(draft.days) ? '' : draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.valueAsNumber })} />
                  <span>days</span>
                  <div className="retention-quick">
                    {QUICK_DAYS.map((d) => (
                      <button key={d} type="button" className={`btn btn-sm ${draft.days === d ? 'btn-ghost is-on' : 'btn-quiet'}`} onClick={() => setDraft({ ...draft, days: d })}>{d === 365 ? '1 year' : `${d} days`}</button>
                    ))}
                  </div>
                </div>
                {draft.basis === 'unplayed' && <small className="retention-note">Counts plays in the MediaEX player and embeds. Media is also never moved before it is this many days old.</small>}
              </div>

              <div className={`retention-preview ${preview && preview.count > 0 ? 'has-matches' : ''}`} aria-live="polite">
                <Icon name={preview && preview.count > 0 ? 'alert' : 'check'} size={17} />
                <div>
                  <b>{describeRule(draft, folders)}</b>
                  {!valid ? <p>Finish the rule to see what it matches.</p>
                    : previewError ? <p className="is-bad">{previewError}</p>
                    : !preview ? <p>Checking your library…</p>
                    : preview.count === 0 ? <p>Nothing in the library matches right now.</p>
                    : <p>Right now this matches <strong>{plural(preview.count, 'asset')}</strong> ({bytes(preview.bytes)}): {preview.samples.map((s) => s.title).join(', ')}{preview.count > preview.samples.length ? '…' : ''}</p>}
                </div>
              </div>

              <label className="retention-check is-plain retention-enable">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Turn the rule on when saved
              </label>
            </fieldset>
            {error && <p className="is-bad" role="alert">{error}</p>}
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => edit(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={!!busy || !valid || !draft.name.trim()}>{busy === 'save' ? 'Saving…' : draft.id ? 'Save rule' : 'Create rule'}</button>
            </div>
          </form>
        </Card>
      )}

      {events.length > 0 && (
        <Card flush title="Activity" meta="Last 25 changes and runs">
          <ul className="rows retention-log">
            {events.map((e, i) => (
              <li key={e.createdAt + i}>
                <div>
                  <b>{e.name} <span>{e.action}{e.moved != null ? ` · moved ${plural(e.moved, 'asset')}` : ''}</span></b>
                  <small>{e.actor ? `by ${e.actor}` : 'automatic'} · {ago(e.createdAt)}</small>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirm && (
        <div className="dialog-scrim">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="retention-confirm">
            {confirm.kind === 'delete' && confirm.rule ? (
              <>
                <h2 id="retention-confirm">Delete {confirm.rule.name}?</h2>
                <p>The rule stops running. Media it already moved stays in Trash until restored or expired.</p>
              </>
            ) : (
              <>
                <h2 id="retention-confirm">{confirm.kind === 'run' ? `Run ${confirm.rule?.name} now?` : 'Save and turn this rule on?'}</h2>
                {confirm.preview == null ? <p>Checking what this rule matches…</p>
                  : confirm.preview.count === 0 ? <p>Nothing matches right now, so nothing will move.</p>
                  : <p>
                      <strong>{plural(confirm.preview.count, 'asset')}</strong> ({bytes(confirm.preview.bytes)}) will move to Trash{confirm.kind === 'save' ? ' within 15 minutes' : ''}.
                      {' '}Links and embeds for them stop working. You can restore any of them from Trash for 30 days.
                      {confirm.preview.count > 500 && ' A run moves up to 500 assets; the rest follow on later runs.'}
                    </p>}
              </>
            )}
            {error && <p role="alert" className="is-bad">{error}</p>}
            <div className="dialog-foot">
              <button className="btn btn-ghost btn-sm" disabled={!!busy} autoFocus onClick={() => (setConfirm(null), setError(''))}>Cancel</button>
              {confirm.kind === 'delete' && confirm.rule && <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => void remove(confirm.rule!)}>Delete rule</button>}
              {confirm.kind === 'save' && <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save and turn on'}</button>}
              {confirm.kind === 'run' && confirm.rule && <button className="btn btn-danger btn-sm" disabled={!!busy || !confirm.preview?.count} onClick={() => void run(confirm.rule!)}>{busy ? 'Moving…' : 'Move to Trash'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
