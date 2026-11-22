'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { AssetBackup, BackupSettings } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import { canManage, useAccount } from '../account'
import Icon from '../Icon'
import { request } from '../library'
import { ago } from '../media'
import { Card, LoadFailed, toast } from '../ui'

const endpoint = '/api/assets/backup'
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/** Settings → Backups: a second copy of every original, in a separate storage location. */
export default function SettingsBackups() {
  const { workspace } = useAccount()
  const manage = canManage(workspace.role)
  const [s, setS] = useState<BackupSettings | null>(null)
  const [loadError, setLoadError] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setS(await request<BackupSettings>(endpoint))
      setLoadError('')
    } catch (e) {
      setLoadError(message(e, 'Could not load backup settings.'))
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload, workspace.id])
  // progress moves on its own while copies are being made or removed
  const working = !!s && ((s.enabled && s.stats.waiting > 0) || s.stats.removing > 0)
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => void reload(), 10_000)
    return () => clearInterval(t)
  }, [working, reload])

  const set = async (enabled: boolean) => {
    setBusy(true)
    setError('')
    try {
      setS(await request<BackupSettings>(endpoint, { method: 'PUT', json: { enabled } }))
      setConfirmOff(false)
      toast(enabled ? 'Backups turned on' : 'Backups turned off')
    } catch (e) {
      setError(message(e, 'Could not change backups.'))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <LoadFailed what="backup settings" detail={loadError} onRetry={reload} />
  if (!s) return <p className="quiet-note">Loading backup settings…</p>
  const { stats } = s
  const pct = stats.originals ? Math.round((stats.copied / stats.originals) * 100) : 100
  const state = !s.enabled ? 'Off' : !s.planIncludes ? 'Paused' : stats.waiting > 0 ? 'Copying' : stats.failed > 0 ? 'Needs attention' : 'Up to date'

  return (
    <div className="stack">
      <Card
        title="Backup copies"
        meta={s.available ? state : 'Not available yet'}
        action={
          manage && s.available && (s.enabled
            ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => (setError(''), setConfirmOff(true))}>Turn off</button>
            : <button className="btn btn-primary btn-sm" disabled={busy || !s.planIncludes} onClick={() => void set(true)}>{busy ? 'Turning on…' : 'Turn on backups'}</button>)
        }
      >
        <p className="access-note">
          MediaEX keeps a second copy of every original file you upload in a separate storage location, so a lost or damaged file can be put back.
          Only originals are copied: every streaming version, thumbnail and caption can be rebuilt from them. Copies of deleted media are removed when the media is deleted for good.
        </p>

        {!s.available ? (
          <div className="backup-callout">
            <Icon name="alert" size={17} />
            <p>Backup copies aren’t set up on this server yet, so they can’t be turned on.</p>
          </div>
        ) : !s.planIncludes ? (
          <div className="backup-callout">
            <Icon name="sparkle" size={17} />
            <p>
              {s.enabled ? 'Your plan no longer includes backups, so no new copies are being made. Existing copies are kept until you turn backups off.' : 'Backup copies come with Pro and Studio.'}{' '}
              <Link href="/dashboard/settings?tab=billing">See plans</Link>
            </p>
          </div>
        ) : null}

        {s.available && (s.enabled || stats.copied > 0 || stats.removing > 0) && (
          <div className="backup-summary">
            <div className="backup-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Originals backed up">
              <span style={{ width: `${s.enabled ? pct : 0}%` }} />
            </div>
            <dl className="backup-stats">
              <div><dt>Backed up</dt><dd>{stats.copied.toLocaleString()} <small>of {stats.originals.toLocaleString()} originals</small></dd></div>
              <div><dt>Size of copies</dt><dd>{bytes(stats.bytes)}</dd></div>
              <div><dt>Location</dt><dd className="backup-location">{s.location}</dd></div>
              <div><dt>Last copy</dt><dd>{stats.lastCopiedAt ? ago(stats.lastCopiedAt) : '—'}</dd></div>
            </dl>
            {s.enabled && stats.waiting > 0 && <p className="backup-line"><Icon name="refresh" size={15} /> Copying {stats.waiting.toLocaleString()} {stats.waiting === 1 ? 'original' : 'originals'}. New uploads are copied within a few minutes of being ready.</p>}
            {s.enabled && stats.failed > 0 && <p className="backup-line is-warn"><Icon name="alert" size={15} /> {stats.failed.toLocaleString()} {stats.failed === 1 ? 'copy' : 'copies'} failed and will be retried automatically.</p>}
            {s.enabled && stats.waiting === 0 && stats.failed === 0 && stats.originals > 0 && <p className="backup-line is-good"><Icon name="check" size={15} /> Every original in the library has a backup copy.</p>}
            {stats.removing > 0 && <p className="backup-line"><Icon name="trash" size={15} /> Removing {stats.removing.toLocaleString()} {stats.removing === 1 ? 'copy' : 'copies'}.</p>}
          </div>
        )}
        {error && <p className="is-bad" role="alert">{error}</p>}
        {!manage && <p className="access-note">Only owners and admins can change this.</p>}
      </Card>

      {s.available && (
        <Card title="Restoring a file">
          <p className="access-note">
            If an original goes missing or is damaged, open the asset and choose <b>Restore original from backup</b> under Details. Trash keeps deleted media and its backup copy for 30 days.
          </p>
        </Card>
      )}

      {confirmOff && (
        <div className="dialog-scrim">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="backup-off">
            <h2 id="backup-off">Turn off backups?</h2>
            <p>The {stats.copied.toLocaleString()} backup {stats.copied === 1 ? 'copy' : 'copies'} ({bytes(stats.bytes)}) will be deleted within a few minutes. Your media itself isn’t affected.</p>
            {error && <p role="alert" className="is-bad">{error}</p>}
            <div className="dialog-foot">
              <button className="btn btn-ghost btn-sm" disabled={busy} autoFocus onClick={() => setConfirmOff(false)}>Keep backups</button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void set(false)}>{busy ? 'Turning off…' : 'Turn off and delete copies'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The Backup row in an asset's Details card. Hidden when the asset has no copy (backups off). */
export function AssetBackupRow({ assetId }: { assetId: string }) {
  const { workspace } = useAccount()
  const [b, setB] = useState<AssetBackup | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    request<AssetBackup>(`/api/assets/${assetId}/backup`).then((x) => live && setB(x)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [assetId])
  if (!b || b.status === 'none' || b.status === 'removing') return null
  const restore = async () => {
    setBusy(true)
    try {
      await request(`/api/assets/${assetId}/backup/restore`, { method: 'POST' })
      toast('Original restored from the backup copy')
    } catch (e) {
      toast(message(e, 'Could not restore the original.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <dt>Backup</dt>
      <dd>
        {b.status === 'copied' ? <>Copy saved {b.copiedAt ? ago(b.copiedAt).toLowerCase() : ''}</> : b.status === 'copying' ? 'Copying now' : 'Copy failed · retrying automatically'}
        {b.status === 'copied' && canManage(workspace.role) && (
          <button type="button" className="btn btn-quiet btn-sm backup-restore" disabled={busy} onClick={() => void restore()}>
            {busy ? 'Restoring…' : 'Restore original from backup'}
          </button>
        )}
      </dd>
    </div>
  )
}
