'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ASSETS, PIPELINE, bytes } from '@/lib/sample'
import Icon from '../Icon'
import { Card, PageHead, StatusBadge, Thumb, copyText, toast } from '../ui'

type Item = { id: string; name: string; size: number; kind: 'video' | 'audio' | 'image'; up: number; stage: number; done: boolean }

const kindOf = (f: File): Item['kind'] => (f.type.startsWith('audio') ? 'audio' : f.type.startsWith('image') ? 'image' : 'video')

export default function Uploads() {
  const [items, setItems] = useState<Item[]>([])
  const [drag, setDrag] = useState(false)
  const [preset, setPreset] = useState('auto')
  const [captions, setCaptions] = useState(true)
  const [signed, setSigned] = useState(false)
  const [url, setUrl] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const inPipeline = ASSETS.filter((a) => a.status === 'processing' || a.status === 'queued')

  const add = (files: FileList | null) => {
    if (!files?.length) return
    const next = Array.from(files).map((f, i) => ({
      id: `${Date.now()}-${i}`,
      name: f.name,
      size: f.size,
      kind: kindOf(f),
      up: 0,
      stage: -1,
      done: false,
    }))
    setItems((xs) => [...next, ...xs])
    toast(`${next.length} file${next.length > 1 ? 's' : ''} added — preview only, nothing leaves your device`)
  }

  // simulate transfer, then the pipeline stages
  useEffect(() => {
    if (!items.some((x) => !x.done)) return
    const id = setInterval(() => {
      setItems((xs) =>
        xs.map((x) => {
          if (x.done) return x
          if (x.up < 100) return { ...x, up: Math.min(100, x.up + 4 + Math.random() * 9) }
          if (x.stage < PIPELINE.length - 1) return { ...x, stage: x.stage + 1 }
          return { ...x, done: true }
        }),
      )
    }, 450)
    return () => clearInterval(id)
  }, [items])

  return (
    <>
      <PageHead title="Uploads" sub="Drop files to ingest them. MediaEX encodes, captions and packages each one automatically." />

      <div className="grid-2">
        <div className="stack">
          <label
            className={`dropzone ${drag ? 'is-drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              add(e.dataTransfer.files)
            }}
          >
            <span className="vf-corner tl" aria-hidden="true" />
            <span className="vf-corner tr" aria-hidden="true" />
            <span className="vf-corner bl" aria-hidden="true" />
            <span className="vf-corner br" aria-hidden="true" />
            <input ref={input} type="file" multiple accept="video/*,audio/*,image/*,.mov,.mxf,.braw,.r3d" className="sr-only" onChange={(e) => add(e.target.files)} />
            <span className="drop-icon">
              <Icon name="upload" size={22} />
            </span>
            <b>{drag ? 'Drop to upload' : 'Drag files here, or browse'}</b>
            <p>Video, audio and images up to 5 TB each. ProRes, RAW, MXF, WAV, FLAC, HEIC and more.</p>
            <span className="btn btn-ghost btn-sm">Browse files</span>
          </label>

          {items.length > 0 && (
            <Card title="This session" meta={`${items.filter((x) => x.done).length} of ${items.length} ready`} flush>
              <ul className="rows">
                {items.map((x) => (
                  <li key={x.id}>
                    <span className="file-kind">
                      <Icon name={x.kind} size={16} />
                    </span>
                    <div className="grow">
                      <b>{x.name}</b>
                      <small>
                        {bytes(x.size)} · {x.done ? 'Ready to stream' : x.up < 100 ? `Uploading ${Math.round(x.up)}%` : `${PIPELINE[x.stage] ?? 'Starting'}…`}
                      </small>
                      <span className="meter">
                        <i style={{ width: `${x.done ? 100 : x.up < 100 ? x.up * 0.5 : 50 + ((x.stage + 1) / PIPELINE.length) * 50}%` }} />
                      </span>
                    </div>
                    {x.done ? <StatusBadge status="ready" /> : <StatusBadge status="processing" />}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Already in the pipeline"
            meta={`${inPipeline.length} assets`}
            flush
            action={
              <Link href="/dashboard/library" className="panel-link">
                Library <Icon name="arrowRight" size={14} />
              </Link>
            }
          >
            <ul className="rows">
              {inPipeline.map((a) => (
                <li key={a.id}>
                  <Link href={`/dashboard/library/${a.id}`} className="asset-cell">
                    <Thumb asset={a} />
                    <span>
                      <b>{a.title}</b>
                      <small>
                        {bytes(a.size)} · {a.status === 'queued' ? 'Waiting for an encoder' : `${PIPELINE[Math.floor((a.progress / 100) * PIPELINE.length)]}…`}
                      </small>
                    </span>
                  </Link>
                  <StatusBadge status={a.status} progress={a.progress} />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="stack">
          <Card title="Defaults for new uploads">
            <div className="form-stack">
              <label className="field-d">
                <span>Encoding ladder</span>
                <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  <option value="auto">Per-title (recommended)</option>
                  <option value="4k">Fixed: 2160p → 360p</option>
                  <option value="hd">Fixed: 1080p → 360p</option>
                  <option value="social">Social: vertical 1080×1920</option>
                </select>
                <small>{preset === 'auto' ? 'Analyses each asset and picks the smallest ladder that keeps quality.' : 'Every asset gets the same renditions.'}</small>
              </label>
              <label className="check">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
                <span>
                  Auto captions
                  <small>English, then translated to Spanish and Japanese.</small>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
                <span>
                  Require signed URLs
                  <small>Playback needs a token from your server.</small>
                </span>
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toast('Upload defaults saved for this session')}>
                Save defaults
              </button>
            </div>
          </Card>

          <Card title="Import from a URL">
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!/^https?:\/\/\S+\.\S+/.test(url.trim())) return toast('Enter a full http(s) URL to import')
                toast('URL imports need the backend — nothing was fetched')
                setUrl('')
              }}
            >
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or s3://bucket/key" aria-label="Media URL" />
              <button type="submit" className="btn btn-ghost btn-sm">
                Import
              </button>
            </form>
          </Card>

          <Card title="From the command line">
            <pre className="snippet">
              <code>
                <span className="cm"># install once</span>
                {'\n'}npm i -g @mediaex/cli{'\n\n'}
                <span className="cm"># upload a folder, keep watching it</span>
                {'\n'}mx upload ./footage --watch
              </code>
            </pre>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText('npm i -g @mediaex/cli && mx upload ./footage --watch', 'Command copied')}>
              <Icon name="copy" size={15} /> Copy
            </button>
          </Card>
        </div>
      </div>
    </>
  )
}
