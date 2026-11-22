'use client'

import { useRef, useState, type FormEvent } from 'react'
import { Card } from '../../app/ui'
import { adminFetch, when } from '../kit'

export type CredentialStatus = { state: 'active'; version: number; actor: string; checkedAt: string;
  previousVersion: number; earliestRetirement: string | null } | { state: 'unconfigured' | 'unavailable' }

export default function StorageCredential({ workspace, status, connected, refresh }: {
  workspace: string; status: CredentialStatus; connected: boolean; refresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const submitting = useRef(false)
  const version = status.state === 'active' ? status.version : 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || status.state === 'unavailable') return
    const form = event.currentTarget
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'rotate' ? 'rotate' : 'verify'
    if (action === 'rotate' && verified !== version) return
    const values = new FormData(form)
    const token = values.get('sessionToken')
    submitting.current = true
    setBusy(true)
    setVerified(null)
    setMessage(action === 'verify' ? 'Checking upload, encoding and playback…' : 'Rechecking the credential and activating it…')
    try {
      const result = await adminFetch<{ version: number }>(`/api/admin/workspaces/${encodeURIComponent(workspace)}/storage-credential`, {
        method: 'POST', json: { action, version, key: { accessKeyId: values.get('accessKeyId'), secretAccessKey: values.get('secretAccessKey'),
          ...(token && { sessionToken: token }) } },
      })
      if (action === 'verify') {
        setVerified(version)
        setMessage('Upload, encoding and playback passed. You can activate this credential.')
      } else setMessage('Activated storage credential version ' + result.version + '.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check the active version before retrying.')
    } finally {
      if (action === 'rotate') form.reset()
      submitting.current = false
      setBusy(false)
      refresh()
    }
  }

  return <Card title="Storage credential" meta={status.state === 'active' ? 'Version ' + version : undefined}>
    {status.state === 'active' && <>
      <p>Last verified by {status.actor} on {when(status.checkedAt)}.</p>
      {status.earliestRetirement && <p>Keep version {status.previousVersion} valid through {when(status.earliestRetirement)} and until its outstanding uploads and links finish.</p>}
    </>}
    {status.state === 'unavailable' ? <p role="status">Credential status is unavailable. <button className="btn btn-ghost btn-sm" onClick={refresh}>Refresh status</button></p> : <>
      {status.state === 'unconfigured' && <p>This studio is waiting for its first credential.</p>}
      {connected ? <form onSubmit={submit} autoComplete="off" onChange={() => { setVerified(null); setMessage('') }}>
        <fieldset disabled={busy} className="stack">
          <legend>Replacement credential</legend>
          <label className="field-d"><span>Access key ID</span><input className="input" name="accessKeyId" required autoComplete="off" spellCheck={false} /></label>
          <label className="field-d"><span>Secret access key</span><input className="input" name="secretAccessKey" type="password" required autoComplete="new-password" /></label>
          <label className="field-d"><span>Session token (optional)</span><input className="input" name="sessionToken" type="password" autoComplete="new-password" /></label>
          <div className="aactions">
            <button className="btn btn-ghost btn-sm" type="submit" value="verify">Verify replacement</button>
            <button className="btn btn-primary btn-sm" type="submit" value="rotate" disabled={verified !== version}>Activate credential</button>
          </div>
        </fieldset>
      </form> : <p>The storage operator connection is not configured.</p>}
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </Card>
}
