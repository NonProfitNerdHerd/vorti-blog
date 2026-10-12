'use client'
import { useState, useRef, useEffect, useId, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { TypeField, FieldRule, TypeFieldKind } from '../views/model'
import { availableRules, ruleLabels, validateRuleDefinitions } from '../views/field-rules'
export const typeFieldDescriptions: Record<TypeField['kind'], string> = {
  text: 'A short answer, name, or email address.',
  textarea: 'A longer plain-text answer.',
  richText: 'Formatted text with links and paragraphs.',
  number: 'A numeric value such as capacity or price.',
  date: 'A date and time. Use Event Schedule for timezone-aware events.',
  boolean: 'A yes/no checkbox.',
  select: 'One choice from your list of options.',
  media: 'An existing uploaded image or document.',
  url: 'A website, email, telephone, or internal link.',
  relationship: 'A reference to another record the author can access.',
  eventSchedule: 'Start, end, timezone, all-day settings, and recurrence for an Event.',
}
export function nextFieldID(fields: TypeField[], label: string) {
  const base =
    label
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/^[^a-zA-Z]+/, '')
      .replace(/^./, (c) => c.toLowerCase())
      .slice(0, 55) || 'field'
  let id = base,
    n = 2
  while (fields.some((f) => f.id === id) || ['constructor', 'prototype', '__proto__'].includes(id))
    id = `${base}${n++}`
  return id
}
function RuleEditor({
  rule,
  field,
  fields,
  change,
  remove,
}: {
  rule: FieldRule
  field: TypeField
  fields: TypeField[]
  change: (patch: Partial<FieldRule>) => void
  remove: (trigger: HTMLButtonElement) => void
}) {
  const related = fields.find((f) => f.id === rule.field)
  const scalar = ['text', 'textarea', 'select', 'number', 'boolean', 'date', 'url']
  const numeric = ['minLength', 'maxLength', 'min', 'max', 'maxBytes'].includes(rule.kind)
  const needsValue =
    numeric ||
    ['earliest', 'latest', 'contains', 'excludes', 'protocols', 'domains', 'mimeTypes'].includes(
      rule.kind,
    ) ||
    (rule.kind === 'requiredWhen' && rule.operator === 'equals')
  return (
    <div className="pt-rule">
      <strong>{ruleLabels[rule.kind]}</strong>
      <button
        type="button"
        className="pt-rule-delete"
        aria-label={`Delete ${ruleLabels[rule.kind]} rule`}
        title={`Delete ${ruleLabels[rule.kind]} rule`}
        onClick={(e) => remove(e.currentTarget)}
      >
        <Trash2 size={18} aria-hidden="true" />
      </button>
      {['compare', 'requiredWhen'].includes(rule.kind) && (
        <>
          <label>
            Other field
            <select
              value={rule.field || ''}
              onChange={(e) => change({ field: e.target.value, value: undefined })}
            >
              <option value="">Choose a field</option>
              {fields
                .filter(
                  (f) =>
                    f.id !== field.id &&
                    (rule.kind !== 'compare' || f.kind === field.kind) &&
                    (rule.operator !== 'equals' || scalar.includes(f.kind)),
                )
                .map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Condition
            <select
              value={rule.operator || ''}
              onChange={(e) =>
                change({ operator: e.target.value as FieldRule['operator'], value: undefined })
              }
            >
              <option value="">Choose a condition</option>
              {(rule.kind === 'compare'
                ? [
                    ['before', field.kind === 'date' ? 'Must be before' : 'Must be less than'],
                    ['after', field.kind === 'date' ? 'Must be after' : 'Must be greater than'],
                  ]
                : [
                    ['equals', 'Equals'],
                    ['set', 'Has a value'],
                    ['empty', 'Is empty'],
                  ]
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {rule.kind === 'compare' && (
            <label>
              <input
                type="checkbox"
                checked={!!rule.allowEqual}
                onChange={(e) => change({ allowEqual: e.target.checked })}
              />{' '}
              Allow equal values
            </label>
          )}
        </>
      )}
      {needsValue && (
        <label>
          Rule value
          {rule.kind === 'requiredWhen' && related?.kind === 'boolean' ? (
            <select
              value={rule.value === undefined ? '' : String(rule.value)}
              onChange={(e) => change({ value: e.target.value === 'true' })}
            >
              <option value="">Choose</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : rule.kind === 'requiredWhen' && related?.kind === 'select' ? (
            <select
              value={String(rule.value || '')}
              onChange={(e) => change({ value: e.target.value })}
            >
              <option value="">Choose</option>
              {related.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              type={
                numeric || (rule.kind === 'requiredWhen' && related?.kind === 'number')
                  ? 'number'
                  : ['earliest', 'latest'].includes(rule.kind)
                    ? 'datetime-local'
                    : 'text'
              }
              value={String(rule.value ?? '')}
              onChange={(e) =>
                change({
                  value:
                    numeric || (rule.kind === 'requiredWhen' && related?.kind === 'number')
                      ? e.target.value === ''
                        ? undefined
                        : Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          )}
        </label>
      )}
      {rule.kind === 'protocols' && (
        <small>Comma-separated: https, http, mailto, tel, relative</small>
      )}
      {rule.kind === 'domains' && (
        <small>
          Exact hostnames, separated by commas: example.org, www.example.org. Only website links
          match.
        </small>
      )}
      {rule.kind === 'mimeTypes' && (
        <small>Comma-separated MIME types: image/*, application/pdf</small>
      )}
      <label>
        Custom error message (optional)
        <input
          maxLength={300}
          value={rule.message || ''}
          onChange={(e) => change({ message: e.target.value })}
          placeholder="Use the automatic message"
        />
      </label>
    </div>
  )
}
export function TypeFieldBuilder({
  fields,
  onChange,
  savedFields,
  disabled,
  preview,
  renderDefault,
  requiredKinds = [],
  serverError,
}: {
  fields: TypeField[]
  onChange: (fields: TypeField[]) => void
  savedFields: TypeField[]
  disabled?: boolean
  preview: ReactNode
  renderDefault?: (field: TypeField, change: (value: unknown) => void) => ReactNode
  requiredKinds?: TypeFieldKind[]
  serverError?: string
}) {
  const [selected, setSelected] = useState(0),
    [showPreview, setShowPreview] = useState(false)
  const field = fields[selected]
  const settings = useRef<HTMLFieldSetElement>(null)
  const errors = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const dialogTitleID = useId()
  const [deleting, setDeleting] = useState<{
    index: number
    fieldID: string
    trigger: HTMLButtonElement
  } | null>(null)
  const [applied, setApplied] = useState<Record<string, string>>({})
  const protectedField =
    !!field &&
    requiredKinds.includes(field.kind) &&
    !fields.some((f, i) => i !== selected && f.kind === field.kind && f.public && f.required)
  useEffect(() => {
    if (deleting) dialog.current?.showModal()
  }, [deleting])
  const closeDelete = (removed = false) => {
    dialog.current?.close()
    const trigger = deleting?.trigger
    setDeleting(null)
    requestAnimationFrame(() => {
      if (!removed && trigger?.isConnected) trigger.focus()
      else
        (
          settings.current?.querySelector('[data-add-rule]') as unknown as HTMLSelectElement
        )?.focus()
    })
  }
  const locked = !!field && savedFields.some((f) => f.id === field.id)
  const update = (patch: Partial<TypeField>) =>
    onChange(fields.map((f, i) => (i === selected ? { ...f, ...patch } : f)))
  const move = (from: number, to: number) => {
    const next = [...fields]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
    setSelected(to)
  }
  const add = () => {
    onChange([
      ...fields,
      { id: nextFieldID(fields, 'newField'), label: 'New field', kind: 'text', public: false },
    ])
    setSelected(fields.length)
  }
  const issues = validateRuleDefinitions(fields)
  const applyField = () => {
    if (disabled || !field) return
    if (issues.some((issue) => issue.field === field.id)) {
      errors.current?.focus()
      return
    }
    setApplied((old) => ({ ...old, [field.id]: JSON.stringify(field) }))
  }
  return (
    <section className="pt-field-builder">
      <div className="pt-builder-heading">
        <h3>Content fields</h3>
        <button
          type="button"
          aria-expanded={showPreview}
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? 'Hide' : 'Show'} author form preview
        </button>
      </div>
      <p>
        Configure what authors enter below. Required values belong to content, not this setup or its
        sample preview. Field edits are included when you use Save Draft or Publish in the header.
      </p>
      {serverError && (
        <div role="alert" className="pt-error" tabIndex={-1}>
          {serverError}
        </div>
      )}
      {showPreview && (
        <section className="pt-preview">
          <h4>Try the author form</h4>
          <p>
            Sample values stay in this preview and are never saved as content. Rules are enforced
            when content is published.
          </p>
          {preview}
        </section>
      )}
      <div className="pt-field-layout">
        <div className="pt-field-directory">
          <h4>Fields in this type</h4>
          <ol className="pt-field-list">
            {fields.map((f, i) => (
              <li key={i}>
                <button
                  type="button"
                  data-field-id={f.id}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                >
                  <strong>{f.label}</strong>
                  {requiredKinds.includes(f.kind) && <small>Required by behavior</small>}
                  <small>
                    {f.kind} · {f.public ? 'Public' : 'Private'}
                    {f.required ? ' · Required' : ''}
                    {f.rules?.length
                      ? ` · ${f.rules.map((rule) => ruleLabels[rule.kind]).join(', ')}`
                      : ''}
                  </small>
                </button>
                <div>
                  <button
                    type="button"
                    aria-label={`Move ${f.label} up`}
                    disabled={disabled || i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${f.label} down`}
                    disabled={disabled || i === fields.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" disabled={disabled || fields.length >= 100} onClick={add}>
            Add field
          </button>
        </div>
        {field ? (
          <fieldset ref={settings} disabled={disabled} className="pt-field-settings">
            <legend>{field.label}</legend>
            <h4>Identity</h4>
            <label>
              Label
              <input value={field.label} onChange={(e) => update({ label: e.target.value })} />
            </label>
            <label className="pt-control-short">
              Field ID
              <input
                value={field.id}
                disabled={locked}
                onChange={(e) => update({ id: e.target.value })}
              />
            </label>
            {!locked && (
              <button
                type="button"
                onClick={() =>
                  update({
                    id: nextFieldID(
                      fields.filter((_, i) => i !== selected),
                      field.label,
                    ),
                  })
                }
              >
                Suggest ID from label
              </button>
            )}
            <label className="pt-control-short">
              Field type
              <select
                value={field.kind}
                disabled={locked || protectedField}
                onChange={(e) =>
                  update({
                    kind: e.target.value as TypeField['kind'],
                    rules: [],
                    defaultValue: undefined,
                    options: e.target.value === 'select' ? ['Option 1'] : undefined,
                    relationTo: e.target.value === 'relationship' ? 'posts' : undefined,
                  })
                }
              >
                {Object.keys(typeFieldDescriptions).map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <p>{typeFieldDescriptions[field.kind]}</p>
            {locked && (
              <p>
                This saved field’s ID and type are fixed because content and Templates may reference
                them. Add a replacement field if needed.
              </p>
            )}
            {protectedField && (
              <p className="pt-protected">
                This field is required by the selected behavior. Its type, Required, and Public
                settings must stay enabled, and it cannot be removed.
              </p>
            )}
            <h4>Author instructions</h4>
            <label>
              Help text
              <textarea
                value={field.helpText || ''}
                onChange={(e) => update({ helpText: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!field.required}
                disabled={protectedField && !!field.required}
                onChange={(e) => update({ required: e.target.checked })}
              />{' '}
              Required for publication
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!field.public}
                disabled={protectedField && !!field.public}
                onChange={(e) => update({ public: e.target.checked })}
              />{' '}
              Public: available to Templates and Saved Views
            </label>
            {field.kind === 'select' && (
              <label>
                Choices (one per line)
                <textarea
                  value={(field.options || []).join('\n')}
                  onChange={(e) => update({ options: e.target.value.split('\n') })}
                />
              </label>
            )}
            {field.kind === 'relationship' && (
              <label>
                Related collection
                <select
                  value={field.relationTo || 'posts'}
                  onChange={(e) => update({ relationTo: e.target.value, defaultValue: undefined })}
                >
                  {['posts', 'pages', 'media', 'categories', 'tags', 'saved-views'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
            <h4>Defaults</h4>
            <p>
              Optional starting values for new content. A required field does not need a default.
            </p>
            {!['richText', 'eventSchedule', 'media', 'relationship'].includes(field.kind) && (
              <label>
                Default value (optional)
                {field.kind === 'boolean' ? (
                  <select
                    value={field.defaultValue === undefined ? '' : String(field.defaultValue)}
                    onChange={(e) =>
                      update({
                        defaultValue: e.target.value === '' ? undefined : e.target.value === 'true',
                      })
                    }
                  >
                    <option value="">No default</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : field.kind === 'select' ? (
                  <select
                    value={String(field.defaultValue || '')}
                    onChange={(e) => update({ defaultValue: e.target.value || undefined })}
                  >
                    <option value="">No default</option>
                    {field.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={
                      field.kind === 'number'
                        ? 'number'
                        : field.kind === 'date'
                          ? 'datetime-local'
                          : 'text'
                    }
                    value={String(field.defaultValue ?? '')}
                    onChange={(e) =>
                      update({
                        defaultValue:
                          e.target.value === ''
                            ? undefined
                            : field.kind === 'number'
                              ? Number(e.target.value)
                              : e.target.value,
                      })
                    }
                  />
                )}
              </label>
            )}
            {['media', 'relationship', 'richText', 'eventSchedule'].includes(field.kind) &&
              renderDefault?.(field, (defaultValue) => update({ defaultValue }))}
            <h4>Publication rules</h4>
            <p>Drafts may be unfinished. These rules must pass before content can be published.</p>
            {(field.rules || []).map((rule, index) => (
              <div key={index}>
                <RuleEditor
                  rule={rule}
                  field={field}
                  fields={fields}
                  change={(patch) =>
                    update({
                      rules: field.rules!.map((r, i) => (i === index ? { ...r, ...patch } : r)),
                    })
                  }
                  remove={(trigger) => setDeleting({ index, fieldID: field.id, trigger })}
                />
              </div>
            ))}
            <label>
              Add rule
              <select
                data-add-rule
                value=""
                onChange={(e) =>
                  update({
                    rules: [...(field.rules || []), { kind: e.target.value as FieldRule['kind'] }],
                  })
                }
              >
                <option value="">Choose a rule…</option>
                {availableRules(field.kind).map((kind) => (
                  <option value={kind} key={kind}>
                    {ruleLabels[kind]}
                  </option>
                ))}
              </select>
            </label>
            <div ref={errors} tabIndex={-1} className="pt-field-errors" aria-label="Field issues">
              {issues
                .filter((i) => i.field === field.id)
                .map((issue, i) => (
                  <p className="pt-error" key={i}>
                    {issue.message}
                  </p>
                ))}
            </div>
            <div role="status">
              {applied[field.id] === JSON.stringify(field) &&
                'Applied to setup—save the Post Type to persist.'}
            </div>
            <div className="pt-wizard-actions">
              <button type="button" className="pt-apply-field" onClick={applyField}>
                {locked || applied[field.id] ? 'Update Field' : 'Save Field'}
              </button>
              <button
                type="button"
                disabled={fields.length >= 100}
                onClick={() => {
                  onChange([
                    ...fields,
                    {
                      ...structuredClone(field),
                      id: nextFieldID(fields, field.id),
                      label: `${field.label} copy`,
                    },
                  ])
                  setSelected(fields.length)
                }}
              >
                Duplicate field
              </button>
              <button
                type="button"
                disabled={locked || protectedField}
                title={
                  locked
                    ? 'Saved fields cannot be removed because content may reference them.'
                    : protectedField
                      ? 'Required by the selected behavior.'
                      : undefined
                }
                onClick={() => {
                  onChange(fields.filter((_, i) => i !== selected))
                  setSelected(Math.max(0, selected - 1))
                }}
              >
                Remove field
              </button>
            </div>
          </fieldset>
        ) : (
          <p>Add your first field to describe the information authors should enter.</p>
        )}
      </div>
      <dialog
        ref={dialog}
        className="pt-rule-dialog"
        aria-labelledby={dialogTitleID}
        onCancel={(e) => {
          e.preventDefault()
          closeDelete()
        }}
      >
        <h3 id={dialogTitleID}>Delete rule?</h3>
        <p>
          Delete{' '}
          {deleting &&
            ruleLabels[
              fields.find((f) => f.id === deleting.fieldID)?.rules?.[deleting.index]?.kind ||
                'email'
            ]}{' '}
          from {field?.label}?
        </p>
        <div className="pt-wizard-actions">
          <button type="button" autoFocus onClick={() => closeDelete()}>
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!disabled && deleting)
                onChange(
                  fields.map((f) =>
                    f.id === deleting.fieldID
                      ? { ...f, rules: f.rules?.filter((_, i) => i !== deleting.index) }
                      : f,
                  ),
                )
              closeDelete(true)
            }}
          >
            Delete rule
          </button>
        </div>
      </dialog>
    </section>
  )
}
