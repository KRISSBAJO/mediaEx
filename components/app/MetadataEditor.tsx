'use client'

/** Fill in a workspace's custom fields for one asset. Text saves when you leave the box; choices save at once. */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { MediaAsset, MetadataField } from '@/lib/media/types'
import { useLibrary } from './library'
import { useMedia } from './media'

function FieldInput({ field, value, onSave }: { field: MetadataField; value: unknown; onSave: (v: unknown) => void }) {
  const [draft, setDraft] = useState(value === undefined || value === null ? '' : String(value))
  // follow changes made elsewhere (another tab, a bulk edit) unless you're typing
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(value === undefined || value === null ? '' : String(value))
  }, [value, editing])
  const commit = () => {
    setEditing(false)
    const current = value === undefined || value === null ? '' : String(value)
    if (draft.trim() === current) return
    onSave(field.type === 'number' ? (draft.trim() === '' ? null : Number(draft)) : draft.trim() || null)
  }
  const common = {
    id: `f-${field.id}`,
    onFocus: () => setEditing(true),
    onBlur: commit,
    'aria-required': field.required || undefined,
  }

  switch (field.type) {
    case 'longtext':
      return <textarea className="textarea" rows={3} maxLength={5000} value={draft} onChange={(e) => setDraft(e.target.value)} {...common} />
    case 'number':
      return (
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          {...common}
        />
      )
    case 'date':
      return <input className="input" type="date" id={common.id} value={draft} onChange={(e) => onSave(e.target.value || null)} />
    case 'select':
      return (
        <select className="select" id={common.id} value={typeof value === 'string' ? value : ''} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )
    case 'multiselect': {
      const set = new Set(Array.isArray(value) ? (value as string[]) : [])
      return (
        <div className="meta-multi" role="group" aria-labelledby={`l-${field.id}`}>
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={set.has(o)}
              className={set.has(o) ? 'is-on' : ''}
              onClick={() => onSave(set.has(o) ? [...set].filter((x) => x !== o) : [...set, o])}
            >
              {o}
            </button>
          ))}
        </div>
      )
    }
    default:
      return (
        <input
          className="input"
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          {...common}
        />
      )
  }
}

export default function MetadataEditor({ asset }: { asset: MediaAsset }) {
  const { fields, ready } = useLibrary()
  const { update } = useMedia()
  if (!ready) return null
  if (!fields.length) {
    return (
      <p className="meta-empty">
        No custom fields yet. <Link href="/dashboard/settings?tab=metadata">Add fields</Link> like client, licence or shoot date, and fill them in here.
      </p>
    )
  }
  return (
    <div className="meta-fields">
      {fields.map((f) => {
        const value = asset.metadata?.[f.id]
        const missing = f.required && (value === undefined || value === null || (Array.isArray(value) && !value.length))
        return (
          <div key={f.id} className="field-d">
            <label id={`l-${f.id}`} htmlFor={`f-${f.id}`}>
              {f.label}
              {f.required && <b className="meta-req" title="Required">*</b>}
            </label>
            <FieldInput field={f} value={value} onSave={(v) => void update(asset.id, { metadata: { [f.id]: v } })} />
            {missing ? <small className="is-bad">Required — fill this in.</small> : f.help ? <small>{f.help}</small> : null}
          </div>
        )
      })}
    </div>
  )
}
