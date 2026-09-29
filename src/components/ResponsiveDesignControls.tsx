'use client'

import { useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

type ID = string | number
type Device = 'desktop' | 'tablet' | 'mobile'
type OverrideValue = Partial<Record<Device, ID | null>>
type TemplateBlock = { id: string; name: string; blockType: ID; blockDesign: ID; allowDesignOverride?: boolean }
type TemplateSection = { key: string; name: string; blockType: ID; blockDesign: ID; allowDesignOverride?: boolean }
type TemplateNode = TemplateBlock & { type: 'block'; children?: TemplateNode[]; columns?: Array<{ children: TemplateNode[] }> }
type Design = { id: ID; name: string }

function collectBlocks(nodes: TemplateNode[] = []): TemplateBlock[] {
  return nodes.flatMap((node) => {
    const nested = [...collectBlocks(node.children), ...(node.columns ?? []).flatMap((column) => collectBlocks(column.children))]
    return node.type === 'block' ? [node, ...nested] : nested
  })
}

export function ResponsiveDesignControls() {
  const selected = useFormFields(([fields]) => fields.designTemplate?.value)
  const templateID = typeof selected === 'object' && selected !== null ? (selected as { id?: ID }).id : selected as ID | undefined
  const { value: rawValue, setValue, disabled } = useField<Record<string, OverrideValue>>()
  const value = useMemo(() => rawValue && typeof rawValue === 'object' ? rawValue : {}, [rawValue])
  const [blocks, setBlocks] = useState<TemplateBlock[]>([])
  const [designs, setDesigns] = useState<Record<string, Design[]>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!templateID) return
    let active = true
    async function load() {
      try {
        const response = await fetch(`/api/design-templates/${templateID}?depth=0`, { credentials: 'same-origin' })
        if (!response.ok) throw new Error('Responsive design options could not be loaded.')
        const template = await response.json() as { sections?: TemplateSection[]; layout?: TemplateNode[] }
        const nextBlocks = [
          ...(template.sections ?? []).map((section) => ({ id: section.key, ...section })),
          ...collectBlocks(template.layout),
        ].filter((block) => block.allowDesignOverride)
        const uniqueTypes = [...new Set(nextBlocks.map((block) => String(block.blockType)))]
        const entries = await Promise.all(uniqueTypes.map(async (type) => {
          const designsResponse = await fetch(`/api/design-block-designs?depth=0&limit=100&where[blockType][equals]=${encodeURIComponent(type)}&where[status][equals]=published&where[_status][equals]=published`, { credentials: 'same-origin' })
          if (!designsResponse.ok) throw new Error('Responsive design variants could not be loaded.')
          const result = await designsResponse.json() as { docs?: Design[] }
          return [type, result.docs ?? []] as const
        }))
        if (active) { setBlocks(nextBlocks); setDesigns(Object.fromEntries(entries)); setError(null) }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Responsive design options could not be loaded.')
      }
    }
    void load()
    return () => { active = false }
  }, [templateID])

  function update(block: TemplateBlock, device: Device, design: string) {
    const current = value[block.id] ?? {}
    const next = { ...current, [device]: design || null }
    setValue({ ...value, [block.id]: next })
  }

  if (!templateID) return null
  if (error) return <p role="alert">{error}</p>
  if (!blocks.length) return <p className="responsive-designs__empty">This Template has no blocks with design overrides enabled.</p>
  return <section className="responsive-designs">
    <header className="responsive-designs__header">
      <div><p className="responsive-designs__eyebrow">Responsive design</p><h3>Tailor every screen</h3></div>
      <p>Keep the Template default, or choose a published variant for each viewport. Content remains shared.</p>
    </header>
    {blocks.map((block) => <fieldset key={block.id} className="responsive-designs__block">
      <legend>{block.name}</legend>
      <div className="responsive-designs__devices">
        {(['desktop', 'tablet', 'mobile'] as const).map((device) => <label key={device}>
          <span aria-hidden="true" className={`responsive-designs__icon responsive-designs__icon--${device}`} />
          <span>{device[0].toUpperCase() + device.slice(1)}</span>
          <select disabled={disabled} value={String(value[block.id]?.[device] ?? '')} onChange={(event) => update(block, device, event.target.value)}>
            <option value="">Template default</option>
            {(designs[String(block.blockType)] ?? []).map((design) => <option key={design.id} value={String(design.id)}>{design.name}</option>)}
          </select>
        </label>)}
      </div>
    </fieldset>)}
  </section>
}
