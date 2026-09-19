'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { HeroBoardRenderer } from '../hero-board/HeroBoard'
import { heroBoardSample } from '../hero-board/registration'
import type { DesignPrimitive } from '../types'

type Impact = { collection: string; id: string | number; status?: string }

export function TemplateImpactPanel() {
  const { id } = useDocumentInfo()
  const [content, setContent] = useState<Impact[]>([])
  const [preview, setPreview] = useState<DesignPrimitive | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    fetch(`/api/design-templates/${id}/dependencies`, { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : Promise.resolve([]))
      .then((data) => setContent(Array.isArray(data) ? data as Impact[] : []))
      .catch(() => setContent([]))
  }, [id])
  async function loadPreview() {
    if (!id) return
    setPreviewError(null)
    const response = await fetch(`/api/design-templates/${id}?draft=true&depth=0`, { credentials: 'same-origin' })
    if (!response.ok) { setPreviewError('Save a draft before previewing this Template.'); return }
    const template = await response.json() as { sections?: Array<{ blockDesign: number | string; blockType: number | string }> }
    const hero = template.sections?.[0]
    if (!hero) { setPreviewError('This Template has no sections to preview.'); return }
    const [typeResponse, designResponse] = await Promise.all([
      fetch(`/api/design-block-types/${hero.blockType}?depth=0`, { credentials: 'same-origin' }),
      fetch(`/api/design-block-designs/${hero.blockDesign}?depth=0`, { credentials: 'same-origin' }),
    ])
    if (!typeResponse.ok || !designResponse.ok || (await typeResponse.json() as { rendererKey?: string }).rendererKey !== 'hero-board') {
      setPreviewError('Preview is available for Hero Board sections.'); return
    }
    setPreview((await designResponse.json() as { design: DesignPrimitive }).design)
  }
  const counts = Object.entries(content.reduce<Record<string, number>>((result, item) => {
    result[item.collection] = (result[item.collection] ?? 0) + 1
    return result
  }, {}))
  return <section><h3>Template impact</h3><p>Published changes can affect {content.filter((item) => item.status === 'published').length} published content item{content.filter((item) => item.status === 'published').length === 1 ? '' : 's'} ({content.length} linked total).</p>
    <ul>{counts.map(([collection, count]) => <li key={collection}>{count} {collection}</li>)}</ul>
    <button type="button" onClick={loadPreview}>Preview saved draft</button>
    {previewError && <p role="alert">{previewError}</p>}
    {preview && <HeroBoardRenderer design={preview} values={heroBoardSample} />}
  </section>
}
