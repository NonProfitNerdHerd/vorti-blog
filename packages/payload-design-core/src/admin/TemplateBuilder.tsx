'use client'

import { useDocumentInfo, useField, useForm } from '@payloadcms/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ID } from '../types'

type BlockTypeOption = { id: ID; name: string; description?: string; rendererKey?: string }
type DesignOption = { id: ID; name: string; blockType: ID }
type TemplateSection = {
  key: string
  name: string
  blockType: ID
  blockDesign: ID
  required?: boolean
  allowDesignOverride?: boolean
}
type Impact = { collection: string; id: ID; status?: string }

const fieldStyle = { display: 'grid', gap: '0.4rem' } as const
const panelStyle = { border: '1px solid var(--theme-elevation-150)', borderRadius: '8px', padding: '1.25rem' } as const

function relationID(value: unknown): ID | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value && typeof value === 'object' && 'id' in value) return (value as { id?: ID }).id
}

function makeSectionKey(name: string, sections: TemplateSection[]) {
  const base = name.trim().replace(/[^a-zA-Z0-9]+(.)/g, (_, next: string) => next.toUpperCase()).replace(/^[^a-z]+/i, '').replace(/^./, (letter) => letter.toLowerCase()) || 'section'
  const used = new Set(sections.map((section) => section.key))
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

export function TemplateBuilder({ configuredCollections = ['posts'], registeredRendererKeys = ['hero-board'] }: { configuredCollections?: string[]; registeredRendererKeys?: string[] }) {
  const { id, hasPublishedDoc } = useDocumentInfo()
  const { submit, disabled } = useForm()
  const { value: nameValue, setValue: setName } = useField<string>({ path: 'name' })
  const { value: descriptionValue, setValue: setDescription } = useField<string>({ path: 'description' })
  const { value: slugValue } = useField<string>({ path: 'slug' })
  const { value: collectionsValue, setValue: setCollections } = useField<string[]>({ path: 'allowedCollections' })
  const { value: sectionsValue, setValue: setSections } = useField<TemplateSection[]>({ path: 'sections' })
  const { value: documentStatus } = useField<string>({ path: '_status' })
  const name = nameValue ?? ''
  const description = descriptionValue ?? ''
  const collections = Array.isArray(collectionsValue) ? collectionsValue : []
  const sections = Array.isArray(sectionsValue) ? sectionsValue : []
  const [blockTypes, setBlockTypes] = useState<BlockTypeOption[]>([])
  const [designs, setDesigns] = useState<DesignOption[]>([])
  const [impact, setImpact] = useState<Impact[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [selectedType, setSelectedType] = useState<BlockTypeOption | null>(null)
  const [sectionName, setSectionName] = useState('Hero')
  const [selectedDesign, setSelectedDesign] = useState<ID | ''>('')
  const [required, setRequired] = useState(true)
  const [allowOverride, setAllowOverride] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [existingTemplateLoaded, setExistingTemplateLoaded] = useState(false)
  const sectionsModified = useRef(false)
  const publishedImpact = impact.filter((item) => item.status === 'published').length

  useEffect(() => {
    fetch('/api/design-block-types?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.resolve({ docs: [] }))
      .then((body: { docs?: BlockTypeOption[] }) => setBlockTypes((body.docs ?? []).filter((item) => item.rendererKey && registeredRendererKeys.includes(item.rendererKey))))
      .catch(() => setBlockTypes([]))
    fetch('/api/design-block-designs?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.resolve({ docs: [] }))
      .then((body: { docs?: DesignOption[] }) => setDesigns(body.docs ?? []))
      .catch(() => setDesigns([]))
  }, [registeredRendererKeys])

  useEffect(() => {
    if (!id) return
    fetch(`/api/design-templates/${id}?draft=true&depth=0`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { sections?: TemplateSection[] } | null) => {
        if (!sectionsModified.current && body && Array.isArray(body.sections)) setSections(body.sections)
        setExistingTemplateLoaded(true)
      })
      .catch(() => setExistingTemplateLoaded(true))
    fetch(`/api/design-templates/${id}/dependencies`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.resolve([]))
      .then((body) => setImpact(Array.isArray(body) ? body as Impact[] : []))
      .catch(() => setImpact([]))
  }, [id, setSections])

  const designNames = useMemo(() => new Map(designs.map((design) => [String(design.id), design.name])), [designs])

  function toggleCollection(slug: string) {
    setCollections(collections.includes(slug) ? collections.filter((item) => item !== slug) : [...collections, slug])
  }

  function beginAdd(type: BlockTypeOption) {
    setSelectedType(type)
    setEditingIndex(null)
    setSectionName(type.rendererKey === 'hero-board' ? 'Hero' : type.name)
    setSelectedDesign('')
    setRequired(true)
    setAllowOverride(true)
    setPickerOpen(false)
    setError(null)
  }

  function beginEdit(index: number) {
    const section = sections[index]
    const typeID = relationID(section.blockType)
    const type = blockTypes.find((item) => String(item.id) === String(typeID))
    if (!type) { setError('This section uses a Block Type that is not currently available.'); return }
    setSelectedType(type)
    setEditingIndex(index)
    setSectionName(section.name)
    setSelectedDesign(relationID(section.blockDesign) ?? '')
    setRequired(Boolean(section.required))
    setAllowOverride(Boolean(section.allowDesignOverride))
    setPickerOpen(false)
    setError(null)
  }

  function saveSection() {
    if (!selectedType || !sectionName.trim() || !selectedDesign) { setError('Section Name and Default Design are required.'); return }
    const prior = editingIndex === null ? undefined : sections[editingIndex]
    const next: TemplateSection = {
      key: prior?.key ?? makeSectionKey(sectionName, sections), name: sectionName.trim(), blockType: selectedType.id,
      blockDesign: selectedDesign, required, allowDesignOverride: allowOverride,
    }
    sectionsModified.current = true
    setSections(editingIndex === null ? [...sections, next] : sections.map((section, index) => index === editingIndex ? next : section))
    setSelectedType(null)
    setEditingIndex(null)
    setError(null)
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const next = [...sections]
    ;[next[index], next[target]] = [next[target], next[index]]
    sectionsModified.current = true
    setSections(next)
  }

  function remove(index: number) {
    if (hasPublishedDoc && impact.length > 0 && !window.confirm(`This Template is used by ${impact.length} content item${impact.length === 1 ? '' : 's'}. Removing the section from the draft preserves historical content values. Continue?`)) return
    sectionsModified.current = true
    setSections(sections.filter((_, current) => current !== index))
  }

  async function save(publish: boolean) {
    setError(null)
    if (!name.trim()) { setError('Name is required.'); return }
    if (!collections.length) { setError('Choose at least one collection under Use With.'); return }
    const generatedSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await submit({ overrides: { slug: slugValue || generatedSlug, status: publish ? 'published' : 'draft', _status: publish ? 'published' : 'draft' } })
  }

  return <div style={{ display: 'grid', gap: '1.5rem', maxWidth: '960px' }} data-testid="template-builder">
    <header>
      <h1 style={{ marginBottom: '0.25rem', textTransform: id ? 'uppercase' : undefined }}>{name || 'Create Template'}</h1>
      <strong>{documentStatus === 'published' ? 'Published' : 'Draft'}</strong>
      {id && <p>Used by: {impact.length} {collections.includes('posts') ? 'Post' : 'content item'}{impact.length === 1 ? '' : 's'}</p>}
      {publishedImpact > 0 && <p role="status">Publishing changes to this Template may affect {publishedImpact} published content item{publishedImpact === 1 ? '' : 's'}.</p>}
    </header>

    <section style={panelStyle} aria-label="Template details">
      <div style={{ display: 'grid', gap: '1rem' }}>
        <label style={fieldStyle}>Name<input aria-label="Name" disabled={disabled} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label style={fieldStyle}>Description<textarea aria-label="Description" disabled={disabled} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <fieldset disabled={disabled} style={{ border: 0, padding: 0 }}><legend>Use With</legend>
          {configuredCollections.map((slug) => <label key={slug} style={{ display: 'block', marginTop: '0.5rem' }}>
            <input type="checkbox" checked={collections.includes(slug)} onChange={() => toggleCollection(slug)} /> {slug[0].toUpperCase() + slug.slice(1)}
          </label>)}
        </fieldset>
      </div>
    </section>

    <section aria-labelledby="template-structure-heading">
      <h2 id="template-structure-heading">Template Structure</h2>
      {id && !existingTemplateLoaded ? <div style={panelStyle}><p>Loading Template structure…</p></div> : !sections.length && <div style={panelStyle}><p>No sections have been added yet.</p></div>}
      <div style={{ display: 'grid', gap: '1rem' }}>{sections.map((section, index) => {
        const type = blockTypes.find((item) => String(item.id) === String(relationID(section.blockType)))
        const designName = designNames.get(String(relationID(section.blockDesign)))
        return <article key={section.key} style={panelStyle}>
          <h3 style={{ marginTop: 0, textTransform: 'uppercase' }}>{section.name}</h3>
          <p>{type?.name ?? 'Registered Block Type'}</p>
          <p>Default Design: {designName ?? 'Loading design…'}</p>
          <p>{section.required ? 'Required' : 'Optional'}</p>
          <p>{section.allowDesignOverride ? 'Editor may change design' : 'Editor uses Template design'}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => beginEdit(index)}>Edit</button>
            <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>Move Up</button>
            <button type="button" disabled={index === sections.length - 1} onClick={() => move(index, 1)}>Move Down</button>
            <button type="button" onClick={() => remove(index)}>Remove</button>
          </div>
        </article>
      })}</div>
      {!selectedType && <button type="button" style={{ marginTop: '1rem' }} onClick={() => setPickerOpen(true)}>+ Add Section</button>}
    </section>

    {pickerOpen && <section style={panelStyle} aria-label="Choose a Block Type"><h2>Choose a Block Type</h2>
      {!blockTypes.length && <p>No published registered Block Types are available.</p>}
      {blockTypes.map((type) => <article key={type.id}><h3>{type.name}</h3><p>{type.description || 'Prominent introductory area for a page or article.'}</p><button type="button" onClick={() => beginAdd(type)}>Add {type.name}</button></article>)}
      <button type="button" onClick={() => setPickerOpen(false)}>Cancel</button>
    </section>}

    {selectedType && <section style={panelStyle} aria-label="Configure section"><h2>{editingIndex === null ? 'Add' : 'Edit'} Section</h2>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <label style={fieldStyle}>Section Name<input aria-label="Section Name" value={sectionName} onChange={(event) => setSectionName(event.target.value)} /></label>
        <p><strong>Block</strong><br />{selectedType.name}</p>
        <label style={fieldStyle}>Default Design<select aria-label="Default Design" value={String(selectedDesign)} onChange={(event) => setSelectedDesign(designs.find((design) => String(design.id) === event.target.value)?.id ?? '')}>
          <option value="">Choose a published Design</option>{designs.filter((design) => String(relationID(design.blockType)) === String(selectedType.id)).map((design) => <option key={design.id} value={String(design.id)}>{design.name}</option>)}
        </select></label>
        <label><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /> Required</label>
        <label><input type="checkbox" checked={allowOverride} onChange={(event) => setAllowOverride(event.target.checked)} /> Allow content editor to change design</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}><button type="button" onClick={saveSection}>{editingIndex === null ? 'Add to Template' : 'Update Section'}</button><button type="button" onClick={() => setSelectedType(null)}>Cancel</button></div>
      </div>
    </section>}

    {error && <p role="alert">{error}</p>}
    <footer style={{ display: 'flex', gap: '0.75rem' }}>
      <button type="button" disabled={disabled} onClick={() => void save(false)}>Save Draft</button>
      <button type="button" disabled={disabled} onClick={() => void save(true)}>{hasPublishedDoc ? 'Publish Changes' : 'Publish Template'}</button>
    </footer>
  </div>
}
