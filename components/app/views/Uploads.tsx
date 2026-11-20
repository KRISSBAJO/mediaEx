'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ACCEPT_ATTR, STAGES, guessType, isActive, type UploadPreset } from '@/lib/media/types'
import { bytes } from '@/lib/sample'
import Icon from '../Icon'
import { flatTree, request, useLibrary } from '../library'
import { useMedia, type Transfer } from '../media'
import { Card, ModerationBadge, PageHead, StatusBadge, Thumb } from '../ui'

function transferLine(t: Transfer, assetStatus?: string, stage?: number, progress?: number, moderation?: string) {
  if (t.state === 'waiting') return 'Waiting to upload'
  if (t.state === 'uploading') return `${t.resumed ? 'Resuming' : 'Uploading'} · ${bytes(t.loaded)} of ${bytes(t.size)}${t.resumable ? ' · in parts' : ''}`
  if (t.state === 'error') return t.error ?? 'Upload failed'
  if (t.state === 'cancelled') return 'Cancelled'
  if (assetStatus === 'ready' && moderation === 'pending') return 'Ready · waiting for review before it goes public'
  if (assetStatus === 'ready' && moderation === 'rejected') return 'Ready · rejected in review'
  if (assetStatus === 'ready') return 'Ready to stream'
  if (assetStatus === 'failed') return 'Processing failed'
  if (assetStatus === 'queued') return 'Uploaded · waiting for an encoder'
  if (assetStatus === 'processing') return `${STAGES[stage ?? 1]} · ${Math.round(progress ?? 0)}%`
  return 'Uploaded'
}

export default function Uploads() {
  const { assets, transfers, upload, cancel, clearFinished, get } = useMedia()
  const lib = useLibrary()
  const params = useSearchParams()
  const [folderId, setFolderId] = useState<string | null>(params.get('folder'))
  const [presets, setPresets] = useState<UploadPreset[]>([])
  const [maxBytes, setMaxBytes] = useState<number | null>(null)
  const [presetError, setPresetError] = useState('')
  const [presetId, setPresetId] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    request<{ presets: UploadPreset[]; maxUploadBytes: number }>('/api/uploads/presets', { signal: abort.signal })
      .then(data => { setPresets(data.presets); setMaxBytes(data.maxUploadBytes); setPresetError('') })
      .catch(error => { if (!abort.signal.aborted) setPresetError(error.message) })
    return () => abort.abort()
  }, [refresh])
  const preset = presetId ? presets.find(p => p.id === presetId) : presets.find(p => p.isDefault)
  const destination = preset ? preset.folderId : folderId
  // a folder link from the library wins; drop it if that folder no longer exists
  useEffect(() => {
    if (lib.ready && folderId && !lib.folders.some((f) => f.id === folderId)) setFolderId(null)
  }, [lib.ready, lib.folders, folderId])
  const target = destination ? lib.folderPath(destination).map((f) => f.name).join(' / ') : null
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sessionIds = new Set(transfers.map((t) => t.assetId))
  const inPipeline = assets.filter((a) => isActive(a) && !sessionIds.has(a.id))
  const finished = transfers.some((t) => t.state !== 'uploading' && t.state !== 'waiting')

  return (
    <>
      <PageHead title="Uploads" sub="Drop files to ingest them. MediaEX analyses, encodes and packages each one for streaming.">
        {presets.length > 0 && <label className="upload-target"><span>Upload preset</span>
          <select className="select" value={presetId} onChange={e => setPresetId(e.target.value)}>
            <option value="">Workspace default{presets.find(p => p.isDefault) ? ' · ' + presets.find(p => p.isDefault)!.name : ''}</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>}
        <label className="upload-target">
          <span>Upload to</span>
          <select className="select" value={destination ?? ''} disabled={!!preset} onChange={(e) => setFolderId(e.target.value || null)}>
            <option value="">No folder</option>
            {flatTree(lib.folders).map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {'\u00a0\u00a0'.repeat(depth)}
                {depth ? '└ ' : ''}
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      </PageHead>

      {presetError && <p role="alert">{presetError} <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRefresh(n => n + 1)}>Try again</button></p>}
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
              if (maxBytes !== null) upload(e.dataTransfer.files, destination, preset?.id)
            }}
          >
            <span className="vf-corner tl" aria-hidden="true" />
            <span className="vf-corner tr" aria-hidden="true" />
            <span className="vf-corner bl" aria-hidden="true" />
            <span className="vf-corner br" aria-hidden="true" />
            <input
              ref={input}
              type="file"
              multiple
              disabled={maxBytes === null}
              accept={preset ? preset.policy.kinds.map(k => k + '/*').join(',') : ACCEPT_ATTR}
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) upload(e.target.files, destination, preset?.id)
                e.target.value = ''
              }}
            />
            <span className="drop-icon">
              <Icon name="upload" size={22} />
            </span>
            <b>{drag ? `Drop to upload${target ? ` into ${target}` : ''}` : 'Drag files here, or browse'}</b>
            <p>{maxBytes === null ? 'Loading upload limits…' : `${preset ? preset.policy.kinds.join(', ') : 'Video, audio and images'} up to ${bytes(preset?.policy.maxBytes ?? maxBytes)} per file.`}</p>
            <span className="btn btn-ghost btn-sm">Browse files</span>
          </label>

          {transfers.length > 0 && (
            <Card
              title="This session"
              meta={`${transfers.filter((t) => t.state === 'done' && get(t.assetId ?? '')?.status === 'ready').length} of ${transfers.length} ready`}
              flush
              action={
                finished ? (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={clearFinished}>
                    Clear finished
                  </button>
                ) : undefined
              }
            >
              <ul className="rows">
                {transfers.map((t) => {
                  const a = t.assetId ? get(t.assetId) : undefined
                  const kind = guessType(t.name) ?? 'file'
                  const sending = t.state === 'uploading' || t.state === 'waiting'
                  const pct = sending ? (t.loaded / Math.max(1, t.size)) * 100 : a?.status === 'ready' ? 100 : a?.status === 'processing' ? a.progress : 0
                  const live = sending || (!!a && isActive(a))
                  return (
                    <li key={t.key}>
                      {a?.thumbUrl ? (
                        <Thumb asset={a} className="row-thumb" />
                      ) : (
                        <span className="file-kind">
                          <Icon name={kind} size={16} />
                        </span>
                      )}
                      <div className="grow">
                        {a && t.state === 'done' ? (
                          <Link href={`/dashboard/library/${a.id}`} className="row-link">
                            <b>{a.title}</b>
                          </Link>
                        ) : (
                          <b>{t.name}</b>
                        )}
                        <small className={t.state === 'error' ? 'is-bad' : ''}>
                          {bytes(t.size)} · {transferLine(t, a?.status, a?.stage, a?.progress, a?.moderation)}
                        </small>
                        {live && (
                          <span className={`meter ${sending ? 'is-upload' : ''}`}>
                            <i style={{ width: `${pct}%` }} />
                          </span>
                        )}
                      </div>
                      {sending ? (
                        <button type="button" className="btn btn-quiet btn-sm" onClick={() => cancel(t.key)}>
                          Cancel
                        </button>
                      ) : t.state === 'error' ? (
                        <StatusBadge status="failed" />
                      ) : a && a.status === 'ready' && a.moderation !== 'approved' ? (
                        <ModerationBadge state={a.moderation} />
                      ) : a ? (
                        <StatusBadge status={a.status} progress={a.progress} />
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {inPipeline.length > 0 && (
            <Card
              title="Already in the pipeline"
              meta={`${inPipeline.length} ${inPipeline.length === 1 ? 'asset' : 'assets'}`}
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
                          {bytes(a.size)} · {a.status === 'queued' ? 'Waiting for an encoder' : a.status === 'uploading' ? 'Upload interrupted — add the same file again to resume' : `${STAGES[a.stage]}…`}
                        </small>
                      </span>
                    </Link>
                    <StatusBadge status={a.status} progress={a.progress} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card title="What happens to each file">
            <ol className="steps-list">
              <li>
                <b>Upload</b>
                <span>The original is stored as-is. Only members of this workspace can download it.</span>
              </li>
              <li>
                <b>Analyse</b>
                <span>We read the codec, resolution, frame rate and length, and grab a thumbnail — a frame, or a waveform for audio.</span>
              </li>
              <li>
                <b>Encode</b>
                <span>Video becomes an H.264 adaptive ladder from 1080p down to 360p, never above the source, plus HEVC and AV1 ladders if they’re on in Settings → Encoding. Audio becomes AAC. Images get a web-sized poster.</span>
              </li>
              <li>
                <b>Package</b>
                <span>Everything is packaged as HLS, so it streams on the web, iOS, Android and TVs from one link.</span>
              </li>
            </ol>
          </Card>
          <Card title="Good to know">
            <ul className="facts">
              <li>Uploads keep going while you move around the dashboard. Closing the tab pauses them.</li>
              <li>Files over 64 MB go up in parts. A dropped connection only retries the part it was on, and adding the same file again after closing the tab picks up where it stopped.</li>
              <li>Two files upload at a time; the rest wait their turn.</li>
              <li>Processing usually takes less time than the video lasts.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
