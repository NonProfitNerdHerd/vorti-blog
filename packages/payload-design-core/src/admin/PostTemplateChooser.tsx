'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth, useConfig, useDocumentDrawer } from '@payloadcms/ui'
import { EditorDialog } from '../builder/EditorDialog'
import type { Template } from '../types'

/** A schematic preview of the template layout, with no public-content requests. */
function TemplateThumbnail({ template }: { template?: Template }) {
  const rows = Math.min(4, Math.max(1, template?.layout?.length || template?.sections?.length || 1))
  return (
    <svg
      role="img"
      aria-label={template ? `${template.name} layout preview` : 'Blank editor preview'}
      viewBox="0 0 280 140"
    >
      <rect width="280" height="140" fill="var(--theme-elevation-100)" />
      <rect x="35" y="15" width="210" height="110" rx="5" fill="var(--theme-bg)" />
      <rect x="49" y="27" width="105" height="8" rx="3" fill="#7064e8" />
      {template ? (
        Array.from({ length: rows }, (_, index) => (
          <g key={index} transform={`translate(49 ${45 + index * (65 / rows)})`}>
            <rect
              width={index % 2 ? 130 : 182}
              height={Math.min(18, 48 / rows)}
              rx="3"
              fill="var(--theme-elevation-200)"
            />
            <rect x="151" width="31" height={Math.min(18, 48 / rows)} rx="3" fill="#afa8f4" />
          </g>
        ))
      ) : (
        <path d="M130 70h20m-10-10v20" stroke="#aaa" strokeWidth="2" />
      )}
    </svg>
  )
}

export function PostTemplateChooser({
  templates,
  onChoose,
  onCancel,
  onCreated,
  error,
  loading,
  onRetry,
}: {
  templates: Template[]
  onChoose: (id: string) => void
  onCancel: () => void
  onCreated: (template: Template) => void
  error?: string
  loading?: boolean
  onRetry: () => void
}) {
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const { permissions } = useAuth()
  const canCreate = permissions?.collections?.['design-templates']?.create === true
  const [selection, setSelection] = useState('')
  const [search, setSearch] = useState('')
  const [mounted, setMounted] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [saving, setSaving] = useState(false)
  const [templateID, setTemplateID] = useState<number>()
  const [pendingOpen, setPendingOpen] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Portals require the hydrated client document.
  useEffect(() => setMounted(true), [])
  const [TemplateDrawer, , { openDrawer, closeDrawer, isDrawerOpen }] = useDocumentDrawer({
    collectionSlug: 'design-templates',
    id: templateID,
  })
  useEffect(() => {
    if (pendingOpen && templateID != null) {
      openDrawer()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Open the native drawer only after its saved document ID reaches the hook.
      setPendingOpen(false)
    }
  }, [pendingOpen, templateID, openDrawer])
  useEffect(() => {
    const controller = new AbortController()
    const pending = [...templates]
    async function worker() {
      while (pending.length && !controller.signal.aborted) {
        const template = pending.shift()!
        try {
          const response = await fetch(
            `${api}/posts/count?where[designTemplate][equals]=${encodeURIComponent(template.id)}`,
            { credentials: 'include', signal: controller.signal },
          )
          if (response.ok) {
            const result = (await response.json()) as { totalDocs: number }
            setCounts((current) => ({ ...current, [template.id]: result.totalDocs }))
          }
        } catch {
          /* Usage ranking is optional; keep templates available if counts fail. */
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker))
    return () => controller.abort()
  }, [templates, api])
  async function createTemplate() {
    if (!name.trim() || saving) return
    setSaving(true)
    setNameError('')
    try {
      const query = new URLSearchParams({
        'where[name][like]': name.trim(),
        limit: '100',
        depth: '0',
      })
      const existing = await fetch(`${api}/design-templates?${query}`, { credentials: 'include' })
      if (!existing.ok) throw new Error('Unable to check template names. Please retry.')
      const matches = (await existing.json()) as { docs: Template[] }
      if (
        matches.docs.some(
          (item: Template) => item.name.trim().toLowerCase() === name.trim().toLowerCase(),
        )
      )
        throw new Error('A template with this name already exists. Choose another name.')
      const response = await fetch(`${api}/design-templates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          allowedCollections: ['posts'],
          status: 'draft',
          _status: 'draft',
          sections: [],
          layout: [],
        }),
      })
      const result = (await response.json()) as {
        doc: { id: number }
        errors?: { message?: string }[]
      }
      if (!response.ok)
        throw new Error(result.errors?.[0]?.message || 'Unable to create template. Please retry.')
      setTemplateID(result.doc.id)
      setNaming(false)
      setPendingOpen(true)
    } catch (failure) {
      setNameError(failure instanceof Error ? failure.message : 'Unable to create template.')
    } finally {
      setSaving(false)
    }
  }
  if (!mounted) return null
  const ranked = [...templates].sort(
    (a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name),
  )
  return createPortal(
    <>
      <EditorDialog
        open={!isDrawerOpen && !pendingOpen && !naming}
        title="Create a Post · Choose a template"
        onClose={onCancel}
      >
        <div className="post-template-chooser">
          <p>Choose a starting point for your Post. Your changes will belong to this Post.</p>
          {loading && <p role="status">Loading templates…</p>}
          {error && (
            <p role="alert">
              {error}{' '}
              <button type="button" onClick={onRetry}>
                Retry
              </button>
            </p>
          )}
          {templates.length > 6 && (
            <label>
              Search templates
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          )}
          <div className="post-template-chooser__tiles" role="group" aria-label="Post templates">
            {ranked
              .filter((template) => template.name.toLowerCase().includes(search.toLowerCase()))
              .map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className="post-template-tile"
                  aria-pressed={selection === String(template.id)}
                  onClick={() => setSelection(String(template.id))}
                >
                  <TemplateThumbnail template={template} />
                  <strong>{template.name}</strong>
                  <span>
                    {template.description || 'Start with this template’s layout and fields.'}
                  </span>
                  <small>
                    {counts[template.id] ? `${counts[template.id]} posts` : 'Reusable template'}
                  </small>
                </button>
              ))}
            {!search && (
              <button
                type="button"
                className="post-template-tile"
                aria-pressed={selection === 'blank'}
                onClick={() => setSelection('blank')}
              >
                <TemplateThumbnail />
                <strong>Blank</strong>
                <span>
                  Start with an empty block-based editor. Add and arrange your own blocks.
                </span>
              </button>
            )}
            {search &&
              !ranked.some((template) =>
                template.name.toLowerCase().includes(search.toLowerCase()),
              ) && <p>No matching templates.</p>}
          </div>
          <div className="post-template-chooser__footer">
            {canCreate && (
              <button
                type="button"
                onClick={() => {
                  setNaming(true)
                  setNameError('')
                }}
              >
                Create Template
              </button>
            )}
            <div className="post-template-chooser__actions">
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="post-template-chooser__primary"
                disabled={!selection}
                onClick={() => onChoose(selection)}
              >
                Create Post
              </button>
            </div>
          </div>
        </div>
      </EditorDialog>
      <EditorDialog
        open={naming}
        title="Create a Template"
        onClose={() => {
          if (!saving) setNaming(false)
        }}
      >
        <div className="post-template-chooser">
          <p>
            Create a reusable template, not a post. Name it first, then build its layout. It becomes
            available for new posts after publishing.
          </p>
          <label>
            Template name
            <input
              autoFocus
              value={name}
              maxLength={200}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void createTemplate()
                }
              }}
            />
          </label>
          {nameError && <p role="alert">{nameError}</p>}
          <div className="post-template-chooser__actions">
            <button type="button" disabled={saving} onClick={() => setNaming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="post-template-chooser__primary"
              disabled={saving || !name.trim()}
              onClick={() => void createTemplate()}
            >
              {saving ? 'Creating…' : 'Save name and build template'}
            </button>
          </div>
        </div>
      </EditorDialog>
      <TemplateDrawer
        redirectAfterCreate={false}
        onSave={({ doc }) => {
          const template = doc as unknown as Template
          if (template.status === 'published' && template._status === 'published') {
            onCreated(template)
            setSelection(String(template.id))
            closeDrawer()
          }
        }}
      />
    </>,
    document.body,
  )
}
