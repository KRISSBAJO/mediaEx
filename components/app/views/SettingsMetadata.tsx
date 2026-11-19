'use client'

import { useState } from 'react'
import { FIELD_TYPES, FIELD_TYPE_LABEL, type FieldType, type MetadataField } from '@/lib/media/types'
import { canManage, useAccount } from '../account'
import Icon from '../Icon'
import { useLibrary } from '../library'
import { ConfirmDialog, Dialog } from '../library-ui/dialogs'
import { Card } from '../ui'

const TYPE_HELP: Record<FieldType, string> = {
  text: 'One line, up to 500 characters — a client, a photographer, a licence ID.',
  longtext: 'Paragraphs, up to 5,000 characters — usage notes, a description.',
  number: 'Any number — a budget, a take, a rating.',
  date: 'A calendar date — shoot date, licence expiry.',
  select: 'Pick one of your options — status, region, licence type.',
  multiselect: 'Pick any of your options — channels, products.',
}

function FieldDialog({ field, onClose }: { field: MetadataField | null; onClose: () => void }) {
  const lib = useLibrary()
  const [label, setLabel] = useState(field?.label ?? '')
  const [type, setType] = useState<FieldType>(field?.type ?? 'text')
  const [options, setOptions] = useState((field?.options ?? []).join('\n'))
  const [required, setRequired] = useState(field?.required ?? false)
  const [help, setHelp] = useState(field?.help ?? '')
  const [busy, setBusy] = useState(false)
  const choices = type === 'select' || type === 'multiselect'
  const list = options
    .split(/\n|,/)
    .map((o) => o.trim())
    .filter(Boolean)
  const removed = field ? field.options.filter((o) => !list.includes(o)) : []

  return (
    <Dialog
      title={field ? `Edit “${field.label}”` : 'New field'}
      sub={field ? 'The type can’t change once a field exists. Renaming keeps every value.' : 'Fields appear on every asset in this workspace.'}
      onClose={onClose}
      onSubmit={async () => {
        if (!label.trim() || (choices && !list.length) || busy) return
        setBusy(true)
        const ok = await lib.saveField(field?.id ?? null, { label: label.trim(), type, options: choices ? list : undefined, required, help: help.trim() || null })
        setBusy(false)
        if (ok) onClose()
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !label.trim() || (choices && !list.length)}>
            {busy ? 'Saving…' : field ? 'Save' : 'Add field'}
          </button>
        </>
      }
    >
      <label className="field-d">
        <span>Name</span>
        <input className="input" autoFocus maxLength={60} placeholder="e.g. Client" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="field-d">
        <span>Type</span>
        <select className="select" value={type} disabled={!!field} onChange={(e) => setType(e.target.value as FieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <small>{TYPE_HELP[type]}</small>
      </label>
      {choices && (
        <label className="field-d">
          <span>Options</span>
          <textarea className="textarea" rows={4} placeholder={'One per line\nDraft\nIn review\nApproved'} value={options} onChange={(e) => setOptions(e.target.value)} />
          {removed.length > 0 ? (
            <small className="is-bad">Removing {removed.join(', ')} clears {removed.length === 1 ? 'it' : 'them'} from every asset.</small>
          ) : (
            <small>{list.length ? `${list.length} option${list.length === 1 ? '' : 's'}` : 'One per line, or separated by commas.'}</small>
          )}
        </label>
      )}
      <label className="field-d">
        <span>Hint</span>
        <input className="input" maxLength={200} placeholder="Shown under the field (optional)" value={help} onChange={(e) => setHelp(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <span>
          Required
          <small>Assets show a reminder until it’s filled in. Uploads aren’t blocked.</small>
        </span>
      </label>
    </Dialog>
  )
}

export default function SettingsMetadata() {
  const { workspace } = useAccount()
  const lib = useLibrary()
  const manage = canManage(workspace.role)
  const [editing, setEditing] = useState<MetadataField | 'new' | null>(null)
  const [deleting, setDeleting] = useState<MetadataField | null>(null)
  const move = (i: number, by: number) => {
    const ids = lib.fields.map((f) => f.id)
    const [x] = ids.splice(i, 1)
    ids.splice(i + by, 0, x)
    void lib.reorderFields(ids)
  }

  return (
    <div className="stack">
      <Card
        title="Metadata fields"
        meta={`${lib.fields.length} ${lib.fields.length === 1 ? 'field' : 'fields'}`}
        flush
        action={
          manage ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
              <Icon name="plus" size={14} /> Add field
            </button>
          ) : undefined
        }
        hint={manage ? 'Values are searchable, and dropdown fields become filters in the library.' : 'Only owners and admins can change fields. Everyone can fill them in.'}
      >
        {lib.fields.length ? (
          <ul className="rows meta-list">
            {lib.fields.map((f, i) => (
              <li key={f.id}>
                <span className="file-kind">
                  <Icon name={f.type === 'date' ? 'clock' : f.type === 'select' || f.type === 'multiselect' ? 'list' : 'file'} size={16} />
                </span>
                <div>
                  <b>
                    {f.label}
                    {f.required && <span className="chip">required</span>}
                  </b>
                  <small>
                    {FIELD_TYPE_LABEL[f.type]}
                    {f.options.length ? ` · ${f.options.slice(0, 4).join(', ')}${f.options.length > 4 ? ` +${f.options.length - 4}` : ''}` : ''} · <span className="mono">{f.key}</span>
                  </small>
                </div>
                {manage && (
                  <div className="meta-actions">
                    <button type="button" className="lib-rowmenu-btn" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="chevronDown" size={14} className="flip-y" />
                    </button>
                    <button type="button" className="lib-rowmenu-btn" aria-label={`Move ${f.label} down`} disabled={i === lib.fields.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="chevronDown" size={14} />
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(f)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm is-danger" onClick={() => setDeleting(f)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">
            <Icon name="list" size={22} />
            <b>No fields yet</b>
            <p>Add the details your team tracks — client, licence, shoot date, usage rights — and fill them in on every asset.</p>
          </div>
        )}
      </Card>

      {editing && <FieldDialog field={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.label}”?`}
          sub="Its value is removed from every asset. This can’t be undone."
          action="Delete field"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => lib.deleteField(deleting.id)}
        />
      )}
    </div>
  )
}
