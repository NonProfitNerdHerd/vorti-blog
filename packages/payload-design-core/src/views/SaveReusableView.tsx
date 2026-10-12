'use client'
import { useState } from 'react'
import type { ContentNode } from '../content/model'
import { defaultView, type ViewConfig } from './model'
export function SaveReusableView({
  node,
  onChange,
  disabled,
}: {
  node: ContentNode
  onChange: (patch: Partial<ContentNode>) => void
  disabled?: boolean
}) {
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    const props = node.props || {},
      ids = (value: unknown) =>
        String(value || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
    const configuration: ViewConfig = {
      ...defaultView,
      layout: props.layout === 'list' ? 'list-1' : 'grid-1',
      query: {
        source: props.collection === 'pages' ? 'pages' : 'posts',
        ids: ids(props.ids),
        rules:
          props.collection !== 'pages' && ids(props.categories).length
            ? [{ field: 'categories', operator: 'any', values: ids(props.categories) }]
            : [],
        limit: Number(props.limit) || 6,
        sort: String(props.sort || '-publishedAt'),
      },
      image: props.showImage !== false,
      excerpt: props.showExcerpt !== false,
      taxonomy: props.showTaxonomy !== false,
      date: props.showDate !== false,
    }
    try {
      const response = await fetch('/api/saved-views', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Reusable content view',
          configuration,
          _status: 'published',
        }),
      })
      const result = (await response.json()) as {
        doc?: { id: number }
        errors?: Array<{ message: string }>
      }
      if (!response.ok || !result.doc)
        throw new Error(
          result.errors?.[0]?.message ||
            'Unable to create view. Saved Views require design permission.',
        )
      const styles = Object.fromEntries(
        Object.entries(node.styles || {}).map(([device, values]) => [
          device,
          Object.fromEntries(
            Object.entries(values || {}).filter(([key]) =>
              /^(margin|padding|width|minWidth|maxWidth)/.test(key),
            ),
          ),
        ]),
      )
      onChange({
        kind: 'savedView',
        props: { viewID: String(result.doc.id) },
        variation: undefined,
        targetStyles: undefined,
        styles,
        presentation: undefined,
      })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details>
      <summary>Make reusable</summary>
      <label>
        View name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled || busy} />
      </label>
      <p>
        Creates a published Saved View and replaces this placement with its reference. Further
        layout changes belong to the central view.
      </p>
      <button type="button" disabled={disabled || busy} onClick={save}>
        {busy ? 'Saving…' : 'Save as reusable view'}
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
