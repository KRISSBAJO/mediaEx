'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { MediaAsset } from '@/lib/media/types'
import { bytes, duration as fmtDuration } from '@/lib/sample'
import Icon from '../Icon'
import MediaPlayer from '../MediaPlayer'
import MetadataEditor from '../MetadataEditor'
import { flatTree, useLibrary } from '../library'
import { Ago, dims, useMedia } from '../media'
import { ModerationBadge, StatusBadge } from '../ui'
import ShareLink from '../ShareLink'
import { CollectDialog, TagInput } from './dialogs'

export default function Preview({ asset: a, onClose, previous, next }: { asset: MediaAsset; onClose: () => void; previous?: () => void; next?: () => void }) {
  return <aside className="lib-preview" aria-label={`Preview of ${a.title}`}>
    <header className="lib-preview-head">
      <h2>Preview</h2>
      <button type="button" className="icon-btn is-quiet" disabled={!previous} onClick={previous} aria-label="Previous asset">&#8592;</button>
      <button type="button" className="icon-btn is-quiet" disabled={!next} onClick={next} aria-label="Next asset">&#8594;</button>
      <button type="button" className="icon-btn is-quiet" onClick={onClose} aria-label="Close preview"><Icon name="x" size={16} /></button>
    </header>
    <PreviewBody key={a.id} asset={a} />
  </aside>
}

function PreviewBody({ asset: a }: { asset: MediaAsset }) {
  const media = useMedia()
  const lib = useLibrary()
  const [collecting, setCollecting] = useState(false)
  const inCollections = lib.collections.filter((c) => a.collectionIds.includes(c.id))

  return (
    <>
      <div className="lib-preview-body">
        <MediaPlayer asset={a} corners={false} />

        <strong className="preview-title">{a.title}</strong>
        <div className="lib-preview-actions">
          <Link href={`/dashboard/library/${a.id}`} className="btn btn-primary btn-sm">
            Open asset details
          </Link>
          <ShareLink asset={a} />
          {a.status !== 'uploading' && (
            <a className="btn btn-ghost btn-sm" href={`/api/media/${a.id}/original`} aria-label="Download original">
              <Icon name="file" size={14} />
            </a>
          )}
        </div>

        <details className="preview-details">
          <summary>File details and organization</summary>
        <dl className="lib-facts">
          <div>
            <dt>Status</dt>
            <dd>
              {a.status === 'ready' && a.moderation !== 'approved' ? <ModerationBadge state={a.moderation} /> : <StatusBadge status={a.status} progress={a.progress} />}
            </dd>
          </div>
          <div>
            <dt>{a.type === 'audio' ? 'Length' : 'Size'}</dt>
            <dd>
              {a.type === 'audio' ? fmtDuration(Math.round(a.duration)) : dims(a)}
              {a.type === 'video' && a.duration ? ` · ${fmtDuration(Math.round(a.duration))}` : ''}
            </dd>
          </div>
          <div>
            <dt>File</dt>
            <dd title={a.fileName}>{bytes(a.size)}</dd>
          </div>
          <div>
            <dt>Added</dt>
            <dd>
              <Ago iso={a.createdAt} />
              {a.createdBy ? ` · ${a.createdBy}` : ''}
            </dd>
          </div>
          {a.sourceInfo && (
            <div className="span-2">
              <dt>Source</dt>
              <dd>{a.sourceInfo}</dd>
            </div>
          )}
        </dl>

        <label className="field-d">
          <span>Folder</span>
          <select className="select" value={a.folderId ?? ''} onChange={(e) => void media.update(a.id, { folderId: e.target.value || null })}>
            <option value="">No folder</option>
            {flatTree(lib.folders).map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {'  '.repeat(depth)}
                {depth ? '└ ' : ''}
                {folder.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field-d">
          <span>Tags</span>
          <TagInput value={a.tags} onChange={(tags) => void media.update(a.id, { tags })} />
        </div>

        <MetadataEditor asset={a} />

        <div className="field-d">
          <span>Collections</span>
          <div className="tags">
            {inCollections.map((c) => (
              <button key={c.id} type="button" className="tag" title={`Remove from ${c.name}`} onClick={() => void lib.collect(c.id, [a.id], true)}>
                {c.name} <Icon name="x" size={12} />
              </button>
            ))}
            <button type="button" className="tag-add" onClick={() => setCollecting(true)}>
              <Icon name="plus" size={13} /> Add
            </button>
          </div>
        </div>
        </details>
      </div>

      {collecting && <CollectDialog count={1} onClose={() => setCollecting(false)} onPick={(cid) => lib.collect(cid, [a.id])} />}
    </>
  )
}
