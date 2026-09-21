'use client'

import { UploadInput, useConfig, useField, useFormFields } from '@payloadcms/ui'
import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import { useEffect, useState } from 'react'
import type { FieldDefinition, ID, Template, TemplateField } from '../types'
import { templateFields } from '../template-tree'

type DesignOption = { id: ID; name: string; blockType: ID }
type SectionData = { fields: FieldDefinition[]; designs: DesignOption[] }

export function TemplateContentEditor({ lexicalSchemaPath }: { lexicalSchemaPath: string }) {
  const selected = useFormFields(([fields]) => fields.designTemplate?.value)
  const templateID = typeof selected === 'object' && selected !== null ? (selected as { id?: ID }).id : selected as ID | undefined
  // This component owns templateValues. Payload synchronizes the mounted field
  // with each save response, including subsequent edits on the same form.
  const { value: rawValues, setValue: setValues, disabled } = useField<Record<string, unknown>>()
  const { value: rawOverrides, setValue: setOverrides } = useField<Record<string, ID | null>>({ path: 'designOverrides' })
  const values: Record<string, unknown> = rawValues && typeof rawValues === 'object' ? rawValues : {}
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
    const sectionValues = values[sectionKey] && typeof values[sectionKey] === 'object' ? values[sectionKey] as Record<string, unknown> : {}
    setValues({ ...values, [sectionKey]: { ...sectionValues, [key]: value } })
  }
  if (!templateID) return <p>Select a published Template to edit its sections.</p>
  if (error) return <p role="alert">{error}</p>
  if (!template || String(template.id) !== String(templateID)) return <p>Loading Template sections…</p>
  return <section className="template-content-editor"><h3>Template content</h3>
    {template.sections.map((section) => <fieldset className="template-content-editor__section" key={section.key}>
      <legend>{section.name}{section.required ? ' (required)' : ''}</legend>
      {section.required && (sections[section.key]?.fields ?? []).some((field) => field.required && !(values[section.key] as Record<string, unknown> | undefined)?.[field.key]) &&
        <p role="alert">This section is missing required content. Fill it before publishing this Post.</p>}
      {section.allowDesignOverride && <label className="template-content-editor__field">Design
        <select disabled={disabled} value={String(overrides[section.key] ?? '')} onChange={(event) =>
          setOverrides({ ...overrides, [section.key]: event.target.value || null })}>
          <option value="">Use Template Default</option>
          {sections[section.key]?.designs.map((design) => <option key={design.id} value={String(design.id)}>{design.name}</option>)}
        </select>
      </label>}
      {(sections[section.key]?.fields ?? []).map((field) => <div className="template-content-editor__field" key={field.key}>
        <label>{field.label}{field.required ? ' *' : ''}
          {field.kind === 'textarea' ? <textarea disabled={disabled} value={String((values[section.key] as Record<string, unknown> | undefined)?.[field.key] ?? '')} onChange={(event) => update(section.key, field.key, event.target.value)} />
            : field.kind === 'boolean' ? <input disabled={disabled} type="checkbox" checked={Boolean((values[section.key] as Record<string, unknown> | undefined)?.[field.key])} onChange={(event) => update(section.key, field.key, event.target.checked)} />
            : field.kind === 'media' ? <select disabled={disabled} value={String((values[section.key] as Record<string, unknown> | undefined)?.[field.key] ?? '')} onChange={(event) => update(section.key, field.key, event.target.value || null)}>
              <option value="">Choose Media</option>
              {mediaOptions.map((media) => <option key={media.id} value={String(media.id)}>{media.alt || media.filename || media.id}</option>)}
            </select>
            : field.kind === 'group' ? <div>{field.children?.map((child) => <label className="template-content-editor__field" key={child.key}>{child.label}<input disabled={disabled} value={String(((values[section.key] as Record<string, unknown> | undefined)?.[field.key] as Record<string, unknown> | undefined)?.[child.key] ?? '')} onChange={(event) => update(section.key, field.key, { ...((((values[section.key] as Record<string, unknown> | undefined)?.[field.key]) as Record<string, unknown>) ?? {}), [child.key]: event.target.value })} /></label>)}</div>
            : <input disabled={disabled} type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} value={String((values[section.key] as Record<string, unknown> | undefined)?.[field.key] ?? '')} onChange={(event) => update(section.key, field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value)} />}
        </label>
      </div>)}
    </fieldset>)}
    {(() => { const legacy = templateFields(template.layout ?? []).filter((field) => !field.content || field.content.source === 'custom'); const custom = template.customFields ?? []; const all = [...custom.map((field) => ({ ...field, type: 'field' as const })), ...legacy.filter((field) => !custom.some((item) => item.id === field.id))]; return all.length > 0 && <div><h3>{template.name} fields</h3>{all.map((field) => <div className="template-content-editor__field" key={field.id}><DynamicTemplateField field={field} lexicalSchemaPath={lexicalSchemaPath} value={values[field.id]} disabled={disabled} onChange={(value) => setValues({ ...values, [field.id]: value })} /></div>)}</div> })()}
    {Object.keys(values).filter((key) => !template.sections.some((section) => section.key === key) && !templateFields(template.layout ?? []).some((field) => field.id === key) && !(template.customFields ?? []).some((field) => field.id === key)).length > 0 && <p>Values for removed fields remain stored for recovery.</p>}
  </section>
}

function DynamicTemplateField({ field, lexicalSchemaPath, value, disabled, onChange }: { field: TemplateField; lexicalSchemaPath: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const label = `${field.label}${field.required ? ' *' : ''}`
  const { config } = useConfig()
  if (field.fieldType === 'toggle') return <label className="template-content-editor__toggle">{label}<input disabled={disabled} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /></label>
  if (field.fieldType === 'image' || field.fieldType === 'images') return <UploadInput api={config.routes.api} allowCreate hasMany={field.fieldType === 'images'} isSortable={field.fieldType === 'images'} label={label} description={field.helpText} onChange={onChange} path={`templateValues.${field.id}`} readOnly={disabled} relationTo="media" required={field.required} serverURL={config.serverURL} showError={false} value={value as never} />
  if (field.fieldType === 'richText') return <RenderLexical field={{ name: field.id, type: 'richText', label, required: field.required, admin: { description: field.helpText, readOnly: false } }} path={`templateValues.${field.id}`} schemaPath={lexicalSchemaPath} value={value as never} setValue={(next) => onChange(next)} />
  if (field.fieldType === 'longText') return <label>{label}<textarea disabled={disabled} aria-label={label} placeholder={field.placeholder} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} /></label>
  if (field.fieldType === 'select') return <label>{label}<select disabled={disabled} aria-label={label} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>{field.helpText && <small>{field.helpText}</small>}</label>
  return <label>{label}<input disabled={disabled} aria-label={label} placeholder={field.placeholder} type={field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : 'text'} value={String(value ?? '')} onChange={(event) => onChange(field.fieldType === 'number' ? Number(event.target.value) : event.target.value)} />{field.helpText && <small>{field.helpText}</small>}</label>
}
