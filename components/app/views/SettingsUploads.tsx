'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MediaType, UploadPolicy, UploadPreset } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import { canManage, useAccount } from '../account'
import { flatTree, request, useLibrary } from '../library'
import { Card, LoadFailed, toast } from '../ui'

type Draft = Omit<UploadPreset, 'id'> & { id?: string }
const fresh = (): Draft => ({
  name: '', folderId: null, isDefault: false,
  policy: { kinds: ['image', 'audio', 'video'], maxBytes: null, maxSourceEdge: null, maxDuration: null, maxShortSide: null, playback: 'signed', review: false },
})
const kinds: MediaType[] = ['image', 'audio', 'video']
const endpoint = '/api/uploads/presets'

export default function SettingsUploads() {
  const { workspace } = useAccount()
  const { folders } = useLibrary()
  const manage = canManage(workspace.role)
  const [items, setItems] = useState<UploadPreset[]>([])
  const [maximum, setMaximum] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<UploadPreset | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    try {
      const result = await request<{ presets: UploadPreset[]; maxUploadBytes: number }>(endpoint)
      setItems(result.presets)
      setMaximum(result.maxUploadBytes)
      setLoadError('')
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load upload presets.') }
  }, [])
  useEffect(() => { void reload() }, [reload])
  const policy = (patch: Partial<UploadPolicy>) => setDraft(d => d && { ...d, policy: { ...d.policy, ...patch } })
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft || busy) return
    setError('')
    setBusy(true)
    try {
      await request(draft.id ? endpoint + '/' + draft.id : endpoint, { method: draft.id ? 'PUT' : 'POST', json: draft })
      setDraft(null)
      await reload()
      toast('Upload preset saved')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save preset.') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!deleting || busy) return
    setBusy(true)
    setError('')
    try {
      await request(endpoint + '/' + deleting.id, { method: 'DELETE' })
      setDeleting(null)
      await reload()
      toast('Upload preset deleted')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete preset.') }
    finally { setBusy(false) }
  }

  if (loadError) return <LoadFailed what="upload presets" detail={loadError} onRetry={reload} />
  if (maximum === null) return <p>Loading upload presets…</p>
  return <div className="stack">
    <Card title="Upload presets" hint="The default applies to dashboard and API uploads when no preset is selected."
      action={manage && !draft && <button className="btn btn-primary btn-sm" onClick={() => { setError(''); setDraft(fresh()) }}>New preset</button>}>
      {items.length === 0 ? <p>No upload presets yet.</p> : <ul className="rows">{items.map(p => <li key={p.id}>
        <div className="grow"><b>{p.name}{p.isDefault ? ' · Default' : ''}</b>
          <small>{p.policy.kinds.join(', ')} · {bytes(p.policy.maxBytes ?? maximum)} per file · {p.policy.playback} playback</small>
          <small>Preset ID <code>{p.id}</code></small></div>
        {manage && <><button className="btn btn-quiet btn-sm" onClick={() => { setError(''); setDraft(p) }}>Edit</button>
          <button className="btn btn-quiet btn-sm" onClick={() => { setDraft(null); setError(''); setDeleting(p) }}>Delete</button></>}
      </li>)}</ul>}
    </Card>
    {draft && <Card title={draft.id ? 'Edit upload preset' : 'New upload preset'}>
      <form onSubmit={save} className="stack"><fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
        <label className="setting-field"><span>Name</span><input className="input" required autoFocus maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
        <label className="setting-field"><span>Destination folder</span><select className="select" value={draft.folderId ?? ''} onChange={e => setDraft({ ...draft, folderId: e.target.value || null })}>
          <option value="">Library root</option>{flatTree(folders).map(({folder, depth}) => <option key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.name}</option>)}</select></label>
        <fieldset><legend>Allowed media</legend>{kinds.map(kind => <label key={kind} style={{ marginRight: 12 }}>
          <input type="checkbox" checked={draft.policy.kinds.includes(kind)} onChange={e => policy({ kinds: e.target.checked ? [...draft.policy.kinds, kind] : draft.policy.kinds.filter(k => k !== kind) })}/> {kind}</label>)}</fieldset>
        <label className="setting-field"><span>Maximum file size (bytes)</span><input className="input" type="number" min="1" max={maximum} step="1" placeholder={String(maximum)} value={draft.policy.maxBytes ?? ''} onChange={e => policy({ maxBytes: e.target.value ? Number(e.target.value) : null })}/></label>
        <label className="setting-field"><span>Maximum source width or height (pixels)</span><input className="input" type="number" min="1" max="65535" placeholder="No preset limit" value={draft.policy.maxSourceEdge ?? ''} onChange={e => policy({ maxSourceEdge: e.target.value ? Number(e.target.value) : null })}/></label>
        <label className="setting-field"><span>Maximum duration (seconds)</span><input className="input" type="number" min="1" max="604800" placeholder="No preset limit" value={draft.policy.maxDuration ?? ''} onChange={e => policy({ maxDuration: e.target.value ? Number(e.target.value) : null })}/></label>
        <label className="setting-field"><span>Maximum video rendition</span><select className="select" value={draft.policy.maxShortSide ?? ''} onChange={e => policy({ maxShortSide: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Plan maximum</option>{[360,480,720,1080,1440,2160,4320].map(n => <option key={n} value={n}>{n}p</option>)}</select></label>
        <label className="setting-field"><span>Playback access</span><select className="select" value={draft.policy.playback} onChange={e => policy({ playback: e.target.value as UploadPolicy['playback'] })}>
          <option value="signed">Signed links</option><option value="public">Public link</option></select></label>
        <p><label><input type="checkbox" checked={draft.policy.review} onChange={e => policy({ review: e.target.checked })}/> Require review before publishing</label></p>
        <p><label><input type="checkbox" checked={draft.isDefault} onChange={e => setDraft({ ...draft, isDefault: e.target.checked })}/> Use as the workspace default</label></p>
      </fieldset>
      {error && <p className="is-bad" role="alert">{error}</p>}
      <div className="dialog-foot"><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy || !draft.policy.kinds.length}>Save preset</button></div>
      </form>
    </Card>}
    {deleting && <div className="dialog-scrim"><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-preset">
      <h2 id="delete-preset">Delete {deleting.name}?</h2><p>Future uploads will no longer be able to select this preset.</p>
      {error && <p role="alert" className="is-bad">{error}</p>}
      <div className="dialog-foot"><button className="btn btn-ghost btn-sm" disabled={busy} autoFocus onClick={() => setDeleting(null)}>Cancel</button>
      <button className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>Delete preset</button></div>
    </div></div>}
  </div>
}
