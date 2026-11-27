import type { MediaAsset } from './types'

type Part = { number: number; size: number }
type Parts = { partSize: number; partCount: number; uploaded: Part[] }

export async function lookupResume(assetId: string, size: number, request = fetch) {
  const parts = `/api/uploads/${encodeURIComponent(assetId)}/parts`
  const res = await request(parts, { cache: 'no-store' })
  if (res.status === 404 || res.status === 410) return null
  if (res.status === 409) {
    // Completion can commit even when the browser loses its response.
    const current = await request(`/api/assets/${encodeURIComponent(assetId)}`, { cache: 'no-store' })
    if (!current.ok) throw new Error(`Couldn’t check the existing asset (${current.status}).`)
    const { asset }: { asset: MediaAsset } = await current.json()
    if (asset?.id !== assetId || asset.size !== size) throw new Error('The existing asset does not match this upload.')
    if (asset.status === 'uploading') throw new Error('The existing upload is unavailable.')
    return { kind: 'completed' as const, asset }
  }
  if (!res.ok) throw new Error(`Couldn’t check saved parts (${res.status}).`)
  const { partSize, partCount, uploaded }: Parts = await res.json()
  if (!Number.isSafeInteger(partSize) || partSize < 1 || partCount !== Math.ceil(size / partSize) || !Array.isArray(uploaded)) {
    throw new Error('The saved upload plan does not match this file.')
  }
  const have = new Set<number>()
  for (const part of uploaded) {
    if (!Number.isInteger(part.number) || part.number < 1 || part.number > partCount ||
        part.size !== Math.min(partSize, size - (part.number - 1) * partSize)) {
      throw new Error('The saved part does not match this file.')
    }
    have.add(part.number)
  }
  return { kind: 'active' as const, plan: { kind: 'multipart' as const, partSize, partCount, parts }, have }
}

// An offline transfer must release its queue slot as soon as the user cancels.
export function waitForUploadRetry(signal: AbortSignal, delayMs: number, network: EventTarget, online: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    function cleanup() {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      network.removeEventListener('online', connected)
    }
    function cancel() {
      cleanup()
      reject(signal.reason)
    }
    function connected() {
      timer = setTimeout(() => { cleanup(); resolve() }, delayMs)
    }
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel, { once: true })
    if (online()) connected()
    else network.addEventListener('online', connected, { once: true })
  })
}
