'use client'

import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '@/lib/media/types'
import Icon from './Icon'
import { request } from './library'
import { useMedia } from './media'
import { Card, toast } from './ui'

// the languages people pick most; anything else can be typed as a code
const LANGS = [
  ['en', 'English'], ['fr', 'French'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['de', 'German'], ['it', 'Italian'], ['nl', 'Dutch'],
  ['ar', 'Arabic'], ['sw', 'Swahili'], ['yo', 'Yoruba'], ['ha', 'Hausa'], ['ig', 'Igbo'], ['zu', 'Zulu'], ['am', 'Amharic'],
  ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ru', 'Russian'], ['tr', 'Turkish'],
] as const

const STATUS: Record<string, string> = { queued: 'Waiting to transcribe', processing: 'Transcribing…', ready: 'Ready', failed: 'Failed' }

/** The asset page's Captions tab: tracks, automatic transcription, and uploading your own. */
export default function CaptionsPanel({ asset }: { asset: MediaAsset }) {
  const media = useMedia()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [hint, setHint] = useState('')
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const working = asset.captions.some((c) => c.status === 'queued' || c.status === 'processing')

  useEffect(() => {
    request<{ available: boolean }>(`/api/assets/${asset.id}/captions`)
      .then((r) => setAvailable(r.available))
      .catch(() => setAvailable(false))
  }, [asset.id])
  // a transcription doesn't make the asset "active", so watch it here
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => void media.refresh(), 3000)
    return () => clearInterval(t)
  }, [working, media])

  const generate = async () => {
    setBusy(true)
    try {
      await request(`/api/assets/${asset.id}/captions/generate`, { method: 'POST', json: hint ? { language: hint } : {} })
      await media.refresh()
      toast('Transcribing — captions appear here when they’re ready')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t start the transcription.')
    } finally {
      setBusy(false)
    }
  }
  const uploadFile = async (f: File) => {
    if (f.size > 2_000_000) return toast('Caption files can be up to 2 MB.')
    setBusy(true)
    try {
      await request(`/api/assets/${asset.id}/captions/${lang}`, { method: 'PUT', json: { text: await f.text() } })
      await media.refresh()
      toast('Captions added')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t add the captions.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (l: string) => {
    try {
      await request(`/api/assets/${asset.id}/captions/${l}`, { method: 'DELETE' })
      await media.refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete the track.')
    }
  }

  return (
    <div className="stack">
      <Card title="Caption tracks" meta={asset.captions.length ? `${asset.captions.length} ${asset.captions.length === 1 ? 'track' : 'tracks'}` : 'None yet'} flush>
        {asset.captions.length ? (
          <ul className="rows">
            {asset.captions.map((c) => (
              <li key={c.lang}>
                <span className="asset-cell">
                  <span className="cc-badge">{c.lang === 'auto' ? '…' : c.lang.toUpperCase()}</span>
                  <span>
                    <b>{c.label}</b>
                    <small className={c.status === 'failed' ? 'is-bad' : ''}>
                      {c.source === 'auto' ? 'Automatic' : 'Uploaded'} · {c.status === 'failed' && c.error ? c.error : STATUS[c.status]}
                    </small>
                  </span>
                </span>
                <span className="row-actions">
                  {c.url && (
                    <a className="btn btn-quiet btn-sm" href={c.url} download={`${asset.title}.${c.lang}.vtt`}>
                      <Icon name="file" size={14} /> .vtt
                    </a>
                  )}
                  {c.status !== 'processing' && (
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => void remove(c.lang)} aria-label={`Delete ${c.label} captions`}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-note cc-empty">No captions yet. Generate them from the audio, or upload a WebVTT or SRT file.</p>
        )}
      </Card>

      <div className="grid-2 even">
        <Card title="Generate from the audio" meta="OpenAI Whisper">
          {available === false ? (
            <p className="access-note">Automatic captions need an OpenAI key on the server (OPENAI_API_KEY). You can still upload your own.</p>
          ) : (
            <div className="access">
              <p className="access-note">The audio is sent to OpenAI to transcribe, in the language that’s spoken. It takes a minute or two for most videos.</p>
              <div className="copy-row">
                <select className="select" value={hint} onChange={(e) => setHint(e.target.value)} aria-label="Spoken language">
                  <option value="">Detect the language</option>
                  {LANGS.filter(([c]) => c !== 'ig' && c !== 'zu').map(([c, l]) => (
                    <option key={c} value={c}>
                      {l}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || working || available === null} onClick={generate}>
                  {working ? 'Transcribing…' : 'Generate captions'}
                </button>
              </div>
            </div>
          )}
        </Card>
        <Card title="Upload a file" meta="WebVTT or SRT">
          <div className="access">
            <p className="access-note">Add a track in any language. A file in a language that already has a track replaces it.</p>
            <div className="copy-row">
              <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Track language">
                {LANGS.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                ref={file}
                type="file"
                accept=".vtt,.srt,text/vtt"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadFile(f)
                  e.target.value = ''
                }}
              />
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => file.current?.click()}>
                <Icon name="upload" size={14} /> Choose file
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
