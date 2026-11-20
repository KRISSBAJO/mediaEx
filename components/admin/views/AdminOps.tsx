'use client'

import Link from 'next/link'
import { Card, PageHead, StatTile } from '../../app/ui'
import { Loading, Pill, act, ago, fmtBytes, useAdmin } from '../kit'

type Ops = {
  pipeline: { uploading: number; queued: number; processing: number; failed24h: number; oldestQueued: string | null; staleUploads: number }
  failedAssets: { id: string; title: string; error: string | null; attempts: number; updatedAt: string; workspaceName: string }[]
  captions: { queued: number; processing: number; failed: number; ready: number; available: boolean; failedList: { assetId: string; error: string | null; updatedAt: string; title: string }[] }
  webhooks: { pending: number; failed24h: number; succeeded24h: number; failingEndpoints: { id: string; url: string; failures: number; enabled: boolean; workspaceName: string; lastSuccess: string | null }[] }
  health: {
    db: { ok: boolean; ms: number; error?: string }
    storage: { kind: string; durable: boolean; disk: { free: number; total: number } | null }
    ffmpeg: { found: boolean; h264: string | null; hevc: string | null; av1: string | null; hardware: string | null }
    providers: { billing: string | null; openai: boolean; anthropic: boolean; email: boolean; google: boolean; github: boolean }
    worker: boolean
    node: string
    uptimeSeconds: number
  }
}

const Check = ({ ok, children }: { ok: boolean | null; children: React.ReactNode }) => (
  <li>
    <span className={`dot-status ${ok === null ? '' : ok ? 'is-good' : 'is-bad'}`}>{children}</span>
  </li>
)
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`)

export default function AdminOps() {
  const { data, error, reload } = useAdmin<Ops>('/api/admin/ops')
  if (!data) return <Loading error={error} />
  const p = data.pipeline
  const h = data.health
  const diskUse = h.storage.disk ? 1 - h.storage.disk.free / h.storage.disk.total : null

  return (
    <>
      <PageHead title="Operations" sub="The pipeline, captions, webhooks and the health of this server.">
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
          Refresh
        </button>
      </PageHead>
      <div className="grid-ruled stat-tiles">
        <StatTile label="Encoding now" value={String(p.processing)} unit={`${p.queued} queued`} />
        <StatTile label="Oldest in queue" value={p.oldestQueued ? ago(p.oldestQueued) : '—'} />
        <StatTile label="Failed, 24 hours" value={String(p.failed24h)} />
        <StatTile label="Uploads stuck over a day" value={String(p.staleUploads)} />
      </div>

      <div className="grid-2">
        <div className="stack">
          <Card
            title="Failed jobs"
            meta={`${data.failedAssets.length} most recent`}
            flush
            action={
              p.failed24h > 0 ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={async () => (await act<{ requeued: number }>('/api/admin/ops/retry-failed', { done: 'Failed jobs from the last 24 hours queued again' })) && reload()}>
                  Retry last 24 h
                </button>
              ) : undefined
            }
          >
            {data.failedAssets.length ? (
              <ul className="rows">
                {data.failedAssets.map((a) => (
                  <li key={a.id}>
                    <span>
                      <b>{a.title}</b>
                      <small className="is-bad">{a.error ?? 'No error recorded'}</small>
                      <small>
                        {a.workspaceName} · {a.attempts} {a.attempts === 1 ? 'attempt' : 'attempts'} · {ago(a.updatedAt)}
                      </small>
                    </span>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={async () => (await act(`/api/admin/assets/${a.id}/retry`, { done: 'Queued again' })) && reload()}>
                      Retry
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note acard-pad">Nothing has failed.</p>
            )}
          </Card>
          <Card title="Webhooks" meta={`${data.webhooks.succeeded24h} delivered · ${data.webhooks.failed24h} gave up · ${data.webhooks.pending} retrying (24 h)`} flush>
            {data.webhooks.failingEndpoints.length ? (
              <ul className="rows">
                {data.webhooks.failingEndpoints.map((e) => (
                  <li key={e.id}>
                    <span>
                      <b className="mono-strong">{e.url.replace(/^https?:\/\//, '')}</b>
                      <small>
                        {e.workspaceName} · {e.failures} failures in a row · last success {ago(e.lastSuccess)}
                        {!e.enabled ? ' · disabled' : ''}
                      </small>
                    </span>
                    <Pill tone={e.failures >= 3 ? 'bad' : 'warn'}>{e.failures >= 3 ? 'Failing' : 'Flaky'}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet-note acard-pad">Every endpoint is answering.</p>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="System health" meta={`Up ${uptime(h.uptimeSeconds)} · Node ${h.node}`}>
            <ul className="ahealth">
              <Check ok={h.db.ok}>Database {h.db.ok ? `answered in ${h.db.ms} ms` : `unreachable: ${h.db.error}`}</Check>
              <Check ok={h.storage.durable}>
                Storage: {h.storage.kind === 's3' ? 'S3-compatible bucket' : 'local disk'}
                {h.storage.durable ? '' : ' (not durable: set S3_* or mount MEDIA_DIR)'}
                {h.storage.disk ? ` · ${fmtBytes(h.storage.disk.free)} free of ${fmtBytes(h.storage.disk.total)}` : ''}
              </Check>
              {diskUse !== null && diskUse > 0.85 && <Check ok={false}>Disk is {Math.round(diskUse * 100)}% full</Check>}
              <Check ok={h.ffmpeg.found}>FFmpeg: H.264 {h.ffmpeg.h264 ?? 'missing'} · HEVC {h.ffmpeg.hevc ?? 'none'} · AV1 {h.ffmpeg.av1 ?? 'none'}</Check>
              <Check ok={null}>GPU encoding: {h.ffmpeg.hardware ?? 'off (CPU)'}</Check>
              <Check ok={h.worker}>Pipeline worker {h.worker ? 'running on this instance' : 'off on this instance (MEDIA_WORKER=off)'}</Check>
            </ul>
          </Card>
          <Card title="Connected services">
            <ul className="ahealth">
              <Check ok={Boolean(h.providers.billing)}>Payments: {h.providers.billing ?? 'not set up'}</Check>
              <Check ok={h.providers.openai}>Automatic captions (OpenAI): {h.providers.openai ? 'on' : 'no key'}</Check>
              <Check ok={h.providers.anthropic}>Automatic review (Anthropic): {h.providers.anthropic ? 'on' : 'no key'}</Check>
              <Check ok={h.providers.email}>Email delivery: {h.providers.email ? 'on' : 'off (emails are skipped)'}</Check>
              <Check ok={null}>
                Sign-in with Google {h.providers.google ? 'on' : 'off'} · GitHub {h.providers.github ? 'on' : 'off'}
              </Check>
            </ul>
          </Card>
          <Card title="Captions" meta={data.captions.available ? `${data.captions.ready} tracks made` : 'No OpenAI key'} flush>
            <p className="quiet-note acard-pad">
              {data.captions.processing} transcribing · {data.captions.queued} waiting · {data.captions.failed} failed
            </p>
            {data.captions.failedList.length > 0 && (
              <ul className="rows">
                {data.captions.failedList.map((c) => (
                  <li key={c.assetId}>
                    <span>
                      <Link href={`/admin/media?q=${c.assetId}`}>
                        <b>{c.title}</b>
                      </Link>
                      <small className="is-bad">{c.error}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
