'use client'

import Link from 'next/link'
import { useState } from 'react'
import { bytes, duration as fmtDuration } from '@/lib/sample'
import Icon from '../Icon'
import MediaPlayer from '../MediaPlayer'
import MetadataEditor from '../MetadataEditor'
import { flatTree, useLibrary } from '../library'
import { Ago, dims, useMedia } from '../media'
import { ModerationBadge, StatusBadge } from '../ui'
import ShareLink from '../ShareLink'
import { CollectDialog, TagInput } from './dialogs'

export default function Preview({ id, onClose }: { id: string; onClose: () => void }) {
  const media = useMedia()
  const lib = useLibrary()
  const a = media.get(id)
  const [collecting, setCollecting] = useState(false)
  if (!a) return null
  const inCollections = lib.collections.filter((c) => a.collectionIds.includes(c.id))

  return (
    <aside className="lib-preview" aria-label={`Preview of ${a.title}`}>
      <header className="lib-preview-head">
        <h2 title={a.title}>{a.title}</h2>
        <button type="button" className="icon-btn is-quiet" aria-label="Close preview" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </header>

      <div className="lib-preview-body">
        <MediaPlayer asset={a} corners={false} />

        <div className="lib-preview-actions">
          <Link href={`/dashboard/library/${a.id}`} className="btn btn-primary btn-sm">
            Open
          </Link>
          <ShareLink asset={a} />
          {a.status !== 'uploading' && (
            <a className="btn btn-ghost btn-sm" href={`/api/media/${a.id}/original`} aria-label="Download original">
              <Icon name="file" size={14} />
            </a>
          )}
        </div>

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
      </div>

      {collecting && <CollectDialog count={1} onClose={() => setCollecting(false)} onPick={(cid) => lib.collect(cid, [a.id])} />}
    </aside>
  )
}
