'use client'

import { useEffect, useRef, useState } from 'react'
import type { DateFilter, MediaType, SearchQuery, Sort, StatusFilter } from '@/lib/media/types'
import Icon from '../Icon'
import { useLibrary } from '../library'

const TYPE_LABEL: Record<MediaType, string> = { video: 'Video', audio: 'Audio', image: 'Images' }
const STATUS_LABEL: Record<StatusFilter, string> = { ready: 'Ready', active: 'In progress', failed: 'Failed' }
const DATE_LABEL: Record<DateFilter, string> = { '1d': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '365d': 'Last 12 months' }
export const SORT_LABEL: Record<Sort, string> = { relevance: 'Best match', new: 'Newest first', old: 'Oldest first', name: 'Name A–Z', size: 'Largest first', long: 'Longest first' }

/** A chip that opens a small panel of options. */
function Chip({ label, count, children }: { label: string; count?: number; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', out)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', out)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="chip-wrap" ref={ref}>
      <button type="button" className={`fchip ${count ? 'is-set' : ''}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        {count ? <b>{count}</b> : null}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && <div className="fpanel">{children(() => setOpen(false))}</div>}
    </div>
  )
}

function Checks<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T[] | undefined; onChange: (v: T[]) => void; labels: Record<T, string> }) {
  const set = new Set(value ?? [])
  return (
    <>
      {options.map((o) => (
        <label key={o} className="fopt">
          <input type="checkbox" checked={set.has(o)} onChange={() => onChange(set.has(o) ? [...set].filter((x) => x !== o) : [...set, o])} />
          {labels[o]}
        </label>
      ))}
    </>
  )
}

export default function Filters({ query, go, onSave }: { query: SearchQuery; go: (q: SearchQuery) => void; onSave: () => void }) {
  const { tags } = useLibrary()
  const [text, setText] = useState(query.q ?? '')
  const [tagFind, setTagFind] = useState('')
  const typing = useRef(false)

  // keep the box in step when the query changes from elsewhere (a saved search, back button)
  useEffect(() => {
    if (!typing.current) setText(query.q ?? '')
  }, [query.q])
  // search as you type, after a short pause
  useEffect(() => {
    if (!typing.current) return
    const id = setTimeout(() => {
      typing.current = false
      const q = text.trim()
      go({ ...query, q: q || undefined, sort: q ? query.sort : query.sort === 'relevance' ? undefined : query.sort })
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const set = (patch: Partial<SearchQuery>) => go({ ...query, ...patch })
  const filtered = Boolean(query.q || query.type?.length || query.status?.length || query.tags?.length || query.date)
  const shownTags = tags.filter((t) => !tagFind || t.tag.includes(tagFind.toLowerCase().trim()))
  const sort = query.sort ?? (query.q ? 'relevance' : 'new')

  return (
    <div className="lib-filters">
      <label className="lib-search input-icon">
        <Icon name="search" size={16} />
        <span className="sr-only">Search the library</span>
        <input
          className="input"
          type="search"
          value={text}
          placeholder="Search by title, file name, tag or format"
          onChange={(e) => {
            typing.current = true
            setText(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text) {
              typing.current = true
              setText('')
            }
          }}
        />
      </label>

      <div className="lib-chips">
        <Chip label="Type" count={query.type?.length}>
          {() => <Checks options={['video', 'audio', 'image'] as const} value={query.type} labels={TYPE_LABEL} onChange={(type) => set({ type: type.length ? type : undefined })} />}
        </Chip>
        <Chip label="Tags" count={query.tags?.length}>
          {() => (
            <>
              <input className="input fpanel-find" placeholder="Find a tag" value={tagFind} onChange={(e) => setTagFind(e.target.value)} autoFocus />
              <div className="fpanel-scroll">
                {shownTags.map((t) => {
                  const on = query.tags?.includes(t.tag) ?? false
                  return (
                    <label key={t.tag} className="fopt">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = on ? (query.tags ?? []).filter((x) => x !== t.tag) : [...(query.tags ?? []), t.tag]
                          set({ tags: next.length ? next : undefined })
                        }}
                      />
                      {t.tag}
                      <em>{t.count}</em>
                    </label>
                  )
                })}
                {!shownTags.length && <p className="fpanel-empty">{tags.length ? 'No tags match.' : 'No tags yet. Add some from an asset or a selection.'}</p>}
              </div>
              {(query.tags?.length ?? 0) > 1 && <p className="fpanel-note">Showing assets with every selected tag.</p>}
            </>
          )}
        </Chip>
        <Chip label="Status" count={query.status?.length}>
          {() => <Checks options={['ready', 'active', 'failed'] as const} value={query.status} labels={STATUS_LABEL} onChange={(status) => set({ status: status.length ? status : undefined })} />}
        </Chip>
        <Chip label={query.date ? DATE_LABEL[query.date] : 'Date added'} count={query.date ? 1 : 0}>
          {(close) => (
            <>
              {(['', '1d', '7d', '30d', '365d'] as const).map((d) => (
                <label key={d || 'any'} className="fopt">
                  <input
                    type="radio"
                    name="date"
                    checked={(query.date ?? '') === d}
                    onChange={() => {
                      set({ date: d || undefined })
                      close()
                    }}
                  />
                  {d ? DATE_LABEL[d] : 'Any time'}
                </label>
              ))}
            </>
          )}
        </Chip>

        {filtered && (
          <>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => go({ folder: query.folder, collection: query.collection, sort: query.sort === 'relevance' ? undefined : query.sort })}>
              Clear
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={onSave}>
              <Icon name="plus" size={14} /> Save search
            </button>
          </>
        )}

        <label className="lib-sort">
          <span className="sr-only">Sort by</span>
          <select className="select select-sm" value={sort} onChange={(e) => set({ sort: e.target.value as Sort })}>
            {(Object.keys(SORT_LABEL) as Sort[])
              .filter((s) => s !== 'relevance' || query.q)
              .map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
          </select>
        </label>
      </div>
    </div>
  )
}
