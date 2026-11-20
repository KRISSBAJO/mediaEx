'use client'

/**
 * Build a transformation URL visually: size, crop, format, quality, effects, watermark. The preview renders through
 * Members can preview a transformation before approving it for delivery.
 */
import { useEffect, useMemo, useState } from 'react'
import type { MediaAsset } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import Icon from './Icon'
import { useMedia } from './media'
import { Card, copyText, toast } from './ui'
import { createSignedLink, type SignedLink } from './ShareLink'

type State = {
  w: string
  h: string
  dpr: '1' | '2' | '3'
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  pos: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'attention' | 'entropy'
  f: 'auto' | 'webp' | 'avif' | 'jpeg' | 'png'
  q: number
  t: number
  gray: boolean
  blur: number
  rot: '0' | '90' | '180' | '270'
  flip: '' | 'h' | 'v'
  wmKind: 'none' | 'image' | 'text'
  wm: string
  wmText: string
  wmPos: 'nw' | 'n' | 'ne' | 'w' | 'c' | 'e' | 'sw' | 's' | 'se'
  wmW: number
  wmO: number
}

const PRESETS: { label: string; set: Partial<State> }[] = [
  { label: 'Thumbnail', set: { w: '320', h: '180', fit: 'cover', pos: 'attention' } },
  { label: 'Square', set: { w: '1080', h: '1080', fit: 'cover', pos: 'attention' } },
  { label: 'Open Graph', set: { w: '1200', h: '630', fit: 'cover', pos: 'attention' } },
  { label: 'Story', set: { w: '1080', h: '1920', fit: 'cover', pos: 'attention' } },
  { label: 'Original size', set: { w: '', h: '', fit: 'inside' } },
]

const START: State = {
  w: '800',
  h: '',
  dpr: '1',
  fit: 'inside',
  pos: 'center',
  f: 'auto',
  q: 80,
  t: 0,
  gray: false,
  blur: 0,
  rot: '0',
  flip: '',
  wmKind: 'none',
  wm: '',
  wmText: '',
  wmPos: 'se',
  wmW: 20,
  wmO: 70,
}

function toParams(s: State, video: boolean) {
  const p = new URLSearchParams()
  if (s.w) p.set('w', s.w)
  if (s.h) p.set('h', s.h)
  if (s.dpr !== '1') p.set('dpr', s.dpr)
  if (s.w && s.h && s.fit !== 'cover') p.set('fit', s.fit)
  if (!(s.w && s.h) && s.fit !== 'inside') p.set('fit', s.fit)
  if (s.pos !== 'center' && (s.fit === 'cover' || s.fit === 'contain')) p.set('pos', s.pos)
  if (s.f !== 'auto') p.set('f', s.f)
  if (s.q !== 80 && s.f !== 'png') p.set('q', String(s.q))
  if (video && s.t > 0) p.set('t', s.t.toFixed(1))
  if (s.gray) p.set('gray', '1')
  if (s.blur) p.set('blur', String(s.blur))
  if (s.rot !== '0') p.set('rot', s.rot)
  if (s.flip) p.set('flip', s.flip)
  if (s.wmKind === 'image' && s.wm) p.set('wm', s.wm)
  if (s.wmKind === 'text' && s.wmText.trim()) p.set('wm_text', s.wmText.trim())
  if (s.wmKind !== 'none' && (s.wm || s.wmText.trim())) {
    if (s.wmPos !== 'se') p.set('wm_pos', s.wmPos)
    if (s.wmW !== 20) p.set('wm_w', (s.wmW / 100).toFixed(2))
    if (s.wmO !== 70) p.set('wm_o', (s.wmO / 100).toFixed(2))
  }
  return p
}

function htmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function TransformBuilder({ asset, link, onIssue }: {
  asset: MediaAsset
  link: SignedLink | null
  onIssue: (link: SignedLink) => void
}) {
  const { assets } = useMedia()
  const video = asset.type === 'video'
  const [s, setS] = useState<State>(() => ({ ...START, t: video ? Math.min(3, Math.round(asset.duration * 10) / 100) : 0 }))
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }))
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  const params = useMemo(() => toParams(s, video), [s, video])
  const base = `/api/media/${asset.id}/transform`
  const [issuing, setIssuing] = useState(false)
  const [, setClock] = useState(0)
  useEffect(() => {
    if (!link) return
    const ms = Date.parse(link.expiresAt) - Date.now()
    if (ms <= 0) return
    const timer = window.setTimeout(() => setClock(x => x + 1), ms + 1)
    return () => window.clearTimeout(timer)
  }, [link])
  const signed = asset.playback === 'signed'
  const watermark = s.wmKind === 'image' && s.wm ? assets.find(item => item.id === s.wm) : undefined
  const privateWatermark = Boolean(s.wmKind === 'image' && s.wm && (watermark?.playback !== 'public' || watermark.moderation !== 'approved' || watermark.takenDown))
  const approved = asset.status === 'ready' && asset.moderation === 'approved' && !asset.takenDown && !privateWatermark
  const token = signed && link && Date.parse(link.expiresAt) > Date.now() ? new URL(link.embedUrl, origin || 'https://localhost').searchParams.get('token') : null
  const canCopy = Boolean(origin && approved && (!signed || token))
  const delivery = new URLSearchParams(params)
  if (token) delivery.set('token', token)
  const qs = delivery.toString()
  const deliveryUrl = `${origin}${base}${qs ? `?${qs}` : ''}`
  async function issueLink() {
    setIssuing(true)
    try {
      onIssue(await createSignedLink(asset.id))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create a signed link.')
    } finally {
      setIssuing(false)
    }
  }

  // preview: debounced, uncached, sized for the panel
  const [shown, setShown] = useState<{ src: string; size: number; type: string; ms: number } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    let url = ''
    const id = setTimeout(async () => {
      setBusy(true)
      const t0 = performance.now()
      try {
        const p = new URLSearchParams(params)
        p.set('preview', '1')
        // send what an <img> would, so "Auto" picks the same format the page will get
        const res = await fetch(`${base}?${p}`, { cache: 'no-store', headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } })
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Preview failed (${res.status})`)
        const blob = await res.blob()
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setShown((old) => {
          if (old) URL.revokeObjectURL(old.src)
          return { src: url, size: blob.size, type: blob.type.replace('image/', '').toUpperCase(), ms: Math.round(performance.now() - t0) }
        })
        setErr('')
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Preview failed.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [base, params])

  const images = assets.filter((a) => a.type === 'image' && a.status === 'ready' && a.id !== asset.id)
  const w2 = s.w ? new URLSearchParams(delivery) : null
  if (w2) w2.set('dpr', '2')
  const snippet = `<img src="${htmlAttribute(deliveryUrl)}"${w2 ? `\n     srcset="${htmlAttribute(`${origin}${base}?${w2}`)} 2x"` : ''}${s.w ? ` width="${s.w}"` : ''}${s.h ? ` height="${s.h}"` : ''}\n     alt="${htmlAttribute(asset.title)}" loading="lazy">`

  return (
    <div className="tx">
      <div className="tx-controls">
        <Card title="Size and crop">
          <div className="tx-presets">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="fchip" onClick={() => set(p.set)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="tx-row">
            <label className="field-d">
              <span>Width</span>
              <input className="input" inputMode="numeric" placeholder="auto" value={s.w} onChange={(e) => set({ w: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </label>
            <label className="field-d">
              <span>Height</span>
              <input className="input" inputMode="numeric" placeholder="auto" value={s.h} onChange={(e) => set({ h: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </label>
            <label className="field-d">
              <span>Density</span>
              <select className="select" value={s.dpr} onChange={(e) => set({ dpr: e.target.value as State['dpr'] })}>
                <option value="1">1×</option>
                <option value="2">2× (retina)</option>
                <option value="3">3×</option>
              </select>
            </label>
          </div>
          <div className="tx-row">
            <label className="field-d">
              <span>Fit</span>
              <select className="select" value={s.fit} onChange={(e) => set({ fit: e.target.value as State['fit'] })}>
                <option value="cover">Cover — fill the box, crop the rest</option>
                <option value="contain">Contain — fit inside, letterbox</option>
                <option value="inside">Inside — fit inside, no padding</option>
                <option value="outside">Outside — cover, no crop</option>
                <option value="fill">Fill — stretch</option>
              </select>
            </label>
            <label className="field-d">
              <span>Focus</span>
              <select className="select" value={s.pos} disabled={s.fit !== 'cover' && s.fit !== 'contain'} onChange={(e) => set({ pos: e.target.value as State['pos'] })}>
                <option value="center">Centre</option>
                <option value="attention">Smart — what stands out</option>
                <option value="entropy">Smart — most detail</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
          {video && (
            <label className="field-d">
              <span>
                Frame at <b className="tx-val">{s.t.toFixed(1)} s</b>
              </span>
              <input type="range" min={0} max={Math.max(0.1, Math.floor(asset.duration * 10) / 10)} step={0.1} value={s.t} onChange={(e) => set({ t: Number(e.target.value) })} />
            </label>
          )}
        </Card>

        <Card title="Format and effects">
          <div className="tx-row">
            <label className="field-d">
              <span>Format</span>
              <select className="select" value={s.f} onChange={(e) => set({ f: e.target.value as State['f'] })}>
                <option value="auto">Auto — AVIF or WebP when supported</option>
                <option value="avif">AVIF</option>
                <option value="webp">WebP</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <label className="field-d">
              <span>
                Quality <b className="tx-val">{s.f === 'png' ? 'lossless' : s.q}</b>
              </span>
              <input type="range" min={20} max={100} value={s.q} disabled={s.f === 'png'} onChange={(e) => set({ q: Number(e.target.value) })} />
            </label>
          </div>
          <div className="tx-row">
            <label className="field-d">
              <span>
                Blur <b className="tx-val">{s.blur || 'off'}</b>
              </span>
              <input type="range" min={0} max={40} value={s.blur} onChange={(e) => set({ blur: Number(e.target.value) })} />
            </label>
            <label className="field-d">
              <span>Rotate</span>
              <select className="select" value={s.rot} onChange={(e) => set({ rot: e.target.value as State['rot'] })}>
                <option value="0">None</option>
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </label>
            <label className="field-d">
              <span>Flip</span>
              <select className="select" value={s.flip} onChange={(e) => set({ flip: e.target.value as State['flip'] })}>
                <option value="">None</option>
                <option value="h">Horizontal</option>
                <option value="v">Vertical</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.gray} onChange={(e) => set({ gray: e.target.checked })} />
            <span>Black and white</span>
          </label>
        </Card>

        <Card title="Watermark">
          <div className="seg tx-seg" role="group" aria-label="Watermark">
            {(['none', 'image', 'text'] as const).map((k) => (
              <button key={k} type="button" className={s.wmKind === k ? 'is-on' : ''} aria-pressed={s.wmKind === k} onClick={() => set({ wmKind: k })}>
                {k === 'none' ? 'None' : k === 'image' ? 'Logo' : 'Text'}
              </button>
            ))}
          </div>
          {s.wmKind === 'image' && (
            <label className="field-d">
              <span>Logo image</span>
              <select className="select" value={s.wm} onChange={(e) => set({ wm: e.target.value })}>
                <option value="">Choose an image from this workspace…</option>
                {images.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
              <small>Transparent PNGs work best. Upload one like any other image.</small>
            </label>
          )}
          {s.wmKind === 'text' && (
            <label className="field-d">
              <span>Text</span>
              <input className="input" maxLength={60} placeholder="© Your studio" value={s.wmText} onChange={(e) => set({ wmText: e.target.value })} />
            </label>
          )}
          {s.wmKind !== 'none' && (
            <div className="tx-row tx-wm">
              <div className="field-d">
                <span>Position</span>
                <div className="tx-grid" role="radiogroup" aria-label="Watermark position">
                  {(['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'] as const).map((g) => (
                    <button key={g} type="button" role="radio" aria-checked={s.wmPos === g} aria-label={g} className={s.wmPos === g ? 'is-on' : ''} onClick={() => set({ wmPos: g })} />
                  ))}
                </div>
              </div>
              <div className="tx-sliders">
                <label className="field-d">
                  <span>
                    Size <b className="tx-val">{s.wmW}%</b>
                  </span>
                  <input type="range" min={5} max={100} value={s.wmW} onChange={(e) => set({ wmW: Number(e.target.value) })} />
                </label>
                <label className="field-d">
                  <span>
                    Opacity <b className="tx-val">{s.wmO}%</b>
                  </span>
                  <input type="range" min={0} max={100} value={s.wmO} onChange={(e) => set({ wmO: Number(e.target.value) })} />
                </label>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="tx-out">
        <Card title="Preview" meta={shown ? `${shown.type} · ${bytes(shown.size)} · ${shown.ms} ms` : busy ? 'Rendering…' : undefined} action={busy ? <span className="player-spinner tx-spin" aria-label="Rendering" /> : undefined}>
          <div className="tx-stage">
            {err ? (
              <p className="tx-err" role="alert">
                <Icon name="alert" size={15} /> {err}
              </p>
            ) : shown ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob of the rendered preview
              <img src={shown.src} alt={`Preview of ${asset.title}`} />
            ) : (
              <span className="player-spinner" aria-hidden="true" />
            )}
          </div>
        </Card>
        {privateWatermark && <p className="muted">Only workspace members can see this watermark. Choose a public, approved watermark to share the transformation.</p>}
        {approved && signed && !canCopy && (
          <Card title="Signed transformation URL">
            <button type="button" className="btn btn-primary btn-sm" disabled={issuing} onClick={issueLink}>
              {issuing ? 'Creating…' : 'Create 24-hour link'}
            </button>
          </Card>
        )}
        {canCopy && <>
        <Card
          title="URL"
          meta={signed && link ? `Expires ${new Date(link.expiresAt).toLocaleString()}` : 'Public, cached after the first request'}
          action={
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(deliveryUrl, 'Transformation URL copied')}>
              <Icon name="copy" size={14} /> Copy
            </button>
          }
        >
          <code className="tx-url">{deliveryUrl}</code>
        </Card>
        <Card
          title="HTML"
          meta={s.w ? 'With a 2× version for sharp screens' : undefined}
          action={
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(snippet, 'Snippet copied')}>
              <Icon name="copy" size={14} /> Copy
            </button>
          }
        >
          <pre className="snippet">
            <code>{snippet}</code>
          </pre>
        </Card>
        </>}
      </div>
    </div>
  )
}
