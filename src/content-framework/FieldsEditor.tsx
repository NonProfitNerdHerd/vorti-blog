'use client'
import { useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import type { TypeField } from '@design-system/payload-design-core/content'
import './framework.css'
const kinds = [
  'text',
  'textarea',
  'richText',
  'number',
  'date',
  'boolean',
  'select',
  'media',
  'url',
  'relationship',
  'eventSchedule',
] as const
export const FieldsEditor: JSONFieldClientComponent = ({ path, readOnly }) => {
  const { value = [], setValue } = useField<TypeField[]>({ path })
  const update = (index: number, patch: Partial<TypeField>) =>
    setValue(value.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  return (
    <section className="cf-editor">
      <h3>Content fields</h3>
      <p>
        Field IDs remain stable. Only fields marked public can appear in public views and Templates.
      </p>
      {value.map((field, i) => (
        <fieldset key={i} disabled={readOnly}>
          <legend>{field.label || 'New field'}</legend>
          <div className="cf-row">
            <label>
              Field ID
              <input value={field.id} onChange={(e) => update(i, { id: e.target.value })} />
            </label>
            <label>
              Label
              <input value={field.label} onChange={(e) => update(i, { label: e.target.value })} />
            </label>
            <label>
              Kind
              <select
                value={field.kind}
                onChange={(e) => update(i, { kind: e.target.value as TypeField['kind'] })}
              >
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Help text
            <input
              value={field.helpText || ''}
              onChange={(e) => update(i, { helpText: e.target.value })}
            />
          </label>
          <div className="cf-row">
            <label>
              <input
                type="checkbox"
                checked={!!field.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />{' '}
              Required
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!field.public}
                onChange={(e) => update(i, { public: e.target.checked })}
              />{' '}
              Public field
            </label>
          </div>
          {field.kind === 'select' && (
            <label>
              Options (one per line)
              <textarea
                value={(field.options || []).join('\n')}
                onChange={(e) => update(i, { options: e.target.value.split('\n') })}
              />
            </label>
          )}
          {field.kind === 'relationship' && (
            <label>
              Collection
              <select
                value={field.relationTo || 'posts'}
                onChange={(e) => update(i, { relationTo: e.target.value })}
              >
                {['posts', 'pages', 'media', 'categories', 'tags', 'saved-views'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        disabled={readOnly}
        onClick={() =>
          setValue([
            ...value,
            { id: `field${value.length + 1}`, label: 'New field', kind: 'text', public: false },
          ])
        }
      >
        Add field
      </button>
    </section>
  )
}
