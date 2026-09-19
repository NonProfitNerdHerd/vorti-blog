'use client'

import { useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { ContentValues, FieldDefinition, ID, Template } from '../types'

type DesignOption = { id: ID; name: string; blockType: ID }
type SectionData = { fields: FieldDefinition[]; designs: DesignOption[] }

export function TemplateContentEditor() {
  const selected = useFormFields(([fields]) => fields.designTemplate?.value)
  const templateID = typeof selected === 'object' && selected !== null ? (selected as { id?: ID }).id : selected as ID | undefined
  // This component owns templateValues. Payload synchronizes the mounted field
  // with each save response, including subsequent edits on the same form.
  const { value: rawValues, setValue: setValues, disabled } = useField<ContentValues>()
  const { value: rawOverrides, setValue: setOverrides } = useField<Record<string, ID | null>>({ path: 'designOverrides' })
  const values = rawValues && typeof rawValues === 'object' ? rawValues : {}
  const overrides = rawOverrides && typeof rawOverrides === 'object' ? rawOverrides : {}
  const [template, setTemplate] = useState<Template | null>(null)
  const [sections, setSections] = useState<Record<string, SectionData>>({})
  const [mediaOptions, setMediaOptions] = useState<Array<{ id: ID; alt?: string; filename?: string }>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/media?limit=100&depth=0', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.resolve({ docs: [] }))
      .then((data: { docs?: Array<{ id: ID; alt?: string; filename?: string }> }) => setMediaOptions(data.docs ?? []))
      .catch(() => setMediaOptions([]))
  }, [])

  useEffect(() => {
    if (!templateID) return
    let active = true
    async function load() {
      try {
        const response = await fetch(`/api/design-templates/${templateID}?depth=0`, { credentials: 'same-origin' })
        if (!response.ok) throw new Error('The selected Template is unavailable')
        const next = await response.json() as Template
        const details = await Promise.all(next.sections.map(async (section) => {
          const [typeResponse, designsResponse] = await Promise.all([
            fetch(`/api/design-block-types/${section.blockType}?depth=0`, { credentials: 'same-origin' }),
            fetch(`/api/design-block-designs?depth=0&limit=100&where[blockType][equals]=${section.blockType}&where[status][equals]=published&where[_status][equals]=published`, { credentials: 'same-origin' }),
          ])
          if (!typeResponse.ok || !designsResponse.ok) throw new Error(`Could not load ${section.name}`)
          const blockType = await typeResponse.json() as { fields: FieldDefinition[] }
          const designs = await designsResponse.json() as { docs: DesignOption[] }
          return [section.key, { fields: blockType.fields, designs: designs.docs }] as const
        }))
        if (active) { setTemplate(next); setSections(Object.fromEntries(details)); setError(null) }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not load Template') }
    }
    void load()
    return () => { active = false }
  }, [templateID])

  function update(sectionKey: string, key: string, value: unknown) {
    setValues({ ...values, [sectionKey]: { ...(values[sectionKey] ?? {}), [key]: value } })
  }
  if (!templateID) return <p>Select a published Template to edit its sections.</p>
  if (error) return <p role="alert">{error}</p>
  if (!template || String(template.id) !== String(templateID)) return <p>Loading Template sections…</p>
  return <section><h3>Template content</h3>
    {template.sections.map((section) => <fieldset key={section.key} style={{ marginBottom: '1.5rem', padding: '1rem' }}>
      <legend>{section.name}{section.required ? ' (required)' : ''}</legend>
      {section.required && (sections[section.key]?.fields ?? []).some((field) => field.required && !values[section.key]?.[field.key]) &&
        <p role="alert">This section is missing required content. Fill it before publishing this Post.</p>}
      {section.allowDesignOverride && <label>Design
        <select disabled={disabled} value={String(overrides[section.key] ?? '')} onChange={(event) =>
          setOverrides({ ...overrides, [section.key]: event.target.value || null })}>
          <option value="">Use Template Default</option>
          {sections[section.key]?.designs.map((design) => <option key={design.id} value={String(design.id)}>{design.name}</option>)}
        </select>
      </label>}
      {(sections[section.key]?.fields ?? []).map((field) => <div key={field.key} style={{ marginTop: '0.75rem' }}>
        <label>{field.label}{field.required ? ' *' : ''}
          {field.kind === 'textarea' ? <textarea disabled={disabled} value={String(values[section.key]?.[field.key] ?? '')} onChange={(event) => update(section.key, field.key, event.target.value)} />
            : field.kind === 'boolean' ? <input disabled={disabled} type="checkbox" checked={Boolean(values[section.key]?.[field.key])} onChange={(event) => update(section.key, field.key, event.target.checked)} />
            : field.kind === 'media' ? <select disabled={disabled} value={String(values[section.key]?.[field.key] ?? '')} onChange={(event) => update(section.key, field.key, event.target.value || null)}>
              <option value="">Choose Media</option>
              {mediaOptions.map((media) => <option key={media.id} value={String(media.id)}>{media.alt || media.filename || media.id}</option>)}
            </select>
            : field.kind === 'group' ? <div>{field.children?.map((child) => <label key={child.key}>{child.label}<input disabled={disabled} value={String((values[section.key]?.[field.key] as Record<string, unknown> | undefined)?.[child.key] ?? '')} onChange={(event) => update(section.key, field.key, { ...((values[section.key]?.[field.key] as Record<string, unknown>) ?? {}), [child.key]: event.target.value })} /></label>)}</div>
            : <input disabled={disabled} type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} value={String(values[section.key]?.[field.key] ?? '')} onChange={(event) => update(section.key, field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value)} />}
        </label>
      </div>)}
    </fieldset>)}
    {Object.keys(values).filter((key) => !template.sections.some((section) => section.key === key)).length > 0 && <p>Values for removed sections remain stored for recovery.</p>}
  </section>
}
