'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isActive, parseQuery, queryParams, type AssetPage, type SearchQuery } from '@/lib/media/types'
import { bytes, duration as fmtDuration } from '@/lib/sample'
import Icon from '../Icon'
import { request, useLibrary } from '../library'
import JobPanel from '../library-ui/JobPanel'
import Filters from '../library-ui/Filters'
import Preview from '../library-ui/Preview'
import LibrarySidebar, { DRAG_TYPE } from '../library-ui/Sidebar'
import { CollectDialog, ConfirmDialog, MetaDialog, MoveDialog, NameDialog, TagDialog } from '../library-ui/dialogs'
import { Ago, dims, useMedia } from '../media'
import { Card, ModerationBadge, StatusBadge, Thumb, TypeIcon, toast } from '../ui'

type Dialog = 'move' | 'collect' | 'tag' | 'untag' | 'meta' | 'delete' | 'save' | 'new-folder' | null

function useView() {
  const [view, setView] = useState<'grid' | 'list'>('grid')
  useEffect(() => {
    try {
      const v = localStorage.getItem('mx-library-view')
      if (v === 'grid' || v === 'list') setView(v)
    } catch {
      /* private mode: grid it is */
    }
  }, [])
  const set = (v: 'grid' | 'list') => {
    setView(v)
    try {
      localStorage.setItem('mx-library-view', v)
    } catch {
      /* fine */
    }
  }
  return [view, set] as const
}

export default function Library() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const paramString = params.toString()
  const query = useMemo(() => parseQuery(new URLSearchParams(paramString)), [paramString])
  const media = useMedia()
  const lib = useLibrary()

  /* ------------------------------------------------ where we are: the URL is the state */
  const go = useCallback(
    (q: SearchQuery) => {
      const qs = queryParams(q).toString()
      const href = `${pathname}${qs ? `?${qs}` : ''}`
      // moving between places is history; refining a search isn't
      const moved = q.folder !== query.folder || q.collection !== query.collection
      if (moved) router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, query.folder, query.collection, router],
  )

  /* ------------------------------------------------ results, from the server, kept fresh by the polled asset list */
  const goToPage = (direction: 'after' | 'before', cursor: string) => {
    const next = queryParams(query)
    next.set(direction, cursor)
    router.push(`${pathname}?${next}`, { scroll: false })
  }
  const hasCursor = params.has('after') || params.has('before')
  const [result, setResult] = useState<{ query: string; page: AssetPage | null; error: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const search = useCallback(async () => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    try {
      const searchParams = new URLSearchParams(paramString)
      searchParams.set('view', 'page')
      const page = await request<AssetPage>(`/api/assets?${searchParams}`, { signal: controller.signal })
      if (!controller.signal.aborted) setResult({ query: paramString, page, error: '' })
    } catch (e) {
      if (!controller.signal.aborted) {
        const error = e instanceof Error ? e.message : 'Please try again.'
        setResult(previous => ({ query: paramString, page: previous?.query === paramString ? previous.page : null, error }))
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setLoading(false)
      }
    }
  }, [paramString])
  useEffect(() => () => {
    pending.current?.abort()
    pending.current = null
  }, [paramString])
  useEffect(() => {
    const timer = setTimeout(search, 120)
    return () => clearTimeout(timer)
  }, [search, media.assets])
  const current = result?.query === paramString ? result : null
  const page = current?.page
  const found = page?.assets ?? null
  const searchError = current?.error
  // the polled list has the freshest status for anything still processing
  const list = useMemo(() => (found ?? []).map((a) => media.get(a.id) ?? a), [found, media])

  /* ------------------------------------------------ selection and preview */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [jobId,setJobId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [view, setView] = useView()

  // forget selections that left the view; close a preview whose asset is gone
  useEffect(() => {
    const visible = new Set(list.map((a) => a.id))
    setSelected((s) => (([...s].every((x) => visible.has(x)) ? s : new Set([...s].filter((x) => visible.has(x))))))
  }, [list])
  const previewed = list.find(asset => asset.id === preview)
  useEffect(() => {
    if (found && preview && !previewed) setPreview(null)
  }, [found, preview, previewed])
  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
    setPreview(null)
    setDialog(null)
  }, [paramString])

  const toggle = (id: string, range: boolean) => {
    setSelected((s) => {
      const next = new Set(s)
      if (range && anchor) {
        const a = list.findIndex((x) => x.id === anchor)
        const b = list.findIndex((x) => x.id === id)
        if (a >= 0 && b >= 0) {
          for (const x of list.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x.id)
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchor(id)
  }
  const ids = list.filter(asset => selected.has(asset.id)).map(asset => asset.id)
  const selecting = ids.length > 0

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dialog || (e.target as HTMLElement)?.closest('input, textarea, select, [role=dialog]')) return
      if (preview) setPreview(null)
      else if (selecting) setSelected(new Set())
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [preview, selecting, dialog])

  const done = (msg: string) => {
    toast(msg)
    setSelected(new Set())
    return true
  }
  const n = (k: number) => `${k} ${k === 1 ? 'asset' : 'assets'}`

  /* ------------------------------------------------ drag assets onto folders and collections */
  const onDropAssets = async (target: { folderId: string | null } | { collectionId: string }, dragged: string[]) => {
    if ('collectionId' in target) {
      const c = lib.collections.find((x) => x.id === target.collectionId)
      if (await lib.collect(target.collectionId, dragged)) done(`Added ${n(dragged.length)} to ${c?.name ?? 'the collection'}`)
    } else {
      const f = lib.folders.find((x) => x.id === target.folderId)
      if (await lib.bulk(dragged, { action: 'move', folderId: target.folderId })) done(`Moved ${n(dragged.length)} to ${f?.name ?? 'no folder'}`)
    }
  }
  const dragStart = (e: React.DragEvent, id: string) => {
    const moving = selected.has(id) ? ids : [id]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(moving))
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    ghost.textContent = moving.length === 1 ? (list.find((a) => a.id === id)?.title ?? '1 asset') : `${moving.length} assets`
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 12, 12)
    setTimeout(() => ghost.remove())
  }

  /* ------------------------------------------------ where am I */
  const folder = query.folder && query.folder !== 'root' ? lib.folders.find((f) => f.id === query.folder) : undefined
  const collection = query.collection ? lib.collections.find((c) => c.id === query.collection) : undefined
  const path = folder ? lib.folderPath(folder.id) : []
  const title = collection?.name ?? folder?.name ?? (query.folder === 'root' ? 'Not in a folder' : 'Library')
  const filtered = Boolean(query.published || query.missingField || query.q || query.type?.length || query.status?.length || query.tags?.length || query.date || Object.keys(query.meta ?? {}).length)
  const sub = !page ? 'Loading…' : `${page.total.toLocaleString()} ${filtered ? (page.total === 1 ? 'match' : 'matches') : (page.total === 1 ? 'asset' : 'assets')} · ${bytes(page.bytes)}${collection?.description ? ` · ${collection.description}` : ''}`

  return (
    <>
      <div className="page-head lib-head">
        <div>
          {(path.length > 1 || collection || folder || query.folder === 'root') && (
            <nav className="lib-crumbs" aria-label="Folder path">
              <button type="button" onClick={() => go({ sort: query.sort })}>
                Library
              </button>
              {collection && <span>Collections</span>}
              {path.slice(0, -1).map((f) => (
                <button key={f.id} type="button" onClick={() => go({ folder: f.id, sort: query.sort })}>
                  {f.name}
                </button>
              ))}
            </nav>
          )}
          <h1>{title}</h1>
          {(!searchError || found !== null) && <p>{sub}</p>}
        </div>
        <div className="page-actions">
          {!collection && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('new-folder')}>
              <Icon name="plus" size={15} /> New folder
            </button>
          )}
          <Link href={`/dashboard/uploads${folder ? `?folder=${folder.id}` : ''}`} className="btn btn-primary btn-sm">
            <Icon name="upload" size={15} /> Upload{folder ? ' here' : ''}
          </Link>
        </div>
      </div>

      <div className={`lib ${preview ? 'has-preview' : ''}`}>
        <LibrarySidebar query={query} go={go} onDropAssets={onDropAssets} />

        <section className="lib-main" aria-label="Assets">
          {jobId && <JobPanel id={jobId} onClose={()=>setJobId(null)} />}
          <Filters query={query} go={go} onSave={() => setDialog('save')} />
          {searchError && (
            <div className="banner is-bad" role="alert">
              <Icon name="alert" />
              <div><b>{found === null ? 'Couldn’t load library results.' : 'Couldn’t refresh library results.'}</b> {searchError}</div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={search}>Retry</button>
            </div>
          )}

          <div className={`lib-bar ${selecting ? 'is-selecting' : ''}`} role={selecting ? 'toolbar' : undefined} aria-label={selecting ? 'Selected assets' : undefined}>
            {selecting ? (
              <>
                <button type="button" className="icon-btn is-quiet" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                  <Icon name="x" size={16} />
                </button>
                <b>{ids.length} selected</b>
                {ids.length < list.length && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSelected(new Set(list.map((a) => a.id)))}>
                    Select {list.length} on this page
                  </button>
                )}
                <span className="grow" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('move')}>
                  <Icon name="library" size={14} /> Move
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('collect')}>
                  <Icon name="layers" size={14} /> Collect
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('tag')}>
                  <Icon name="plus" size={14} /> Tag
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('untag')}>
                  Untag
                </button>
                {lib.fields.length > 0 && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('meta')}>
                    Set field
                  </button>
                )}
                {collection && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={async () => (await lib.collect(collection.id, ids, true)) && done(`Removed ${n(ids.length)} from ${collection.name}`)}
                  >
                    Remove from collection
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-sm is-danger" onClick={() => setDialog('delete')}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              </>
            ) : (
              <>
                <span className="lib-count">{loading && found !== null ? 'Searching…' : !page ? '' : `Showing ${list.length} of ${n(page.total)}`}</span>
                <span className="grow" />
                <div className="seg seg-icon" role="group" aria-label="Layout">
                  <button type="button" aria-label="Grid" aria-pressed={view === 'grid'} className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')}>
                    <Icon name="grid" size={16} />
                  </button>
                  <button type="button" aria-label="List" aria-pressed={view === 'list'} className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')}>
                    <Icon name="list" size={16} />
                  </button>
                </div>
              </>
            )}
          </div>

          {hasCursor && found !== null && !list.length ? (
            <div className="empty"><p>This page no longer has any assets.</p></div>
          ) : found !== null && list.length === 0 ? (
            <Card>
              <div className="empty">
                <Icon name={filtered ? 'search' : collection ? 'layers' : 'library'} size={22} />
                <b>{filtered ? 'Nothing matches' : collection ? 'This collection is empty' : folder ? 'This folder is empty' : query.folder === 'root' ? 'No unfiled assets' : 'Your library is empty'}</b>
                <p>
                  {filtered
                    ? 'Try fewer words, or clear a filter.'
                    : collection
                      ? 'Select assets anywhere in the library and choose Collect, or drag them onto the collection.'
                      : folder
                        ? 'Drag assets onto this folder in the list, or upload straight into it.'
                        : 'Upload a video, audio file or image, or create a folder or collection to organize your media.'}
                </p>
                {filtered ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ folder: query.folder, collection: query.collection })}>
                    Clear filters
                  </button>
                ) : folder ? (
                  <Link href={`/dashboard/uploads?folder=${folder.id}`} className="btn btn-ghost btn-sm">
                    Upload into {folder.name}
                  </Link>
                ) : !collection && (
                  <Link href="/dashboard/uploads" className="btn btn-primary btn-sm">Upload files</Link>
                )}
              </div>
            </Card>
          ) : view === 'grid' ? (
            <>
            <div className={`asset-grid ${selecting ? 'is-selecting' : ''}`}>
              {list.map((a) => {
                const on = selected.has(a.id)
                return (
                  <div
                    key={a.id}
                    className={`asset-card ${on ? 'is-selected' : ''} ${preview === a.id ? 'is-previewed' : ''}`}
                    draggable
                    onDragStart={(e) => dragStart(e, a.id)}
                    tabIndex={0}
                    role="button"
                    aria-pressed={on}
                    aria-label={`${a.title}, ${a.type}`}
                    onClick={(e) => {
                      if (e.shiftKey || e.metaKey || e.ctrlKey || selecting) toggle(a.id, e.shiftKey)
                      else setPreview(a.id)
                    }}
                    onDoubleClick={() => router.push(`/dashboard/library/${a.id}`)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter') setPreview(a.id)
                      if (e.key === ' ') (e.preventDefault(), toggle(a.id, e.shiftKey))
                    }}
                  >
                    <div className="asset-card-media">
                      <Thumb asset={a} />
                      <label className="asset-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={on} onChange={(e) => toggle(a.id, (e.nativeEvent as MouseEvent).shiftKey)} aria-label={`Select ${a.title}`} />
                      </label>
                    </div>
                    <div className="asset-card-body">
                      <b>{a.title}</b>
                      <div className="asset-card-meta">
                        <span>
                          <TypeIcon type={a.type} />
                          {a.type === 'image' ? dims(a) : a.duration > 0 ? fmtDuration(Math.round(a.duration)) : a.type === 'audio' ? 'Audio' : 'Video'}
                        </span>
                        {a.status === 'ready' && a.moderation !== 'approved' ? (
                          <ModerationBadge state={a.moderation} />
                        ) : a.status === 'ready' ? (
                          <span className="muted">
                            <Ago iso={a.createdAt} />
                          </span>
                        ) : (
                          <StatusBadge status={a.status} progress={isActive(a) ? a.progress : undefined} />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="lib-hint">Click a card to preview it, double-click to open it. Shift or Ctrl-click to select several, then drag them onto a folder.</p>
            </>
          ) : (
            <Card flush>
              <div className="table-wrap">
                <table className="table lib-table">
                  <thead>
                    <tr>
                      <th className="check-col">
                        <input
                          type="checkbox"
                          aria-label="Select all assets on this page"
                          checked={selecting && selected.size === list.length}
                          ref={(el) => {
                            if (el) el.indeterminate = selecting && selected.size < list.length
                          }}
                          onChange={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((a) => a.id)))}
                        />
                      </th>
                      <th>Asset</th>
                      <th>Status</th>
                      <th>Tags</th>
                      <th className="num">Duration</th>
                      <th className="num">Size</th>
                      <th className="num">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} className={`${selected.has(a.id) ? 'is-selected' : ''} ${preview === a.id ? 'is-previewed' : ''}`} draggable onDragStart={(e) => dragStart(e, a.id)}>
                        <td className="check-col">
                          <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => toggle(a.id, (e.nativeEvent as MouseEvent).shiftKey)} aria-label={`Select ${a.title}`} />
                        </td>
                        <td>
                          <button type="button" className="asset-cell" onClick={() => setPreview(a.id)} onDoubleClick={() => router.push(`/dashboard/library/${a.id}`)}>
                            <Thumb asset={a} />
                            <span>
                              <b>{a.title}</b>
                              <small>
                                <TypeIcon type={a.type} />
                                {a.sourceInfo ?? a.fileName}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          {a.status === 'ready' && a.moderation !== 'approved' ? <ModerationBadge state={a.moderation} /> : <StatusBadge status={a.status} progress={isActive(a) ? a.progress : undefined} />}
                        </td>
                        <td className="tag-cell">{a.tags.length ? a.tags.slice(0, 3).join(', ') + (a.tags.length > 3 ? ` +${a.tags.length - 3}` : '') : <span className="muted">—</span>}</td>
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
          {(page?.previous || page?.next || hasCursor) && (
            <nav className="lib-bar" aria-label="Library pages">
              {(searchError || !list.length) && hasCursor && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(query)}>First page</button>}
              <button type="button" className="btn btn-ghost btn-sm" disabled={!page?.previous} onClick={() => page?.previous && goToPage('before', page.previous)}>Previous</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!page?.next} onClick={() => page?.next && goToPage('after', page.next)}>Next</button>
            </nav>
          )}
        </section>

        {previewed && <Preview asset={previewed} onClose={() => setPreview(null)} />}
      </div>

      {dialog === 'move' && (
        <MoveDialog
          count={ids.length}
          initial={folder?.id ?? null}
          onClose={() => setDialog(null)}
          onMove={async (folderId) => (await lib.bulk(ids, { action: 'move', folderId })) && done(`Moved ${n(ids.length)} to ${lib.folders.find((f) => f.id === folderId)?.name ?? 'no folder'}`)}
        />
      )}
      {dialog === 'collect' && (
        <CollectDialog
          count={ids.length}
          onClose={() => setDialog(null)}
          onPick={async (cid) => (await lib.collect(cid, ids)) && done(`Added ${n(ids.length)} to ${lib.collections.find((c) => c.id === cid)?.name ?? 'the collection'}`)}
        />
      )}
      {(dialog === 'tag' || dialog === 'untag') && (
        <TagDialog
          count={ids.length}
          mode={dialog}
          onClose={() => setDialog(null)}
          onApply={async (tags) => (await lib.bulk(ids, { action: dialog, tags })) && done(`${dialog === 'tag' ? 'Tagged' : 'Untagged'} ${n(ids.length)}`)}
        />
      )}
      {dialog === 'meta' && (
        <MetaDialog
          count={ids.length}
          onClose={() => setDialog(null)}
          onApply={async (field,value) => {
            try {
              const result=await request<{job:string}>('/api/assets/jobs',{method:'POST',json:{ids,field,value}})
              setJobId(result.job)
              setDialog(null)
              return true
            } catch (e) { toast(e instanceof Error?e.message:'Could not preview the edit.'); return false }
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={`Move ${n(ids.length)} to Trash?`}
          sub="Workspace owners and admins can restore completed uploads from Trash for 30 days. Incomplete uploads are canceled."
          action="Move to Trash"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => (await lib.bulk(ids, { action: 'delete' })) && done(`Moved ${n(ids.length)} to Trash`)}
        />
      )}
      {dialog === 'save' && (
        <NameDialog
          title="Save this search"
          sub="It appears under Saved searches in the library. Only you can see it."
          label="Name"
          initial={query.q ?? query.tags?.join(', ') ?? ''}
          action="Save search"
          onClose={() => setDialog(null)}
          onSave={(name) => lib.saveSearch(name, query)}
        />
      )}
      {dialog === 'new-folder' && (
        <NameDialog
          title="New folder"
          sub={folder ? `Inside ${path.map((f) => f.name).join(' / ')}.` : 'At the top of your library.'}
          label="Name"
          action="Create folder"
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const f = await lib.createFolder(name, folder?.id ?? null)
            if (f) go({ folder: f.id, sort: query.sort })
            return Boolean(f)
          }}
        />
      )}
    </>
  )
}
