'use client'
import { useEffect, useState } from 'react'
import { useField, useFormFields } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import type { TypeField, EventSchedule } from '@design-system/payload-design-core/content'
import { evaluateFieldRules, type MediaFacts } from '@design-system/payload-design-core/content'
import { RelationPicker } from './ViewBuilder'
import './framework.css'
export function ScheduleEditor({
  value,
  onChange,
  disabled,
}: {
  value: Partial<EventSchedule>
  onChange: (v: EventSchedule) => void
  disabled?: boolean
}) {
  const change = (patch: Partial<EventSchedule>) =>
    onChange({ ...value, ...patch } as EventSchedule)
  return (
    <fieldset disabled={disabled}>
      <legend>Event schedule</legend>
      <p>
        Change the entire series here, or add an exception for one occurrence. All-day end dates are
        exclusive.
      </p>
      <div className="cf-row">
        <label>
          Starts
          <input
            type={value.allDay ? 'date' : 'datetime-local'}
            value={value.start || ''}
            onChange={(e) => change({ start: e.target.value })}
          />
        </label>
        <label>
          Ends
          <input
            type={value.allDay ? 'date' : 'datetime-local'}
            value={value.end || ''}
            onChange={(e) => change({ end: e.target.value })}
          />
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={!!value.allDay}
          onChange={(e) => change({ allDay: e.target.checked, start: '', end: '' })}
        />{' '}
        All day
      </label>
      <label>
        Timezone
        <input
          list="event-zones"
          value={value.timezone || 'UTC'}
          onChange={(e) => change({ timezone: e.target.value })}
        />
        <datalist id="event-zones">
          {[
            'UTC',
            'America/Chicago',
            'America/New_York',
            'America/Denver',
            'America/Los_Angeles',
            'Europe/London',
            'Europe/Paris',
            'Asia/Tokyo',
            'Australia/Sydney',
          ].map((z) => (
            <option key={z}>{z}</option>
          ))}
        </datalist>
      </label>
      {!value.allDay && (
        <details>
          <summary>Daylight-saving time disambiguation</summary>
          <p>
            When a local time occurs twice, enter its explicit offset, for example
            2026-11-01T01:30:00-06:00. Nonexistent local times must be changed.
          </p>
          {(['start', 'end'] as const).map((key) => (
            <label key={key}>
              Exact {key}
              <input
                type="text"
                value={value[key] || ''}
                onChange={(e) => change({ [key]: e.target.value })}
              />
            </label>
          ))}
        </details>
      )}
      <div className="cf-row">
        <label>
          Repeats
          <select
            value={value.frequency || 'none'}
            onChange={(e) => change({ frequency: e.target.value as EventSchedule['frequency'] })}
          >
            {['none', 'daily', 'weekly', 'monthly', 'yearly'].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        {value.frequency && value.frequency !== 'none' && (
          <>
            <label>
              Every
              <input
                type="number"
                min={1}
                max={999}
                value={value.interval || 1}
                onChange={(e) => change({ interval: Number(e.target.value) })}
              />
            </label>
            <label>
              Until
              <input
                type="date"
                value={value.until || ''}
                onChange={(e) => change({ until: e.target.value || undefined })}
              />
            </label>
            <label>
              Occurrence limit
              <input
                type="number"
                min={1}
                value={value.count || ''}
                onChange={(e) =>
                  change({ count: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </label>
          </>
        )}
      </div>
      {value.frequency === 'weekly' && (
        <div className="cf-row">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={value.weekdays?.includes(i) || false}
                onChange={(e) =>
                  change({
                    weekdays: e.target.checked
                      ? [...(value.weekdays || []), i]
                      : (value.weekdays || []).filter((d) => d !== i),
                  })
                }
              />
              {day}
            </label>
          ))}
        </div>
      )}
      {['monthly', 'yearly'].includes(value.frequency || '') && (
        <label>
          Days of month (comma separated; blank uses start day)
          <input
            value={(value.monthDays || []).join(',')}
            onChange={(e) =>
              change({ monthDays: e.target.value ? e.target.value.split(',').map(Number) : [] })
            }
          />
        </label>
      )}
      {(value.exceptions || []).map((ex, i) => (
        <fieldset key={i}>
          <legend>This occurrence</legend>
          <label>
            Original date
            <input
              type="date"
              value={ex.date}
              onChange={(e) =>
                change({
                  exceptions: value.exceptions!.map((v, j) =>
                    j === i ? { ...v, date: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!ex.cancelled}
              onChange={(e) =>
                change({
                  exceptions: value.exceptions!.map((v, j) =>
                    j === i ? { ...v, cancelled: e.target.checked } : v,
                  ),
                })
              }
            />{' '}
            Cancel this occurrence
          </label>
          {!ex.cancelled &&
            (['start', 'end'] as const).map((key) => (
              <label key={key}>
                New {key}
                <input
                  type="datetime-local"
                  value={ex[key] || ''}
                  onChange={(e) =>
                    change({
                      exceptions: value.exceptions!.map((v, j) =>
                        j === i ? { ...v, [key]: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
          <button
            type="button"
            onClick={() => change({ exceptions: value.exceptions!.filter((_, j) => j !== i) })}
          >
            Remove exception
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          change({ exceptions: [...(value.exceptions || []), { date: '', cancelled: true }] })
        }
      >
        Change one occurrence
      </button>
    </fieldset>
  )
}
export const TypeValues = ({
  path,
  readOnly,
  lexicalSchemaPath,
}: React.ComponentProps<JSONFieldClientComponent> & { lexicalSchemaPath?: string }) => {
  const { value = {}, setValue } = useField<Record<string, unknown>>({ path })
  const type = useFormFields(([fields]) => fields.postType?.value)
  const [definition, setDefinition] = useState<{
    singular: string
    fieldDefinitions: TypeField[]
  } | null>(null)
  useEffect(() => {
    let active = true
    const id = typeof type === 'object' && type ? ('id' in type ? type.id : '') : type
    fetch(
      `/api/post-types?where[_status][equals]=published&${id ? `where[id][equals]=${encodeURIComponent(String(id))}` : 'where[key][equals]=post'}`,
    )
      .then(
        (r) =>
          r.json() as Promise<{
            docs?: Array<{ singular: string; fieldDefinitions: TypeField[] }>
          }>,
      )
      .then((r) => {
        if (active) setDefinition(r.docs?.[0] || null)
      })
      .catch(() => {
        if (active) setDefinition(null)
      })
    return () => {
      active = false
    }
  }, [type])
  if (!definition) return <p>Select a published Post Type to edit its fields.</p>
  return (
    <TypeValueForm
      fields={definition.fieldDefinitions}
      label={definition.singular + ' fields'}
      value={value}
      onChange={setValue}
      readOnly={readOnly}
      lexicalSchemaPath={lexicalSchemaPath}
    />
  )
}
export function TypeValueForm({
  fields,
  label,
  value,
  onChange,
  readOnly,
  lexicalSchemaPath,
}: {
  fields: TypeField[]
  label: string
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  readOnly?: boolean
  lexicalSchemaPath?: string
}) {
  const [mediaResult, setMedia] = useState<{ key: string; facts: MediaFacts }>({
    key: '',
    facts: {},
  })
  const mediaKey = JSON.stringify(
    fields.filter((f) => f.kind === 'media').map((f) => [f.id, value[f.id]]),
  )
  useEffect(() => {
    const controller = new AbortController()
    const references = JSON.parse(mediaKey) as [string, unknown][]
    for (const [field, id] of references)
      if (id)
        void fetch('/api/media/' + encodeURIComponent(String(id)), { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error()
            return response.json()
          })
          .then((facts) =>
            setMedia((old) => ({
              key: mediaKey,
              facts: { ...(old.key === mediaKey ? old.facts : {}), [field]: facts },
            })),
          )
          .catch(() => {})
    return () => controller.abort()
  }, [mediaKey])
  const issues = evaluateFieldRules(
    fields,
    value,
    mediaResult.key === mediaKey ? mediaResult.facts : {},
  )
  const change = (id: string, v: unknown) => onChange({ ...value, [id]: v })
  return (
    <section className="cf-editor">
      <h3>{label}</h3>
      {fields.map((f) => (
        <div key={f.id} className="cf-field">
          {f.kind === 'eventSchedule' ? (
            <ScheduleEditor
              disabled={readOnly}
              value={(value[f.id] || { timezone: 'UTC' }) as EventSchedule}
              onChange={(v) => change(f.id, v)}
            />
          ) : ['relationship', 'media'].includes(f.kind) ? (
            <RelationPicker
              label={f.label}
              collection={f.kind === 'media' ? 'media' : f.relationTo || 'posts'}
              value={value[f.id] ? [String(value[f.id])] : []}
              onChange={(ids) => change(f.id, ids[0] ? Number(ids[0]) : null)}
              single
              disabled={readOnly}
            />
          ) : (
            <label>
              {f.label}
              {f.required ? ' *' : ''}
              {f.kind === 'boolean' ? (
                <input
                  disabled={readOnly}
                  type="checkbox"
                  checked={!!value[f.id]}
                  onChange={(e) => change(f.id, e.target.checked)}
                />
              ) : f.kind === 'select' ? (
                <select
                  disabled={readOnly}
                  value={String(value[f.id] || '')}
                  onChange={(e) => change(f.id, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {f.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.kind === 'richText' && lexicalSchemaPath ? (
                <RenderLexical
                  field={{ name: 'content', type: 'richText', label: f.label, admin: { readOnly } }}
                  path={`typeValueEditor.${f.id}`}
                  schemaPath={lexicalSchemaPath}
                  value={(value[f.id] || lexical('')) as never}
                  setValue={(next) => change(f.id, next)}
                />
              ) : f.kind === 'textarea' || f.kind === 'richText' ? (
                <textarea
                  disabled={readOnly}
                  value={
                    f.kind === 'richText' ? lexicalText(value[f.id]) : String(value[f.id] || '')
                  }
                  onChange={(e) =>
                    change(f.id, f.kind === 'richText' ? lexical(e.target.value) : e.target.value)
                  }
                />
              ) : (
                <input
                  disabled={readOnly}
                  type={
                    f.kind === 'number'
                      ? 'number'
                      : f.kind === 'date'
                        ? 'datetime-local'
                        : f.kind === 'url'
                          ? 'url'
                          : 'text'
                  }
                  value={String(value[f.id] ?? '')}
                  onChange={(e) =>
                    change(
                      f.id,
                      f.kind === 'number'
                        ? e.target.value === ''
                          ? null
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </label>
          )}
          {f.helpText && <p>{f.helpText}</p>}
          <div aria-live="polite">
            {issues
              .filter((issue) => issue.field === f.id)
              .map((issue, i) => (
                <p className="pt-error" key={i}>
                  {issue.message}
                </p>
              ))}
          </div>
        </div>
      ))}
    </section>
  )
}
function lexicalText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const n = value as { text?: string; root?: unknown; children?: unknown[] }
  return n.text ?? (n.root ? lexicalText(n.root) : (n.children || []).map(lexicalText).join(''))
}
function lexical(text: string) {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: null as null,
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: null as null,
          format: '',
          indent: 0,
          children: [
            { type: 'text', version: 1, text, format: 0, mode: 'normal', style: '', detail: 0 },
          ],
        },
      ],
    },
  }
}
