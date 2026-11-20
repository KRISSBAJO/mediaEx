'use client'

import { useEffect, useRef, useState } from 'react'
import type { Folder, SearchQuery } from '@/lib/media/types'
import Icon from '../Icon'
import { useLibrary } from '../library'
import { useMedia } from '../media'
import { ConfirmDialog, Dialog, FolderPicker, NameDialog } from './dialogs'

export const DRAG_TYPE = 'application/x-mediaex-assets'

type Props = {
  query: SearchQuery
  go: (q: SearchQuery) => void
  onDropAssets: (target: { folderId: string | null } | { collectionId: string }, ids: string[]) => void
}

type Dialog =
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'move-folder'; folder: Folder }
  | { kind: 'delete-folder'; folder: Folder }
  | { kind: 'new-collection' }
  | { kind: 'rename-collection'; id: string; name: string }
  | { kind: 'delete-collection'; id: string; name: string }
  | null

/** A drop target that highlights while assets are dragged over it. */
function useDrop(onDrop: (ids: string[]) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false)
        const raw = e.dataTransfer.getData(DRAG_TYPE)
        if (!raw) return
        e.preventDefault()
        try {
          onDrop(JSON.parse(raw) as string[])
        } catch {
          /* not ours */
        }
      },
    },
  }
}

function RowMenu({ items }: { items: { label: string; icon: string; danger?: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="lib-rowmenu" ref={ref}>
      <button type="button" className="lib-rowmenu-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}>
        <Icon name="more" size={15} />
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'is-danger' : ''} onClick={(e) => (e.stopPropagation(), setOpen(false), it.run())}>
              <Icon name={it.icon} size={15} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FolderRow({ folder, depth, query, go, onDropAssets, setDialog, open, toggle }: {
  folder: Folder
  depth: number
  query: SearchQuery
  go: (q: SearchQuery) => void
  onDropAssets: Props['onDropAssets']
  setDialog: (d: Dialog) => void
  open: Set<string>
  toggle: (id: string) => void
}) {
  const { folders } = useLibrary()
  const kids = folders.filter((f) => f.parentId === folder.id).sort((a, b) => a.name.localeCompare(b.name))
  const drop = useDrop((ids) => onDropAssets({ folderId: folder.id }, ids))
  const active = query.folder === folder.id
  const expanded = open.has(folder.id)
  return (
    <>
      <div className={`lib-row ${active ? 'is-on' : ''} ${drop.over ? 'is-drop' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} {...drop.props}>
        <button type="button" className={`lib-caret ${kids.length ? '' : 'is-leaf'}`} aria-label={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded} onClick={() => toggle(folder.id)} tabIndex={kids.length ? 0 : -1}>
          <Icon name="chevron" size={13} />
        </button>
        <button type="button" className="lib-row-main" aria-current={active ? 'true' : undefined} onClick={() => go({ folder: folder.id, sort: query.sort })}>
          <Icon name="library" size={15} />
          <span>{folder.name}</span>
          <em>{folder.assetCount || ''}</em>
        </button>
        <RowMenu
          items={[
            { label: 'New folder inside', icon: 'plus', run: () => setDialog({ kind: 'new-folder', parentId: folder.id }) },
            { label: 'Rename', icon: 'settings', run: () => setDialog({ kind: 'rename-folder', folder }) },
            { label: 'Move', icon: 'arrowRight', run: () => setDialog({ kind: 'move-folder', folder }) },
            { label: 'Delete folder', icon: 'trash', danger: true, run: () => setDialog({ kind: 'delete-folder', folder }) },
          ]}
        />
      </div>
      {expanded &&
        kids.map((k) => <FolderRow key={k.id} folder={k} depth={depth + 1} query={query} go={go} onDropAssets={onDropAssets} setDialog={setDialog} open={open} toggle={toggle} />)}
    </>
  )
}

function CollectionRow({ id, name, count, active, onOpen, onDrop, setDialog }: {
  id: string
  name: string
  count: number
  active: boolean
  onOpen: () => void
  onDrop: (ids: string[]) => void
  setDialog: (d: Dialog) => void
}) {
  const drop = useDrop(onDrop)
  return (
    <div className={`lib-row ${active ? 'is-on' : ''} ${drop.over ? 'is-drop' : ''}`} {...drop.props}>
      <button type="button" className="lib-row-main" aria-current={active ? 'true' : undefined} onClick={onOpen}>
        <Icon name="layers" size={15} />
        <span>{name}</span>
        <em>{count || ''}</em>
      </button>
      <RowMenu
        items={[
          { label: 'Rename', icon: 'settings', run: () => setDialog({ kind: 'rename-collection', id, name }) },
          { label: 'Delete collection', icon: 'trash', danger: true, run: () => setDialog({ kind: 'delete-collection', id, name }) },
        ]}
      />
    </div>
  )
}

export default function LibrarySidebar({ query, go, onDropAssets }: Props) {
  const lib = useLibrary()
  const { summary } = useMedia()
  const [dialog, setDialog] = useState<Dialog>(null)
  // open the path to the current folder; remember what people expand
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!query.folder || query.folder === 'root') return
    const path = lib.folderPath(query.folder).slice(0, -1)
    if (path.length) setOpen((o) => new Set([...o, ...path.map((f) => f.id)]))
  }, [query.folder, lib])
  const toggle = (id: string) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])))

  const allActive = !query.folder && !query.collection
  const rootDrop = useDrop((ids) => onDropAssets({ folderId: null }, ids))
  const roots = lib.folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <nav className="lib-side" aria-label="Library locations">
      <div className="lib-group">
        <div className={`lib-row ${allActive ? 'is-on' : ''}`}>
          <button type="button" className="lib-row-main" aria-current={allActive ? 'true' : undefined} onClick={() => go({ sort: query.sort })}>
            <Icon name="grid" size={15} />
            <span>All assets</span>
            <em>{summary.total || ''}</em>
          </button>
        </div>
        <div className={`lib-row ${query.folder === 'root' ? 'is-on' : ''} ${rootDrop.over ? 'is-drop' : ''}`} {...rootDrop.props}>
          <button type="button" className="lib-row-main" aria-current={query.folder === 'root' ? 'true' : undefined} onClick={() => go({ folder: 'root', sort: query.sort })} title="Assets that aren’t in any folder">
            <Icon name="file" size={15} />
            <span>Not in a folder</span>
            <em>{summary.unfiled || ''}</em>
          </button>
        </div>
      </div>

      <div className="lib-group">
        <div className="lib-group-head">
          <span className="overline">Folders</span>
          <button type="button" className="lib-add" aria-label="New folder" title="New folder" onClick={() => setDialog({ kind: 'new-folder', parentId: null })}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {roots.map((f) => (
          <FolderRow key={f.id} folder={f} depth={0} query={query} go={go} onDropAssets={onDropAssets} setDialog={setDialog} open={open} toggle={toggle} />
        ))}
        {lib.ready && !roots.length && <p className="lib-empty">Folders keep assets tidy. Drag assets onto one to move them.</p>}
      </div>

      <div className="lib-group">
        <div className="lib-group-head">
          <span className="overline">Collections</span>
          <button type="button" className="lib-add" aria-label="New collection" title="New collection" onClick={() => setDialog({ kind: 'new-collection' })}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {lib.collections.map((c) => (
          <CollectionRow
            key={c.id}
            id={c.id}
            name={c.name}
            count={c.assetCount}
            active={query.collection === c.id}
            onOpen={() => go({ collection: c.id, sort: query.sort })}
            onDrop={(ids) => onDropAssets({ collectionId: c.id }, ids)}
            setDialog={setDialog}
          />
        ))}
        {lib.ready && !lib.collections.length && <p className="lib-empty">Group assets from any folder — a shortlist or a client delivery.</p>}
      </div>

      {lib.searches.length > 0 && (
        <div className="lib-group">
          <div className="lib-group-head">
            <span className="overline">Saved searches</span>
          </div>
          {lib.searches.map((s) => (
            <div key={s.id} className="lib-row">
              <button type="button" className="lib-row-main" onClick={() => go(s.query)}>
                <Icon name="search" size={15} />
                <span>{s.name}</span>
              </button>
              <button type="button" className="lib-rowmenu-btn" aria-label={`Delete saved search ${s.name}`} title="Delete" onClick={() => void lib.deleteSearch(s.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {dialog?.kind === 'new-folder' && (
        <NameDialog
          title="New folder"
          sub={dialog.parentId ? `Inside ${lib.folderPath(dialog.parentId).map((f) => f.name).join(' / ')}.` : 'At the top of your library.'}
          label="Name"
          action="Create folder"
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const f = await lib.createFolder(name, dialog.parentId)
            if (f) {
              if (dialog.parentId) setOpen((o) => new Set([...o, dialog.parentId!]))
              go({ folder: f.id, sort: query.sort })
            }
            return Boolean(f)
          }}
        />
      )}
      {dialog?.kind === 'rename-folder' && (
        <NameDialog title="Rename folder" label="Name" initial={dialog.folder.name} action="Save" onClose={() => setDialog(null)} onSave={(name) => lib.renameFolder(dialog.folder.id, name)} />
      )}
      {dialog?.kind === 'move-folder' && (
        <MoveFolderDialog folder={dialog.folder} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          title={`Delete “${dialog.folder.name}”?`}
          sub="Nothing inside is deleted: its assets and folders move up one level."
          action="Delete folder"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const parent = dialog.folder.parentId
            const ok = await lib.deleteFolder(dialog.folder.id)
            if (ok && query.folder === dialog.folder.id) go({ folder: parent ?? undefined, sort: query.sort })
            return ok
          }}
        />
      )}
      {dialog?.kind === 'new-collection' && (
        <NameDialog
          title="New collection"
          sub="Then drag assets onto it, or use “Add to collection” on a selection."
          label="Name"
          action="Create collection"
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const c = await lib.createCollection(name)
            if (c) go({ collection: c.id, sort: query.sort })
            return Boolean(c)
          }}
        />
      )}
      {dialog?.kind === 'rename-collection' && (
        <NameDialog title="Rename collection" label="Name" initial={dialog.name} action="Save" onClose={() => setDialog(null)} onSave={(name) => lib.renameCollection(dialog.id, name)} />
      )}
      {dialog?.kind === 'delete-collection' && (
        <ConfirmDialog
          title={`Delete “${dialog.name}”?`}
          sub="Only the collection goes. Its assets stay in your library and their folders."
          action="Delete collection"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const ok = await lib.deleteCollection(dialog.id)
            if (ok && query.collection === dialog.id) go({ sort: query.sort })
            return ok
          }}
        />
      )}
    </nav>
  )
}

function MoveFolderDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const lib = useLibrary()
  const [target, setTarget] = useState<string | null>(folder.parentId)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={`Move “${folder.name}”`}
      sub="Choose its new parent folder, or no folder to put it at the top."
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true)
        if (await lib.moveFolder(folder.id, target)) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || target === folder.parentId}>
            {busy ? 'Moving…' : 'Move here'}
          </button>
        </>
      }
    >
      {/* the folder itself and everything inside it are left out */}
      <FolderPicker value={target} onChange={setTarget} exclude={folder.id} />
    </Dialog>
  )
}
