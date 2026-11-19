'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { isActive, type MediaAsset, type MediaType } from '@/lib/media/types'
import { bytes, duration as fmtDuration } from '@/lib/sample'
import Icon from '../Icon'
import { Ago, dims, useMedia } from '../media'
import { Card, PageHead, StatusBadge, Tabs, Thumb, TypeIcon } from '../ui'

type Filter = 'all' | MediaType | 'attention'
type Sort = 'new' | 'name' | 'size' | 'long'

const matches = (f: Filter) => (a: MediaAsset) => (f === 'all' ? true : f === 'attention' ? a.status !== 'ready' : a.type === f)

export default function Library() {
  const { assets } = useMedia()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const count = (f: Filter) => assets.filter(matches(f)).length
  const stored = assets.reduce((t, a) => t + a.size + a.outputSize, 0)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return assets
      .filter(matches(filter))
      .filter((a) => !s || a.title.toLowerCase().includes(s) || a.fileName.toLowerCase().includes(s) || a.tags.some((t) => t.includes(s)))
      .sort((a, b) =>
        sort === 'name' ? a.title.localeCompare(b.title) : sort === 'size' ? b.size - a.size : sort === 'long' ? b.duration - a.duration : b.createdAt.localeCompare(a.createdAt),
      )
  }, [assets, filter, q, sort])

  if (!assets.length) {
    return (
      <>
        <PageHead title="Library" sub="Everything you upload lands here, ready to stream." />
        <Card>
          <div className="empty">
            <Icon name="library" size={22} />
            <b>Your library is empty</b>
            <p>Upload a video, audio file or image. MediaEX encodes it for streaming and it appears here.</p>
            <Link href="/dashboard/uploads" className="btn btn-primary btn-sm">
              <Icon name="upload" size={15} /> Upload files
            </Link>
          </div>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHead title="Library" sub={`${assets.length} ${assets.length === 1 ? 'asset' : 'assets'} · ${bytes(stored)} stored`}>
        <Link href="/dashboard/uploads" className="btn btn-primary btn-sm">
          <Icon name="upload" size={15} /> Upload
        </Link>
      </PageHead>

      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'all', label: 'All', count: count('all') },
          { value: 'video', label: 'Video', count: count('video') },
          { value: 'audio', label: 'Audio', count: count('audio') },
          { value: 'image', label: 'Images', count: count('image') },
          { value: 'attention', label: 'In progress & failed', count: count('attention') },
        ]}
      />

      <div className="toolbar">
        <label className="input-icon grow">
          <Icon name="search" size={16} />
          <span className="sr-only">Search assets</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, file name or tag" />
        </label>
        <label>
          <span className="sr-only">Sort by</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="new">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="size">Largest first</option>
            <option value="long">Longest first</option>
          </select>
        </label>
        <div className="seg seg-icon" role="group" aria-label="Layout">
          <button type="button" aria-label="Grid" aria-pressed={view === 'grid'} className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')}>
            <Icon name="grid" size={16} />
          </button>
          <button type="button" aria-label="List" aria-pressed={view === 'list'} className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')}>
            <Icon name="list" size={16} />
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <Card>
          <div className="empty">
            <Icon name="search" size={22} />
            <b>{q ? `No assets match “${q}”` : 'Nothing here yet'}</b>
            <p>Try another title or tag, or clear the filter.</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQ('')
                setFilter('all')
              }}
            >
              Show everything
            </button>
          </div>
        </Card>
      ) : view === 'grid' ? (
        <div className="asset-grid">
          {list.map((a) => (
            <Link key={a.id} href={`/dashboard/library/${a.id}`} className="asset-card">
              <Thumb asset={a} />
              <div className="asset-card-body">
                <b>{a.title}</b>
                <div className="asset-card-meta">
                  <span>
                    <TypeIcon type={a.type} />
                    {a.type === 'image' ? dims(a) : fmtDuration(Math.round(a.duration))}
                  </span>
                  {a.status === 'ready' ? (
                    <span className="muted">
                      <Ago iso={a.createdAt} />
                    </span>
                  ) : (
                    <StatusBadge status={a.status} progress={a.progress} />
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Status</th>
                  <th className="num">Duration</th>
                  <th className="num">Size</th>
                  <th className="num">Added</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/dashboard/library/${a.id}`} className="asset-cell">
                        <Thumb asset={a} />
                        <span>
                          <b>{a.title}</b>
                          <small>
                            <TypeIcon type={a.type} />
                            {a.sourceInfo ?? a.fileName}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={a.status} progress={isActive(a) ? a.progress : undefined} />
                    </td>
                    <td className="num">{a.duration ? fmtDuration(Math.round(a.duration)) : '—'}</td>
                    <td className="num">{bytes(a.size)}</td>
                    <td className="num muted">
                      <Ago iso={a.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
