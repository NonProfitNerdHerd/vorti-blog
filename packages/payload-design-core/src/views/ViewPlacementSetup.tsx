'use client'
import { useState, type ReactNode } from 'react'
import { useCategoriesEnabled } from '../categories'
import type { ContentNode } from '../content/model'
import { defaultView, viewForBlock, type ViewConfig, type QueryRule } from './model'

export function ViewPlacementSetup({
  node,
  onChange,
  renderPicker,
}: {
  node: ContentNode
  onChange: (patch: Partial<ContentNode>) => void
  renderPicker?: (
    collection: string,
    label: string,
    value: string,
    change: (value: string) => void,
  ) => ReactNode
}) {
  const categoriesEnabled = useCategoriesEnabled()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const view = viewForBlock(node.kind)
  if (!view || node.props?.viewID) return null
  const setup = node.props?.viewSetup as { name?: string; configuration?: ViewConfig } | undefined
  const configuration = setup?.configuration ?? {
    ...defaultView,
    layout: view.key,
    query: {
      ...defaultView.query,
      sort: view.family === 'events' ? 'publishedAt' : '-publishedAt',
    },
  }
  const name = setup?.name ?? view.label
  const update = (patch: Partial<ViewConfig>, nextName = name) =>
    onChange({
      props: {
        ...node.props,
        viewSetup: { name: nextName, configuration: { ...configuration, ...patch } },
      },
    })
  const query = (patch: Partial<ViewConfig['query']>) =>
    update({ query: { ...configuration.query, ...patch } })
  const rules = configuration.query.rules ?? []
  const filter = (field: 'categories' | 'tags', ids: string) => {
    const existing = rules.find((rule) => rule.field === field)
    query({
      rules: [
        ...rules.filter((rule) => rule.field !== field),
        {
          field,
          operator: existing?.operator ?? 'any',
          values: ids.split(',').filter(Boolean),
        },
      ].filter((rule) => rule.values.length) as QueryRule[],
    })
  }
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/saved-views', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || view.label,
          configuration,
          _status: 'published',
        }),
      })
      const result = (await response.json()) as {
        doc?: { id: string | number }
        errors?: Array<{ message: string }>
      }
      if (!response.ok || !result.doc?.id)
        throw new Error(
          result.errors?.[0]?.message || 'Unable to create view. Design permission is required.',
        )
      const { viewSetup: _setup, ...props } = node.props ?? {}
      onChange({ props: { ...props, viewID: String(result.doc.id) } })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset disabled={busy} className="view-placement-setup">
      <legend>Set up {view.label}</legend>
      <p>
        Create a reusable view here, or choose an existing Saved View below. Publishing changes to
        that view updates every placement.
      </p>
      <label>
        View name
        <input value={name} onChange={(event) => update({}, event.target.value)} />
      </label>
      {view.family !== 'events' && (
        <label>
          Content source
          <select
            value={configuration.query.source}
            onChange={(event) =>
              query({ source: event.target.value as 'posts' | 'pages', rules: [] })
            }
          >
            <option value="posts">Posts</option>
            <option value="pages">Pages</option>
          </select>
        </label>
      )}
      {configuration.query.source === 'posts' && (
        <>
          {(['categories', 'tags'] as const)
            .filter((field) => categoriesEnabled || field !== 'categories')
            .map((field) => (
              <div key={field}>
                {renderPicker?.(
                  field,
                  field === 'categories' ? 'Categories' : 'Tags',
                  rules.find((rule) => rule.field === field)?.values.join(',') ?? '',
                  (value) => filter(field, value),
                )}
                <label>
                  {field === 'categories' ? 'Category matching' : 'Tag matching'}
                  <select
                    value={rules.find((rule) => rule.field === field)?.operator ?? 'any'}
                    onChange={(event) =>
                      query({
                        rules: [
                          ...rules.filter((rule) => rule.field !== field),
                          {
                            field,
                            operator: event.target.value as QueryRule['operator'],
                            values: rules.find((rule) => rule.field === field)?.values ?? [],
                          },
                        ],
                      })
                    }
                  >
                    <option value="any">Any selected</option>
                    <option value="all">All selected</option>
                    <option value="exclude">Exclude selected</option>
                  </select>
                </label>
              </div>
            ))}
          <label>
            Combine filters
            <select
              value={configuration.query.match ?? 'and'}
              onChange={(event) => query({ match: event.target.value as 'and' | 'or' })}
            >
              <option value="and">Match all filters</option>
              <option value="or">Match any filter</option>
            </select>
          </label>
        </>
      )}
      <label>
        Items per page
        <input
          type="number"
          min={1}
          max={100}
          value={configuration.query.limit ?? 9}
          onChange={(event) => query({ limit: Number(event.target.value) })}
        />
      </label>
      <label>
        Pagination
        <select
          value={configuration.pagination ?? 'numbers'}
          onChange={(event) =>
            update({ pagination: event.target.value as ViewConfig['pagination'] })
          }
        >
          <option value="numbers">Page numbers</option>
          <option value="navigation">Previous / next</option>
          <option value="more">Load more</option>
          <option value="none">None</option>
        </select>
      </label>
      <button type="button" disabled={busy} onClick={create}>
        {busy ? 'Creating view…' : 'Create view and use here'}
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  )
}
