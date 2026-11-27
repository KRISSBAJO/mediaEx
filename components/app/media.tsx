'use client'

/**
 * The workspace's media, shared by every dashboard page: the asset list (polled while anything is in the pipeline)
 * and the upload queue (kept here so uploads continue while you move between pages).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { guessType, isActive, type MediaAsset, type WorkspaceAssetSummary } from '@/lib/media/types'
import { lookupResume, waitForUploadRetry } from '@/lib/media/upload-resume'
import { useAccount } from './account'
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
  presetId: string | null
  /** sent in parts: survives dropped connections, and can be resumed by adding the same file again */
  resumable?: boolean
  /** picked up where an earlier, interrupted upload stopped */
  resumed?: boolean
}

type Media = {
  assets: MediaAsset[]
  summary: WorkspaceAssetSummary
  loaded: boolean
  refresh: () => Promise<void>
  get: (id: string) => MediaAsset | undefined
  /** replace or add one asset locally (after a PATCH, say) */
  put: (a: MediaAsset) => void
  remove: (id: string) => Promise<boolean>
  update: (id: string, patch: { title?: string; tags?: string[]; folderId?: string | null; metadata?: Record<string, unknown>; playback?: 'public' | 'signed' }) => Promise<boolean>
  retry: (id: string) => Promise<boolean>
  transfers: Transfer[]
  upload: (files: FileList | File[], folderId?: string | null, presetId?: string | null) => void
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
/** files from this size go up in parts (the server also splits smaller files that travel through the app) */
const MULTIPART_FROM = 64 * 1024 ** 2
const PART_PARALLEL = 4
const PART_TRIES = 6

type Target = { url: string; method: string; headers: Record<string, string> }
type SingleUpload = Target & { kind?: 'single' }
type MultipartUpload = { kind: 'multipart'; partSize: number; partCount: number; parts: string }

/* where interrupted multipart uploads can be picked up again: file fingerprint → asset */
const RESUME_KEY = 'mx-resume'
const fingerprint = (f: File) => `${f.name}:${f.size}:${f.lastModified}`
function readResumes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}')
  } catch {
    return {}
  }
}
function writeResume(fp: string, assetId: string | null) {
  try {
    const all = readResumes()
    if (assetId) all[fp] = assetId
    else delete all[fp]
    localStorage.setItem(RESUME_KEY, JSON.stringify(all))
  } catch {
    /* private mode: resuming just won't be offered */
  }
}

/** PUT a blob with progress. Rejects with Error('CANCELLED') when aborted. */
function putBlob(t: Target, blob: Blob, type: string, onProgress: (n: number) => void, track: (x: XMLHttpRequest | null) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    track(xhr)
    xhr.open(t.method, t.url)
    for (const [k, v] of Object.entries(t.headers)) xhr.setRequestHeader(k, v)
    if (type) xhr.setRequestHeader('Content-Type', type)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    const done = () => track(null)
    xhr.onload = () => (done(), xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error(safeError(xhr.responseText) || `Upload failed (${xhr.status})`), { status: xhr.status })))
    xhr.onerror = () => (done(), reject(new Error('The connection dropped during the upload.')))
    xhr.onabort = () => (done(), reject(new Error('CANCELLED')))
    xhr.send(blob)
  })
}

export function MediaProvider({ initial, initialSummary, children }: { initial: MediaAsset[]; initialSummary: WorkspaceAssetSummary; children: React.ReactNode }) {
  const { workspace } = useAccount()
  const [assets, setAssets] = useState(initial)
  const [summary, setSummary] = useState(initialSummary)
  const [loaded, setLoaded] = useState(true)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const files = useRef(new Map<string, File>())
  // every request in flight per transfer, so cancelling stops all of a multipart upload's parts
  const xhrs = useRef(new Map<string, Set<XMLHttpRequest>>())
  const controllers = useRef(new Map<string, AbortController>())
  const started = useRef(new Set<string>())
  // the latest transfer list, for callbacks that run after an await
  const transfersRef = useRef(transfers)
  transfersRef.current = transfers

  const latestRefresh = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++latestRefresh.current
    try {
      const { assets, summary } = await json<{ assets: MediaAsset[]; summary: WorkspaceAssetSummary }>(await fetch('/api/assets?view=recent', { cache: 'no-store' }))
      if (request !== latestRefresh.current) return
      setAssets(assets)
      setSummary(summary)
      setLoaded(true)
    } catch {
      /* keep what we have; the next poll tries again */
    }
  }, [])

  // poll quickly while something is moving through the pipeline, slowly otherwise
  const busy = summary.active > 0 || assets.some(isActive) || transfers.some((t) => t.state === 'uploading' || t.state === 'waiting')
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
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t delete the asset.')
      return false
    }
  }, [refresh])

  const update = useCallback(
    async (id: string, patch: { title?: string; tags?: string[]; folderId?: string | null; metadata?: Record<string, unknown>; playback?: 'public' | 'signed' }) => {
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

  const track = (key: string) => {
    let current: XMLHttpRequest | null = null
    return (x: XMLHttpRequest | null) => {
      const set = xhrs.current.get(key) ?? new Set()
      xhrs.current.set(key, set)
      if (x) set.add((current = x))
      else if (current) set.delete(current)
    }
  }

  /** sends a file's parts (skipping the ones already there), retrying each one, a few at a time */
  const sendParts = async (key: string, file: File, controller: AbortController, plan: MultipartUpload, have: Set<number>) => {
    const sizeOf = (n: number) => (n < plan.partCount ? plan.partSize : file.size - plan.partSize * (plan.partCount - 1))
    let done = [...have].reduce((t, n) => t + sizeOf(n), 0)
    const inFlight = new Map<number, number>()
    const report = () => patchT(key, { loaded: done + [...inFlight.values()].reduce((t, n) => t + n, 0) })
    report()
    const todo = Array.from({ length: plan.partCount }, (_, i) => i + 1).filter((n) => !have.has(n))
    const targets = new Map<number, Target>()
    const fetchTargets = async (numbers: number[]) => {
      const { parts } = await json<{ parts: (Target & { number: number })[] }>(
        await fetch(plan.parts, { signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers }) }),
      )
      for (const t of parts) targets.set(t.number, t)
    }
    const one = async (n: number) => {
      for (let attempt = 1; ; attempt++) {
        controller.signal.throwIfAborted()
        try {
          if (!targets.has(n)) await fetchTargets(todo.filter((x) => !targets.has(x) && x >= n).slice(0, 50))
          controller.signal.throwIfAborted()
          const start = (n - 1) * plan.partSize
          await putBlob(targets.get(n)!, file.slice(start, start + sizeOf(n)), '', (l) => (inFlight.set(n, l), report()), track(key))
          inFlight.delete(n)
          done += sizeOf(n)
          report()
          return
        } catch (e) {
          inFlight.delete(n)
          controller.signal.throwIfAborted()
          if (e instanceof Error && e.message === 'CANCELLED') throw e
          if (attempt >= PART_TRIES) throw e
          targets.delete(n) // a signed URL may have expired: ask for a fresh one
          await waitForUploadRetry(controller.signal, Math.min(15000, 1000 * 2 ** (attempt - 1)), window, () => navigator.onLine)
        }
      }
    }
    const queue = [...todo]
    try {
      await Promise.all(
        Array.from({ length: Math.min(PART_PARALLEL, queue.length) }, async () => {
          for (let n = queue.shift(); n !== undefined; n = queue.shift()) await one(n)
        }),
      )
    } catch (e) {
      controller.abort(e)
      xhrs.current.get(key)?.forEach((x) => x.abort())
      throw e
    }
  }

  const send = useCallback(
    async (t: Transfer) => {
      const file = files.current.get(t.key)
      if (!file || started.current.has(t.key)) return
      started.current.add(t.key)
      const controller = new AbortController()
      controllers.current.set(t.key, controller)
      patchT(t.key, { state: 'uploading', loaded: 0 })
      const fp = JSON.stringify([workspace.id, t.presetId, t.folderId, fingerprint(file)])
      const big = file.size >= MULTIPART_FROM
      let assetId: string | null = null
      let multipart = false
      try {
        // an earlier upload of this same file that stopped part-way: carry on from where it got to
        // (the server may send smaller files in parts too, so any size can have one)
        const earlier = readResumes()[fp]
        multipart = Boolean(earlier) // keep the saved session if lookup fails
        const resumed = earlier ? await lookupResume(earlier, file.size) : null
        if (resumed?.kind === 'completed') {
          writeResume(fp, null)
          put(resumed.asset)
          patchT(t.key, { assetId: earlier, state: 'done', loaded: file.size })
          return
        }
        if (resumed) {
          assetId = earlier
          controller.signal.throwIfAborted()
          patchT(t.key, { assetId, resumable: true, resumed: true })
          await sendParts(t.key, file, controller, resumed.plan, resumed.have)
        } else {
          controller.signal.throwIfAborted()
          multipart = false
          if (earlier) writeResume(fp, null)
          const { asset, upload } = await json<{ asset: MediaAsset; upload: SingleUpload | MultipartUpload }>(
            await fetch('/api/uploads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: file.name, size: file.size, mimeType: file.type || null, folderId: t.folderId, presetId: t.presetId, multipart: big }),
            }),
          )
          assetId = asset.id
          controller.signal.throwIfAborted()
          put(asset)
          if (upload.kind === 'multipart') {
            multipart = true
            writeResume(fp, asset.id)
            patchT(t.key, { assetId, resumable: true })
            await sendParts(t.key, file, controller, upload, new Set())
          } else {
            patchT(t.key, { assetId })
            await putBlob(upload, file, file.type, (l) => patchT(t.key, { loaded: l }), track(t.key))
          }
        }

        controller.signal.throwIfAborted()
        const done = await json<{ asset: MediaAsset }>(await fetch(`/api/uploads/${assetId}/complete`, { method: 'POST' }))
        writeResume(fp, null)
        put(done.asset)
        patchT(t.key, { state: 'done', loaded: file.size })
      } catch (e) {
        const isCancel = e instanceof Error && e.message === 'CANCELLED'
        if (isCancel || !multipart) {
          patchT(t.key, { state: isCancel ? 'cancelled' : 'error', error: isCancel ? undefined : e instanceof Error ? e.message : 'Upload failed.' })
          // don't leave a half-uploaded asset behind
          writeResume(fp, null)
          if (assetId) {
            const id = assetId
            void fetch(`/api/assets/${id}`, { method: 'DELETE' })
              .then(response => { if (response.ok) setAssets(xs => xs.filter(x => x.id !== id)) })
              .catch(() => { /* The server expires abandoned uploads when offline. */ })
          }
        } else {
          // parts that arrived stay; adding the same file again picks up from here
          patchT(t.key, { state: 'error', error: `${e instanceof Error ? e.message : 'Upload failed.'} What arrived is kept: add the same file again to resume.` })
        }
      } finally {
        xhrs.current.delete(t.key)
        controllers.current.delete(t.key)
        files.current.delete(t.key)
      }
    },
    [put, workspace.id],
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

  const upload = useCallback((list: FileList | File[], folderId: string | null = null, presetId: string | null = null) => {
    const arr = Array.from(list)
    const ok = arr.filter((f) => guessType(f.name, f.type))
    const skipped = arr.length - ok.length
    if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped — only video, audio and images are supported`)
    if (!ok.length) return
    const added = ok.map((f, i) => {
      const key = `${Date.now()}-${i}-${f.name}`
      files.current.set(key, f)
      return { key, assetId: null, name: f.name, size: f.size, loaded: 0, state: 'waiting' as const, folderId, presetId }
    })
    setTransfers((ts) => [...added, ...ts])
  }, [])

  const cancel = useCallback((key: string) => {
    const running = xhrs.current.get(key)
    if (started.current.has(key) && files.current.has(key)) {
      controllers.current.get(key)?.abort(new Error('CANCELLED'))
      running?.forEach((x) => x.abort())
    } else {
      files.current.delete(key)
      setTransfers((ts) => ts.map((t) => (t.key === key && t.state === 'waiting' ? { ...t, state: 'cancelled' } : t)))
    }
  }, [])

  const clearFinished = useCallback(() => setTransfers((ts) => ts.filter((t) => t.state === 'uploading' || t.state === 'waiting')), [])

  const value = useMemo<Media>(
    () => ({ assets, summary, loaded, refresh, get: (id) => assets.find((a) => a.id === id), put, remove, update, retry, transfers, upload, cancel, clearFinished }),
    [assets, summary, loaded, refresh, put, remove, update, retry, transfers, upload, cancel, clearFinished],
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
