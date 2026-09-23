'use client'

import { useState } from 'react'
import type { BuilderDragItem } from './BuilderCore'

export type BuilderPickerElement = BuilderDragItem & {
  category: string
  description: string
  keywords: string[]
}

export function BuilderElementPicker({
  categories,
  categoryLabels,
  close,
  elements,
  onChoose,
}: {
  categories: string[]
  categoryLabels: Record<string, string>
  close: () => void
  elements: BuilderPickerElement[]
  onChoose: (item: BuilderDragItem) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const normalized = query.trim().toLowerCase()
  const matches = elements.filter((item) => {
    const matchesCategory = category === 'all' || item.category === category
    const matchesQuery = !normalized || [item.label, item.description, ...item.keywords].some((value) => value.toLowerCase().includes(normalized))
    return matchesCategory && matchesQuery
  })

  return (
    <div role="presentation" className="template-editor__picker-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="element-picker-title" className="template-editor__picker">
        <header className="template-editor__picker-header">
          <div><h2 id="element-picker-title">Add an element</h2><p>Choose what to place in this area.</p></div>
          <button type="button" className="template-editor__picker-close" aria-label="Close element picker" onClick={close}>×</button>
        </header>
        <label className="template-editor__picker-search"><span aria-hidden="true">⌕</span><input autoFocus aria-label="Search elements" type="search" placeholder="Search blocks and elements" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div role="tablist" aria-label="Block categories" className="template-editor__picker-tabs">
          {categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} onClick={() => setCategory(item)}>{item === 'all' ? 'All' : categoryLabels[item]}</button>)}
        </div>
        <div className="template-editor__picker-results">
          {category === 'all' && !query
            ? [...new Set(matches.map((item) => item.category))].map((group) => <section key={group} className="template-editor__picker-section"><h3>{categoryLabels[group]}</h3><div className="template-editor__picker-grid">{matches.filter((item) => item.category === group).map((item) => <PickerOption key={`${item.kind}:${item.value}`} item={item} choose={onChoose} />)}</div></section>)
            : <div className="template-editor__picker-grid">{matches.map((item) => <PickerOption key={`${item.kind}:${item.value}`} item={item} choose={onChoose} />)}</div>}
          {!matches.length && <div className="template-editor__picker-empty"><strong>No matching blocks</strong><span>Try another search or category.</span></div>}
        </div>
      </section>
    </div>
  )
}

function PickerOption({ choose, item }: { choose: (item: BuilderDragItem) => void; item: BuilderPickerElement }) {
  return <button type="button" className="template-editor__picker-card" onClick={() => choose(item)}><span className="template-editor__picker-card-icon" aria-hidden="true">{item.kind === 'layout' ? '▦' : item.kind === 'block' ? '◆' : '¶'}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>
}
