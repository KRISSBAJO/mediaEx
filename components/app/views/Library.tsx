'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ASSETS, bytes, compact, relDay, type AssetType } from '@/lib/sample'
import Icon from '../Icon'
import { Card, PageHead, StatusBadge, Tabs, Thumb, TypeIcon } from '../ui'

type Filter = 'all' | AssetType | 'attention'
type Sort = 'new' | 'views' | 'name' | 'size'

export default function Library() {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const count = (f: Filter) =>
    ASSETS.filter((a) => (f === 'all' ? true : f === 'attention' ? a.status !== 'ready' : a.type === f)).length

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return ASSETS.filter((a) => (filter === 'all' ? true : filter === 'attention' ? a.status !== 'ready' : a.type === filter))
      .filter((a) => !s || a.title.toLowerCase().includes(s) || a.tags.some((t) => t.includes(s)))
      .sort((a, b) =>
        sort === 'views' ? b.views - a.views : sort === 'name' ? a.title.localeCompare(b.title) : sort === 'size' ? b.size - a.size : a.createdDaysAgo - b.createdDaysAgo,
      )
  }, [filter, q, sort])

  return (
    <>
      <PageHead title="Library" sub={`${ASSETS.length} assets · ${bytes(ASSETS.reduce((s, a) => s + a.size, 0))} stored`} />

      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'all', label: 'All', count: count('all') },
          { value: 'video', label: 'Video', count: count('video') },
          { value: 'audio', label: 'Audio', count: count('audio') },
          { value: 'image', label: 'Images', count: count('image') },
          { value: 'attention', label: 'Needs attention', count: count('attention') },
        ]}
      />

      <div className="toolbar">
        <label className="input-icon grow">
          <Icon name="search" size={16} />
          <span className="sr-only">Search assets</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or tag" />
        </label>
        <label>
          <span className="sr-only">Sort by</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="new">Newest first</option>
            <option value="views">Most viewed</option>
            <option value="name">Name A–Z</option>
            <option value="size">Largest first</option>
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
            <b>No assets match “{q}”</b>
            <p>Try another title or tag, or clear the filter.</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQ('')
                setFilter('all')
              }}
            >
              Clear search
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
                    {a.views ? `${compact(a.views)} views` : bytes(a.size)}
                  </span>
                  {a.status === 'ready' ? <span className="muted">{relDay(a.createdDaysAgo)}</span> : <StatusBadge status={a.status} progress={a.progress} />}
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
                  <th className="num">Size</th>
                  <th className="num">Views</th>
                  <th className="num">Watch time</th>
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
                            {a.resolution}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={a.status} progress={a.progress} />
                    </td>
                    <td className="num mono">{bytes(a.size)}</td>
                    <td className="num">{a.views ? a.views.toLocaleString('en-US') : '—'}</td>
                    <td className="num">{a.watchHours ? `${a.watchHours.toLocaleString('en-US')} h` : '—'}</td>
                    <td className="num muted">{relDay(a.createdDaysAgo)}</td>
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
