'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { EncodingSettings, ExtraCodec } from '@/lib/media/types'
import { canManage, useAccount } from '../account'
import { request } from '../library'
import { Card, LoadFailed, toast } from '../ui'

const CODECS: { value: ExtraCodec; title: string; text: string }[] = [
  {
    value: 'hevc',
    title: 'HEVC (H.265)',
    text: 'About a third smaller than H.264 at the same quality. Plays on Apple devices, most smart TVs, and Chrome and Edge on hardware that decodes it.',
  },
  {
    value: 'av1',
    title: 'AV1',
    text: 'About half the size of H.264. Plays in Chrome, Firefox and Edge, Android, and newer Apple and TV hardware. The slowest to encode.',
  },
]

/** Settings → Encoding: which codecs every new video gets on top of H.264. */
export default function SettingsEncoding() {
  const { workspace } = useAccount()
  const manage = canManage(workspace.role)
  // HEVC and AV1 come with the paid plans (backend/media/billing.mts)
  const paidPlan = workspace.plan.id !== 'creator'
  const [s, setS] = useState<EncodingSettings | null>(null)
  const [pick, setPick] = useState<ExtraCodec[]>([])
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    request<EncodingSettings>('/api/encoding')
      .then((x) => {
        setS(x)
        setPick(x.extraCodecs)
        setAuto(x.autoCaptions)
      })
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Couldn’t load encoding settings.'))
  }, [])

  if (failed) return <LoadFailed what="encoding settings" detail={failed} />
  if (!s) return <p className="quiet-note">Loading…</p>
  const dirty = [...pick].sort().join() !== [...s.extraCodecs].sort().join() || auto !== s.autoCaptions

  const save = async () => {
    setBusy(true)
    try {
      const next = await request<EncodingSettings>('/api/encoding', { method: 'PUT', json: { extraCodecs: pick, autoCaptions: auto } })
      setS(next)
      setPick(next.extraCodecs)
      setAuto(next.autoCaptions)
      toast('Encoding settings saved — new uploads use them')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <Card
        title="Codecs"
        meta="H.264 is always made"
        action={
          manage ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          ) : undefined
        }
      >
        <p className="access-note">
          Every video gets an H.264 ladder, which plays everywhere. Add newer codecs and the MediaEX player picks the smallest one each viewer’s device can play, so they use less
          data for the same picture. Encoding takes longer, and the extra ladders count towards storage. Applies to new uploads; re-run the pipeline on older videos to add them.
        </p>
        <div className="codec-list">
          {CODECS.map((c) => {
            const can = s.available[c.value]
            return (
              <label key={c.value} className={`codec-opt ${can ? '' : 'is-off'}`}>
                <input
                  type="checkbox"
                  disabled={!manage || !can || (!paidPlan && !pick.includes(c.value))}
                  checked={pick.includes(c.value)}
                  onChange={(e) => setPick((p) => (e.target.checked ? [...p, c.value] : p.filter((x) => x !== c.value)))}
                />
                <span>
                  <b>{c.title}</b>
                  <small>{can ? c.text : 'This server’s FFmpeg can’t encode it.'}</small>
                  {can && !paidPlan && <small className="codec-plan">Comes with Pro and Studio.</small>}
                </span>
              </label>
            )
          })}
        </div>
        {!manage && <p className="access-note">Only owners and admins can change this.</p>}
        {!paidPlan && (
          <p className="access-note">
            HEVC and AV1 are part of Pro and Studio. <Link href="/dashboard/settings?tab=billing">See plans</Link>
          </p>
        )}
      </Card>
      <Card title="Captions" meta="OpenAI Whisper">
        <label className={`codec-opt ${s.captionsAvailable ? '' : 'is-off'}`}>
          <input type="checkbox" disabled={!manage || !s.captionsAvailable} checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>
            <b>Caption new uploads automatically</b>
            <small>
              {s.captionsAvailable
                ? 'Each new video and audio file is transcribed in the language that’s spoken, once it’s ready to stream. The audio is sent to OpenAI to do this. Save to apply.'
                : 'Needs an OpenAI key on the server (OPENAI_API_KEY). You can still upload caption files on any asset.'}
            </small>
          </span>
        </label>
      </Card>
      <Card title="Encoders" meta={s.hardware ? 'GPU' : 'CPU'}>
        <p className="access-note">
          {s.hardware
            ? `This server encodes on the GPU (${s.hardware === 'nvenc' ? 'NVIDIA NVENC' : 'Intel Quick Sync'}), and falls back to the CPU for anything the GPU can’t do.`
            : 'This server encodes on the CPU. Set MEDIA_HW_ENCODER=nvenc or qsv on a server with a supported GPU to encode there instead.'}
          {s.available.av1 && s.av1Encoder ? ` AV1 uses ${s.av1Encoder}.` : ''}
        </p>
      </Card>
    </div>
  )
}
