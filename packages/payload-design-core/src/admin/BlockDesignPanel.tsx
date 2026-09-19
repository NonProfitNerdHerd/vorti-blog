'use client'

import { useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { createRendererRegistry } from '../registry'
import { HeroBoardRenderer } from '../hero-board/HeroBoard'
import { heroBoardSample } from '../hero-board/registration'
import type { DesignPrimitive } from '../types'

const renderers = createRendererRegistry({ 'hero-board': HeroBoardRenderer })
const HeroPreview = renderers.get('hero-board')
const settingNames = ['alignment', 'width', 'spacing', 'imageTreatment', 'overlay', 'textContrast', 'buttonStyle'] as const

export function BlockDesignPanel() {
  const { id } = useDocumentInfo()
  const form = useFormFields(([fields]) => ({
    name: fields.name?.value,
    slug: fields.slug?.value,
    blockType: fields.blockType?.value,
    design: Object.fromEntries(settingNames.map((name) => [name, fields[`design.${name}`]?.value])),
  }))
  const [rendererKey, setRendererKey] = useState<string | null>(null)
  const [dependencies, setDependencies] = useState<{ templates: Array<{ id: string | number; name: string }>; content: Array<{ collection: string; id: string | number }> } | null>(null)
  const [headline, setHeadline] = useState(heroBoardSample.headline)
  const [subheadline, setSubheadline] = useState(heroBoardSample.subheadline)
  const [error, setError] = useState<string | null>(null)
  const typeID = typeof form.blockType === 'object' && form.blockType !== null ? (form.blockType as { id?: string | number }).id : form.blockType

  useEffect(() => {
    if (!typeID) return
    fetch(`/api/design-block-types/${typeID}?depth=0`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setRendererKey(typeof (data as { rendererKey?: unknown } | null)?.rendererKey === 'string' ? (data as { rendererKey: string }).rendererKey : null))
      .catch(() => setRendererKey(null))
  }, [typeID])

  useEffect(() => {
    if (!id) return
    fetch(`/api/design-block-designs/${id}/dependencies`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setDependencies(data as { templates: Array<{ id: string | number; name: string }>; content: Array<{ collection: string; id: string | number }> } | null))
      .catch(() => setDependencies(null))
  }, [id])

  async function duplicate() {
    setError(null)
    const blockType = typeof form.blockType === 'object' && form.blockType !== null ? (form.blockType as { id?: string | number }).id : form.blockType
    if (!blockType) { setError('Select a Block Type before duplicating.'); return }
    const name = `${String(form.name || 'Untitled Design')} Copy`
    const slug = `${String(form.slug || 'design')}-copy-${Date.now().toString(36)}`
    const response = await fetch('/api/design-block-designs', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug, blockType, design: form.design, status: 'draft', _status: 'draft' }),
    })
    if (!response.ok) {
      const failure = await response.json().catch((): null => null) as { errors?: Array<{ message?: string }>; message?: string } | null
      setError(failure?.errors?.map((item) => item.message).filter(Boolean).join('; ') || failure?.message || `Could not duplicate this design (${response.status}).`)
      return
    }
    const body = await response.json() as { doc?: { id?: string | number } }
    if (body.doc?.id) window.location.assign(`/admin/collections/design-block-designs/${body.doc.id}`)
  }

  return <section style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1.5rem' }}>
    <h3>Design Preview</h3>
    <p>Sample values stay in this browser and are never saved as content.</p>
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
      <label>Sample headline <input value={headline} onChange={(event) => setHeadline(event.target.value)} /></label>
      <label>Sample subheadline <input value={subheadline} onChange={(event) => setSubheadline(event.target.value)} /></label>
    </div>
    {typeID && rendererKey === 'hero-board' ? <HeroPreview design={form.design as DesignPrimitive} values={{ ...heroBoardSample, headline, subheadline }} /> : <p>Select a registered Block Type to preview its design.</p>}
    <div style={{ marginTop: '1rem' }}><button type="button" onClick={duplicate}>Duplicate as draft</button></div>
    {error && <p role="alert">{error}</p>}
    {id && <div style={{ marginTop: '1.5rem' }}>
      <h4>Dependencies</h4>
      {dependencies ? <>
        <p>Used by {dependencies.templates.length} Template{dependencies.templates.length === 1 ? '' : 's'}; affects {dependencies.content.length} content item{dependencies.content.length === 1 ? '' : 's'}.</p>
        <ul>{dependencies.templates.map((template) => <li key={template.id}>{template.name}</li>)}</ul>
      </> : <p>Loading dependencies…</p>}
    </div>}
  </section>
}
