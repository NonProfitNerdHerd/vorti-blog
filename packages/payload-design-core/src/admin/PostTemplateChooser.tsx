'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDocumentDrawer } from '@payloadcms/ui'
import { Plus } from 'lucide-react'
import { EditorDialog } from '../builder/EditorDialog'
import type { Template } from '../types'

/** The drawer mounts the existing template edit view, including TemplateBuilder. */
export function PostTemplateChooser({ templates, onChoose, onCancel, onCreated, error, loading, onRetry }: {
  templates: Template[]
  onChoose: (id: string) => void
  onCancel: () => void
  onCreated: (template: Template) => void
  error?: string
  loading?: boolean
  onRetry: () => void
}) {
  const [selection, setSelection] = useState('')
  const [search, setSearch] = useState('')
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Portals must wait for the client document after hydration.
  useEffect(() => setMounted(true), [])
  const [TemplateDrawer, , { openDrawer, closeDrawer, isDrawerOpen }] = useDocumentDrawer({ collectionSlug: 'design-templates' })
  const selected = templates.find(template => String(template.id) === selection)
  if (!mounted) return null
  // Keep chooser controls outside the native Post form: Enter in a search or
  // selector must never submit a Post before the explicit Create Post action.
  return createPortal(<>
    <EditorDialog open={!isDrawerOpen} title="Select a template" onClose={onCancel}>
      <div className="post-template-chooser">
        <p>Choose a starting point for your Post. Your changes will belong to this Post.</p>
        {loading && <p role="status">Loading templates…</p>}
        {error && <p role="alert">{error} <button type="button" onClick={onRetry}>Retry</button></p>}
        {templates.length > 10 && <label>Search templates<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>}
        <div className="post-template-chooser__select">
          <label>Template<select value={selection} onChange={event => setSelection(event.target.value)}>
            <option value="" disabled>Select a template…</option>
            <option value="blank">Blank</option>
            {templates.filter(template => String(template.id) === selection || template.name.toLowerCase().includes(search.toLowerCase())).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select></label>
          <button type="button" aria-label="Create a Template" title="Create a Template" onClick={openDrawer}><Plus size={20} /></button>
        </div>
        <p className="post-template-chooser__description">{selection === 'blank' ? 'Start with an empty block-based editor. Add and arrange your own blocks.' : selected?.description || (selected ? 'Start with this template’s layout and fields.' : 'Select a template or Blank to continue.')}</p>
        <div className="post-template-chooser__actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="post-template-chooser__primary" disabled={!selection} onClick={() => onChoose(selection)}>Create Post</button></div>
      </div>
    </EditorDialog>
    <TemplateDrawer initialData={{ allowedCollections: ['posts'] }} redirectAfterCreate={false} onSave={({ doc }) => {
      const template = doc as unknown as Template
      onCreated(template)
      setSelection(String(template.id))
      closeDrawer()
    }} />
  </>, document.body)
}
