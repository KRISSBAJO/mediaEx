'use client'

/**
 * The workspace's media, shared by every dashboard page: the asset list (polled while anything is in the pipeline)
 * and the upload queue (kept here so uploads continue while you move between pages).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { guessType, isActive, type MediaAsset } from '@/lib/media/types'
import { toast } from './ui'

export type Transfer = {
  key: string
  assetId: string | null
  name: string
  size: number
  loaded: number
  state: 'waiting' | 'uploading' | 'done' | 'error' | 'cancelled'
  error?: string
  folderId: string | null
}

type Media = {
  assets: MediaAsset[]
  loaded: boolean
  refresh: () => Promise<void>
  get: (id: string) => MediaAsset | undefined
  /** replace or add one asset locally (after a PATCH, say) */
  put: (a: MediaAsset) => void
  remove: (id: string) => Promise<boolean>
  update: (id: string, patch: { title?: string; tags?: string[]; folderId?: string | null; metadata?: Record<string, unknown> }) => Promise<boolean>
  retry: (id: string) => Promise<boolean>
  transfers: Transfer[]
  upload: (files: FileList | File[], folderId?: string | null) => void
  cancel: (key: string) => void
  clearFinished: () => void
}

const Ctx = createContext<Media | null>(null)

export function useMedia() {
  const m = useContext(Ctx)
  if (!m) throw new Error('useMedia must be used inside <MediaProvider>')
  return m
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`)
  return body as T
}

const PARALLEL = 2

export function MediaProvider({ initial, children }: { initial: MediaAsset[]; children: React.ReactNode }) {
  const [assets, setAssets] = useState(initial)
  const [loaded, setLoaded] = useState(true)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const files = useRef(new Map<string, File>())
  const xhrs = useRef(new Map<string, XMLHttpRequest>())
  const started = useRef(new Set<string>())
  // the latest transfer list, for callbacks that run after an await
  const transfersRef = useRef(transfers)
  transfersRef.current = transfers

  const refresh = useCallback(async () => {
    try {
      const { assets } = await json<{ assets: MediaAsset[] }>(await fetch('/api/assets', { cache: 'no-store' }))
      setAssets(assets)
      setLoaded(true)
    } catch {
      /* keep what we have; the next poll tries again */
    }
  }, [])

  // poll quickly while something is moving through the pipeline, slowly otherwise
  const busy = assets.some(isActive) || transfers.some((t) => t.state === 'uploading' || t.state === 'waiting')
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, busy ? 1500 : 30000)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [busy, refresh])

  const put = useCallback((a: MediaAsset) => setAssets((xs) => (xs.some((x) => x.id === a.id) ? xs.map((x) => (x.id === a.id ? a : x)) : [a, ...xs])), [])

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) await json(res)
      setAssets((xs) => xs.filter((x) => x.id !== id))
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete the asset.')
      return false
    }
  }, [])

  const update = useCallback(
    async (id: string, patch: { title?: string; tags?: string[]; folderId?: string | null; metadata?: Record<string, unknown> }) => {
      try {
        const { asset } = await json<{ asset: MediaAsset }>(await fetch(`/api/assets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }))
        put(asset)
        return true
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Couldn’t save the change.')
        return false
      }
    },
    [put],
  )

  const retry = useCallback(
    async (id: string) => {
      try {
        const { asset } = await json<{ asset: MediaAsset }>(await fetch(`/api/assets/${id}/retry`, { method: 'POST' }))
        put(asset)
        return true
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Couldn’t restart the pipeline.')
        return false
      }
    },
    [put],
  )

  /* ------------------------------------------------ uploads */
  const patchT = (key: string, p: Partial<Transfer>) => setTransfers((ts) => ts.map((t) => (t.key === key ? { ...t, ...p } : t)))

  const send = useCallback(
    async (t: Transfer) => {
      const file = files.current.get(t.key)
      if (!file || started.current.has(t.key)) return
      started.current.add(t.key)
      patchT(t.key, { state: 'uploading', loaded: 0 })
      try {
        const { asset, upload } = await json<{ asset: MediaAsset; upload: { url: string; method: string; headers: Record<string, string> } }>(
          await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, size: file.size, mimeType: file.type || null, folderId: t.folderId }) }),
        )
        patchT(t.key, { assetId: asset.id })
        put(asset)

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhrs.current.set(t.key, xhr)
          xhr.open(upload.method, upload.url)
          for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v)
          if (file.type) xhr.setRequestHeader('Content-Type', file.type)
          xhr.upload.onprogress = (e) => patchT(t.key, { loaded: e.loaded })
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(safeError(xhr.responseText) || `Upload failed (${xhr.status})`)))
          xhr.onerror = () => reject(new Error('The connection dropped during the upload.'))
          xhr.onabort = () => reject(new Error('CANCELLED'))
          xhr.send(file)
        })
        xhrs.current.delete(t.key)

        const done = await json<{ asset: MediaAsset }>(await fetch(`/api/uploads/${asset.id}/complete`, { method: 'POST' }))
        put(done.asset)
        patchT(t.key, { state: 'done', loaded: file.size })
      } catch (e) {
        xhrs.current.delete(t.key)
        const cancelled = e instanceof Error && e.message === 'CANCELLED'
        patchT(t.key, { state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : e instanceof Error ? e.message : 'Upload failed.' })
        // don't leave a half-uploaded asset behind
        const id = transfersRef.current.find((x) => x.key === t.key)?.assetId
        if (id) void fetch(`/api/assets/${id}`, { method: 'DELETE' }).then(() => setAssets((xs) => xs.filter((x) => x.id !== id)))
      } finally {
        files.current.delete(t.key)
      }
    },
    [put],
  )

  // start waiting transfers, a couple at a time
  useEffect(() => {
    const running = transfers.filter((t) => t.state === 'uploading').length
    const next = transfers.filter((t) => t.state === 'waiting').slice(0, Math.max(0, PARALLEL - running))
    next.forEach((t) => void send(t))
  }, [transfers, send])

  // warn before closing the tab mid-upload
  const uploading = transfers.some((t) => t.state === 'uploading' || t.state === 'waiting')
  useEffect(() => {
    if (!uploading) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])

  const upload = useCallback((list: FileList | File[], folderId: string | null = null) => {
    const arr = Array.from(list)
    const ok = arr.filter((f) => guessType(f.name, f.type))
    const skipped = arr.length - ok.length
    if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped — only video, audio and images are supported`)
    if (!ok.length) return
    const added = ok.map((f, i) => {
      const key = `${Date.now()}-${i}-${f.name}`
      files.current.set(key, f)
      return { key, assetId: null, name: f.name, size: f.size, loaded: 0, state: 'waiting' as const, folderId }
    })
    setTransfers((ts) => [...added, ...ts])
  }, [])

  const cancel = useCallback((key: string) => {
    const xhr = xhrs.current.get(key)
    if (xhr) xhr.abort()
    else {
      files.current.delete(key)
      setTransfers((ts) => ts.map((t) => (t.key === key && t.state === 'waiting' ? { ...t, state: 'cancelled' } : t)))
    }
  }, [])

  const clearFinished = useCallback(() => setTransfers((ts) => ts.filter((t) => t.state === 'uploading' || t.state === 'waiting')), [])

  const value = useMemo<Media>(
    () => ({ assets, loaded, refresh, get: (id) => assets.find((a) => a.id === id), put, remove, update, retry, transfers, upload, cancel, clearFinished }),
    [assets, loaded, refresh, put, remove, update, retry, transfers, upload, cancel, clearFinished],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function safeError(text: string) {
  try {
    return (JSON.parse(text) as { error?: string }).error
  } catch {
    return null
  }
}

/* ------------------------------------------------ formatting helpers for media */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'Just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Relative time that renders the same on server and client, then updates once mounted. */
export function Ago({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])
  const label = now === null ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ago(iso, now)
  return <time dateTime={iso}>{label}</time>
}

export function dims(a: Pick<MediaAsset, 'width' | 'height' | 'type'>) {
  return a.width && a.height ? `${a.width} × ${a.height}` : a.type === 'audio' ? 'Audio' : '—'
}
