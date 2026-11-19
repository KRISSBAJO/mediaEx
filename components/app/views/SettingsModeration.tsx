'use client'

import { useEffect, useState } from 'react'
import type { ModerationMode, ModerationSettings } from '@/lib/media/types'
import { canManage, useAccount } from '../account'
import Icon from '../Icon'
import { request } from '../library'
import { Card, toast } from '../ui'

const MODES: { value: ModerationMode; title: string; text: string }[] = [
  { value: 'off', title: 'Off', text: 'Uploads are public by link as soon as they’re ready.' },
  { value: 'flagged', title: 'Auto-approve unless flagged', text: 'Uploads go public on their own; anything a check flags waits for a person.' },
  { value: 'all', title: 'Review every upload', text: 'Nothing goes public until someone approves it. Checks still run, as hints.' },
]

export default function SettingsModeration() {
  const { workspace } = useAccount()
  const manage = canManage(workspace.role)
  const [s, setS] = useState<ModerationSettings | null>(null)
  const [mode, setMode] = useState<ModerationMode>('off')
  const [words, setWords] = useState('')
  const [ai, setAi] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    request<ModerationSettings>('/api/moderation/settings')
      .then((x) => {
        setS(x)
        setMode(x.mode)
        setWords(x.blocklist.join('\n'))
        setAi(x.aiReview)
      })
      .catch((e) => toast(e instanceof Error ? e.message : 'Couldn’t load moderation settings.'))
  }, [])

  const list = words
    .split(/\n|,/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  const dirty = s && (mode !== s.mode || ai !== s.aiReview || list.join('|') !== s.blocklist.join('|'))

  const save = async () => {
    setBusy(true)
    try {
      const next = await request<ModerationSettings>('/api/moderation/settings', { method: 'PUT', json: { mode, blocklist: list, aiReview: ai } })
      setS(next)
      setWords(next.blocklist.join('\n'))
      toast('Moderation settings saved')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save.')
    } finally {
      setBusy(false)
    }
  }

  if (!s) return <p className="quiet-note">Loading…</p>

  return (
    <div className="stack">
      <Card
        title="Moderation"
        hint={manage ? 'Applies to new uploads. Assets already public stay public.' : 'Only owners and admins can change this.'}
        footer={
          manage ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          ) : undefined
        }
      >
        <p className="setting-desc">Hold new uploads for review before anyone outside the workspace can watch them. Members always see everything.</p>
        <div className="mod-modes" role="radiogroup" aria-label="Moderation mode">
          {MODES.map((m) => (
            <label key={m.value} className={`mod-mode ${mode === m.value ? 'is-on' : ''}`}>
              <input type="radio" name="mode" value={m.value} checked={mode === m.value} disabled={!manage} onChange={() => setMode(m.value)} />
              <span>
                <b>{m.title}</b>
                <small>{m.text}</small>
              </span>
            </label>
          ))}
        </div>

        <h3 className="mod-sub">Checks</h3>
        <p className="setting-desc">They run when an upload finishes processing.</p>
        <label className="setting-field mod-words">
          <span>Blocked words</span>
          <textarea className="textarea" rows={4} disabled={!manage} placeholder={'One per line\nembargo\nconfidential'} value={words} onChange={(e) => setWords(e.target.value)} />
          <small>Matched as whole words in the title, file name, tags and custom fields — “secret” doesn’t catch “secretary”.</small>
        </label>
        <label className={`check mod-ai ${s.aiAvailable ? '' : 'is-off'}`}>
          <input type="checkbox" checked={ai} disabled={!manage || !s.aiAvailable} onChange={(e) => setAi(e.target.checked)} />
          <span>
            Automatic image review
            <small>
              {s.aiAvailable
                ? 'Claude looks at each image (or three frames of each video) for nudity, violence, hate symbols and similar, and flags what a person should check. If it can’t decide, the upload waits for a person.'
                : 'Needs Claude credentials on the server: set ANTHROPIC_API_KEY on the API service, then turn this on.'}
            </small>
          </span>
        </label>
        {!s.aiAvailable && (
          <p className="mod-hint">
            <Icon name="key" size={14} /> Not configured on this server.
          </p>
        )}
      </Card>
    </div>
  )
}
