'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FIELD_TYPE_LABEL, normaliseTag } from '@/lib/media/types'
import Icon from '../Icon'
import { flatTree, useLibrary } from '../library'

/** The shell every dialog uses: scrim, focus on open, Escape and click-outside to close. */
export function Dialog({ title, sub, onClose, children, foot, onSubmit, wide }: {
  title: string
  sub?: React.ReactNode
  onClose: () => void
  children?: React.ReactNode
  foot: React.ReactNode
  onSubmit?: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit?.()
        }}
      >
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-foot">{foot}</div>
      </form>
    </div>
  )
}

/** Ask for a name (new folder, rename, new collection, save search). */
export function NameDialog({ title, sub, label, initial = '', action, onClose, onSave }: {
  title: string
  sub?: string
  label: string
  initial?: string
  action: string
  onClose: () => void
  onSave: (name: string) => Promise<boolean | unknown>
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={title}
      sub={sub}
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim() || busy) return
        setBusy(true)
        const ok = await onSave(name.trim())
        setBusy(false)
        if (ok) onClose()
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim() || busy}>
            {busy ? 'Saving…' : action}
          </button>
        </>
      }
    >
      <label className="field-d">
        <span>{label}</span>
        <input className="input" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      </label>
    </Dialog>
  )
}

/** Choose a folder (or no folder). `exclude` hides a folder and everything inside it (when moving a folder). */
export function FolderPicker({ value, onChange, exclude }: { value: string | null; onChange: (id: string | null) => void; exclude?: string }) {
  const { folders } = useLibrary()
  const rows = useMemo(() => {
    const all = flatTree(folders)
    if (!exclude) return all
    const banned = new Set<string>([exclude])
    for (const r of all) if (r.folder.parentId && banned.has(r.folder.parentId)) banned.add(r.folder.id)
    return all.filter((r) => !banned.has(r.folder.id))
  }, [folders, exclude])
  return (
    <div className="picker" role="listbox" aria-label="Folders">
      <button type="button" role="option" aria-selected={value === null} className={value === null ? 'is-on' : ''} onClick={() => onChange(null)}>
        <Icon name="grid" size={15} /> No folder
      </button>
      {rows.map(({ folder, depth }) => (
        <button
          key={folder.id}
          type="button"
          role="option"
          aria-selected={value === folder.id}
          className={value === folder.id ? 'is-on' : ''}
          style={{ paddingLeft: 12 + depth * 18 }}
          onClick={() => onChange(folder.id)}
        >
          <Icon name="library" size={15} /> {folder.name}
          <em>{folder.assetCount}</em>
        </button>
      ))}
      {!rows.length && <p className="picker-empty">No folders yet.</p>}
    </div>
  )
}

export function MoveDialog({ count, initial = null, onClose, onMove }: { count: number; initial?: string | null; onClose: () => void; onMove: (folderId: string | null) => Promise<boolean> }) {
  const { createFolder } = useLibrary()
  const [target, setTarget] = useState<string | null>(initial)
  const [newName, setNewName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={`Move ${count === 1 ? 'asset' : `${count} assets`}`}
      sub="Pick a folder. Assets live in one folder at a time; collections are for grouping across folders."
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true)
        if (await onMove(target)) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? 'Moving…' : 'Move here'}
          </button>
        </>
      }
    >
      <FolderPicker value={target} onChange={setTarget} />
      {newName === null ? (
        <button type="button" className="btn btn-quiet btn-sm picker-new" onClick={() => setNewName('')}>
          <Icon name="plus" size={14} /> New folder{target ? ' inside the selected one' : ''}
        </button>
      ) : (
        <div className="inline-form">
          <input className="input" autoFocus placeholder="Folder name" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!newName.trim()}
            onClick={async () => {
              const f = await createFolder(newName.trim(), target)
              if (f) {
                setTarget(f.id)
                setNewName(null)
              }
            }}
          >
            Create
          </button>
        </div>
      )}
    </Dialog>
  )
}

export function CollectDialog({ count, onClose, onPick }: { count: number; onClose: () => void; onPick: (collectionId: string) => Promise<boolean> }) {
  const { collections, createCollection } = useLibrary()
  const [target, setTarget] = useState<string | null>(collections[0]?.id ?? null)
  const [newName, setNewName] = useState<string | null>(collections.length ? null : '')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={`Add ${count === 1 ? 'asset' : `${count} assets`} to a collection`}
      sub="Collections group assets from any folder — a shortlist, a client delivery, a campaign."
      onClose={onClose}
      onSubmit={async () => {
        if (busy) return
        setBusy(true)
        let id = target
        if (newName !== null) {
          if (!newName.trim()) return setBusy(false)
          id = (await createCollection(newName.trim()))?.id ?? null
        }
        if (id && (await onPick(id))) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (newName !== null ? !newName.trim() : !target)}>
            {busy ? 'Adding…' : newName !== null ? 'Create and add' : 'Add'}
          </button>
        </>
      }
    >
      {collections.length > 0 && newName === null && (
        <div className="picker" role="listbox" aria-label="Collections">
          {collections.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={target === c.id} className={target === c.id ? 'is-on' : ''} onClick={() => setTarget(c.id)}>
              <Icon name="layers" size={15} /> {c.name}
              <em>{c.assetCount}</em>
            </button>
          ))}
        </div>
      )}
      {newName === null ? (
        <button type="button" className="btn btn-quiet btn-sm picker-new" onClick={() => setNewName('')}>
          <Icon name="plus" size={14} /> New collection
        </button>
      ) : (
        <label className="field-d">
          <span>New collection</span>
          <input className="input" autoFocus placeholder="e.g. Client picks" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
        </label>
      )}
    </Dialog>
  )
}

/** Type a tag, pick from tags already in use, Enter or comma to add. */
export function TagInput({ value, onChange, autoFocus }: { value: string[]; onChange: (tags: string[]) => void; autoFocus?: boolean }) {
  const { tags } = useLibrary()
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const t = normaliseTag(text)
  const suggestions = tags.filter((x) => !value.includes(x.tag) && (!t || x.tag.includes(t))).slice(0, 6)
  const add = (tag: string) => {
    const n = normaliseTag(tag)
    if (n && !value.includes(n)) onChange([...value, n])
    setText('')
    input.current?.focus()
  }
  return (
    <div className="taginput">
      <div className="taginput-box" onClick={() => input.current?.focus()}>
        {value.map((x) => (
          <span key={x} className="tagchip">
            {x}
            <button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(value.filter((y) => y !== x))}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={text}
          autoFocus={autoFocus}
          placeholder={value.length ? '' : 'Type a tag and press Enter'}
          aria-label="Add a tag"
          onChange={(e) => setText(e.target.value.replace(',', ''))}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && t) {
              e.preventDefault()
              add(t)
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="taginput-suggest">
          {suggestions.map((s) => (
            <button key={s.tag} type="button" onClick={() => add(s.tag)}>
              {s.tag} <em>{s.count}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TagDialog({ count, mode, onClose, onApply }: { count: number; mode: 'tag' | 'untag'; onClose: () => void; onApply: (tags: string[]) => Promise<boolean> }) {
  const [value, setValue] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={`${mode === 'tag' ? 'Add tags to' : 'Remove tags from'} ${count === 1 ? 'asset' : `${count} assets`}`}
      sub={mode === 'tag' ? 'Tags are lowercase; spaces become dashes. Each asset keeps up to 20.' : 'Pick the tags to take off.'}
      onClose={onClose}
      onSubmit={async () => {
        if (!value.length || busy) return
        setBusy(true)
        if (await onApply(value)) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!value.length || busy}>
            {busy ? 'Saving…' : mode === 'tag' ? 'Add tags' : 'Remove tags'}
          </button>
        </>
      }
    >
      <TagInput value={value} onChange={setValue} autoFocus />
    </Dialog>
  )
}

export function ConfirmDialog({ title, sub, action, danger, onClose, onConfirm }: {
  title: string
  sub: React.ReactNode
  action: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => Promise<boolean | unknown>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={title}
      sub={sub}
      onClose={onClose}
      onSubmit={async () => {
        setBusy(true)
        if (await onConfirm()) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button type="submit" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? 'Working…' : action}
          </button>
        </>
      }
    />
  )
}

/** Set one custom field on many assets at once. Leaving it empty clears the field. */
export function MetaDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (field: string, value: unknown) => Promise<boolean> }) {
  const { fields } = useLibrary()
  const [id, setId] = useState(fields[0]?.id ?? '')
  const [value, setValue] = useState('')
  const [multi, setMulti] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const field = fields.find((f) => f.id === id)
  const parsed = !field ? null : field.type === 'multiselect' ? multi : field.type === 'number' ? (value.trim() ? Number(value) : null) : value.trim() || null
  return (
    <Dialog
      title={`Set a field on ${count === 1 ? '1 asset' : `${count} assets`}`}
      sub="Replaces the current value on every selected asset. Leave it empty to clear the field."
      onClose={onClose}
      onSubmit={async () => {
        if (!field || busy) return
        setBusy(true)
        if (await onApply(field.id, parsed)) onClose()
        setBusy(false)
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!field || busy}>
            {busy ? 'Saving…' : 'Apply'}
          </button>
        </>
      }
    >
      <label className="field-d">
        <span>Field</span>
        <select
          className="select"
          value={id}
          onChange={(e) => {
            setId(e.target.value)
            setValue('')
            setMulti([])
          }}
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} · {FIELD_TYPE_LABEL[f.type]}
            </option>
          ))}
        </select>
      </label>
      {field && (
        <label className="field-d">
          <span>Value</span>
          {field.type === 'select' ? (
            <select className="select" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">— clear —</option>
              {field.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : field.type === 'multiselect' ? (
            <div className="meta-multi">
              {field.options.map((o) => (
                <button key={o} type="button" aria-pressed={multi.includes(o)} className={multi.includes(o) ? 'is-on' : ''} onClick={() => setMulti((m) => (m.includes(o) ? m.filter((x) => x !== o) : [...m, o]))}>
                  {o}
                </button>
              ))}
            </div>
          ) : field.type === 'longtext' ? (
            <textarea className="textarea" rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input className="input" type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </label>
      )}
    </Dialog>
  )
}
