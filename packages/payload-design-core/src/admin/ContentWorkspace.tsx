'use client'
/* eslint-disable react-hooks/refs -- dnd-kit returns callback refs and live drag state. */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupFieldClientComponent, ClientField, CollectionSlug } from 'payload'
import {
  RenderFields,
  UploadInput,
  RelationshipInput,
  useConfig,
  useDocumentInfo,
  useField,
  useForm,
  useFormFields,
  useNav,
} from '@payloadcms/ui'
import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { BuilderPanels } from '../builder/BuilderWorkspace'
import { BuilderCore } from '../builder/BuilderCore'
import { builderCapabilities } from '../builder/contracts'
import { BlockStyleControls } from '../builder/BlockStyleControls'
import { ContentBlock } from '../content/ContentRenderer'
import {
  containerKinds,
  contentLibrary,
  createContentNode,
  duplicateContent,
  insertContent,
  moveContent,
  removeContent,
  updateContent,
  walkContent,
  textDocument,
  type ContentLayout,
  type ContentNode,
  type ContentKind,
  type Viewport,
} from '../content/model'
import { readPath, templateContentNodes } from '../content/template-adapter'
import type { BlockType, BlockDesign, Template } from '../types'
import './content-workspace.css'

type Extras = { groups: Record<string, string[]>; lexicalSchemaPath: string }
type Snapshot = { layout: ContentLayout | null; values: Record<string, unknown> }
const relationID = (value: unknown): string =>
  value && typeof value === 'object'
    ? String((value as { id: unknown }).id)
    : value
      ? String(value)
      : ''
const blankRichText: unknown = {
  root: {
    type: 'root',
    children: [
      { type: 'paragraph', children: [], direction: null, format: '', indent: 0, version: 1 },
    ],
    direction: null,
    format: '',
    indent: 0,
    version: 1,
  },
}
async function docs<T>(url: string): Promise<T[]> {
  const result: T[] = []
  let page: number | null = 1
  while (page) {
    const response = await fetch(`${url}&page=${page}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('Could not load the editor library. Reload to retry.')
    const batch: { docs: T[]; nextPage: number | null } = await response.json()
    result.push(...batch.docs)
    page = batch.nextPage
  }
  return result
}

export const ContentWorkspace = (
  props: React.ComponentProps<GroupFieldClientComponent> & Extras,
) => {
  const { field, groups, lexicalSchemaPath, readOnly, permissions, indexPath, schemaPath } = props
  const { collectionSlug } = useDocumentInfo()
  const { disabled } = useForm()
  const [ready, setReady] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR controls must stay disabled until event handlers are hydrated.
  useEffect(() => setReady(true), [])
  const lockedForm = Boolean(readOnly || disabled || !ready)
  const nav = useNav()
  const didCollapse = useRef(false)
  useEffect(() => {
    if (nav.hydrated && !didCollapse.current) {
      didCollapse.current = true
      nav.setNavOpen(false)
    }
  }, [nav])
  const layoutField = useField<ContentLayout | null>({ path: 'contentLayout' })
  const valuesField = useField<Record<string, unknown>>({ path: 'templateValues' })
  const templateField = useField<unknown>({ path: 'designTemplate' })
  const allFields = useFormFields(([fields]) => fields)
  const document = useMemo(
    () => Object.fromEntries(Object.entries(allFields).map(([key, value]) => [key, value.value])),
    [allFields],
  )
  const templateID = relationID(templateField.value)
  const locked = Boolean(templateID)
  const capabilities = builderCapabilities(locked ? 'template-content' : 'freeform', lockedForm)
  const [template, setTemplate] = useState<Template | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [types, setTypes] = useState<BlockType[]>([])
  const [designs, setDesigns] = useState<BlockDesign[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [panel, setPanel] = useState<'block' | 'document'>('document')
  const [left, setLeft] = useState(true)
  const [right, setRight] = useState(true)
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1100px)')
    const closeDrawers = () => {
      if (narrow.matches) {
        setLeft(false)
        setRight(false)
      }
    }
    closeDrawers()
    narrow.addEventListener('change', closeDrawers)
    return () => narrow.removeEventListener('change', closeDrawers)
  }, [])
  const [libraryMode, setLibraryMode] = useState<'blocks' | 'list'>('blocks')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [destination, setDestination] = useState<{ parent: string; before?: string }>({
    parent: 'root',
  })
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; last: number }>({
    past: [],
    future: [],
    last: 0,
  })
  const [, setRevision] = useState(0)
  const [mediaCache, setMediaCache] = useState<Record<string, unknown>>({})
  const current: Snapshot = { layout: layoutField.value ?? null, values: valuesField.value ?? {} }
  const nodes = useMemo(
    () =>
      locked
        ? template && String(template.id) === templateID
          ? templateContentNodes(template, document, types, designs, true)
          : []
        : (layoutField.value?.nodes ??
          (document.content
            ? [
                {
                  id: 'legacy_content',
                  kind: 'richText' as const,
                  label: 'Existing content',
                  richText: document.content,
                },
              ]
            : [])),
    [locked, template, templateID, document, types, designs, layoutField.value],
  )
  const active = walkContent(nodes).find((node) => node.id === selected)
  const select = (id: string) => {
    setSelected(id)
    setPanel('block')
    setRight(true)
    if (window.matchMedia('(max-width: 1100px)').matches) setLeft(false)
  }
  const selectAndScroll = (id: string) => {
    select(id)
    window.document
      .getElementById(`editor-${id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  useEffect(() => {
    let alive = true
    Promise.all([
      docs<Template>(
        `/api/design-templates?limit=100&depth=0&where[status][equals]=published&where[_status][equals]=published&where[allowedCollections][contains]=${collectionSlug}`,
      ),
      docs<BlockType>(
        '/api/design-block-types?limit=100&depth=0&where[status][equals]=published&where[_status][equals]=published',
      ),
      docs<BlockDesign>(
        '/api/design-block-designs?limit=100&depth=0&where[status][equals]=published&where[_status][equals]=published',
      ),
    ])
      .then(([templates, types, designs]) => {
        if (alive) {
          setTemplates(templates)
          setTypes(types)
          setDesigns(designs)
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause.message))
      })
    return () => {
      alive = false
    }
  }, [collectionSlug])
  useEffect(() => {
    if (!templateID) return
    const controller = new AbortController()
    fetch(`/api/design-templates/${encodeURIComponent(templateID)}?depth=0`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            'This template is unavailable. Select another template in document settings, or ask a designer to restore it.',
          )
        return response.json() as Promise<Template>
      })
      .then((value) => {
        setTemplate(value)
        setError('')
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [templateID])
  // Media inside JSON is resolved explicitly; Payload relationship depth cannot populate it.
  const mediaIDs = [
    ...new Set(
      walkContent(nodes)
        .flatMap((node) => [
          node.media,
          ...Object.entries(node.values ?? {})
            .filter(([key]) => /image/i.test(key))
            .map(([, value]) => value),
        ])
        .flat()
        .filter((value) => typeof value === 'string' || typeof value === 'number')
        .map(String),
    ),
  ]
    .sort()
    .join(',')
  useEffect(() => {
    let alive = true
    Promise.all(
      mediaIDs
        .split(',')
        .filter(Boolean)
        .map(async (id) => {
          const response = await fetch(`/api/media/${encodeURIComponent(id)}`, {
            credentials: 'same-origin',
          })
          return [id, response.ok ? await response.json() : null] as const
        }),
    )
      .then((entries) => {
        if (alive) setMediaCache(Object.fromEntries(entries))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mediaIDs])
  const resolvedNode = (node: ContentNode): ContentNode => {
    const media = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(media)
        : typeof value === 'string' || typeof value === 'number'
          ? mediaCache[String(value)]
          : value
    const type = types.find((type) => String(type.id) === String(node.blockType))
    const design = designs.find((design) => String(design.id) === String(node.blockDesign))
    return {
      ...node,
      media: media(node.media),
      rendererKey: node.rendererKey ?? type?.rendererKey,
      design: node.design ?? design?.design,
      values: Object.fromEntries(
        Object.entries(node.values ?? {}).map(([key, value]) => [
          key,
          /image/i.test(key) ? media(value) : value,
        ]),
      ),
    }
  }
  function commit(next: Snapshot, typing = false) {
    if (lockedForm) return
    if (JSON.stringify(next) === JSON.stringify(current)) return
    // eslint-disable-next-line react-hooks/purity -- commit is called only by input/drag handlers, never during render.
    const now = Date.now()
    if (!typing || now - history.current.last > 700)
      history.current.past.push(structuredClone(current))
    history.current.past = history.current.past.slice(-100)
    history.current.future = []
    history.current.last = typing ? now : 0
    if (!locked) layoutField.setValue(next.layout)
    valuesField.setValue(next.values)
    setRevision((value) => value + 1)
  }
  function setNodes(next: ContentNode[], typing = false) {
    if (capabilities.editStructure)
      commit({ ...current, layout: { version: 1, nodes: next } }, typing)
  }
  function changeNode(id: string, patch: Partial<ContentNode>, typing = false) {
    const previous = walkContent(nodes).find((node) => node.id === id)
    if (
      !previous ||
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(previous[key as keyof ContentNode]) === JSON.stringify(value),
      )
    )
      return
    setNodes(
      updateContent(nodes, id, (node) => ({ ...node, ...patch })),
      typing,
    )
  }
  function undo(redo = false) {
    const source = redo ? history.current.future : history.current.past
    const next = source.pop()
    if (!next || lockedForm) return
    ;(redo ? history.current.past : history.current.future).push(structuredClone(current))
    history.current.last = 0
    if (!locked) layoutField.setValue(next.layout)
    valuesField.setValue(next.values)
    setRevision((value) => value + 1)
  }
  function add(
    kind: ContentKind,
    parent = destination.parent,
    before = destination.before,
    type?: BlockType,
  ) {
    const node = createContentNode(kind)
    if (type) {
      node.blockType = type.id
      node.rendererKey = type.rendererKey
      node.label = type.name
      node.blockDesign = designs.find(
        (design) => relationID(design.blockType) === String(type.id),
      )?.id
      node.values = {}
    }
    setNodes(insertContent(nodes, node, parent, before))
    select(node.id)
  }
  function changeTemplate(next: string) {
    if (next === templateID) return
    if (
      (nodes.length || Object.keys(current.values).length) &&
      !window.confirm(
        'Change the template? The active layout will change. Existing content is retained so you can switch back.',
      )
    )
      return
    templateField.setValue(templates.find((template) => String(template.id) === next)?.id ?? null)
    setSelected('')
    setPanel('document')
    history.current = { past: [], future: [], last: 0 }
    setError('')
  }
  const renderFields = (names: string[]) => (
    <RenderFields
      fields={
        field.fields.filter(
          (item) => 'name' in item && names.includes(item.name ?? ''),
        ) as ClientField[]
      }
      parentIndexPath={indexPath ?? '0'}
      parentPath=""
      parentSchemaPath={schemaPath ?? ''}
      permissions={permissions ?? {}}
      readOnly={lockedForm}
      forceRender
    />
  )
  const internal = new Set([
    'title',
    'content',
    'contentLayout',
    'templateValues',
    'designOverrides',
    'responsiveDesigns',
    'designTemplate',
  ])
  const gear = (
    <>
      <details open>
        <summary>Template</summary>
        <label>
          Template
          <select
            aria-label="Template"
            disabled={lockedForm || templateField.disabled}
            value={templateID}
            onChange={(event) => changeTemplate(event.target.value)}
          >
            <option value="">No template — freeform blocks</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
            {templateID && !templates.some((template) => String(template.id) === templateID) && (
              <option value={templateID}>Current template (unavailable)</option>
            )}
          </select>
        </label>
        {renderFields((groups.Template ?? []).filter((name) => !internal.has(name)))}
      </details>
      {Object.entries(groups)
        .filter(([name]) => name !== 'Template' && name !== 'Content')
        .map(([name, names]) => {
          const visible = names.filter((name) => !internal.has(name))
          return visible.length ? (
            <details key={name} open>
              <summary>{name}</summary>
              {renderFields(visible)}
            </details>
          ) : null
        })}
    </>
  )
  const bindField = (node: ContentNode) =>
    node.binding && !node.binding.path.startsWith('templateValues.') ? (
      <React.Fragment key={node.id}>{renderFields([node.binding.path])}</React.Fragment>
    ) : (
      <React.Fragment key={node.id}>
        {node.binding?.helpText && <p>{node.binding.helpText}</p>}
        <BoundValue
          key={node.id}
          node={node}
          document={document}
          lexicalSchemaPath={lexicalSchemaPath}
          disabled={lockedForm}
          onValues={(path, value) => {
            const next = structuredClone(current.values)
            const segments = path.replace(/^templateValues\./, '').split('.')
            let cursor = next
            for (const key of segments.slice(0, -1))
              cursor = (
                cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : (cursor[key] = {})
              ) as Record<string, unknown>
            cursor[segments.at(-1)!] = value
            commit({ ...current, values: next }, true)
          }}
        />
      </React.Fragment>
    )
  const editorBody = (node: ContentNode) => {
    if (locked)
      return node.binding ? (
        bindField(node)
      ) : node.kind === 'designed' ? (
        <>
          <ContentBlock node={resolvedNode(node)} viewport={viewport} />
          {node.fields?.map(bindField)}
        </>
      ) : undefined
    if (['heading', 'paragraph', 'quote', 'list'].includes(node.kind))
      return node.richText ? (
        <RenderLexical
          field={{
            name: 'content',
            type: 'richText',
            label: node.label,
            admin: { readOnly: lockedForm },
          }}
          path={`editorText.${node.id}`}
          schemaPath={lexicalSchemaPath}
          value={node.richText as never}
          setValue={(richText) => changeNode(node.id, { richText }, true)}
        />
      ) : (
        <>
          <InlineText
            node={node}
            disabled={lockedForm}
            onChange={(text) => changeNode(node.id, { text }, true)}
          />
          {selected === node.id && (
            <button
              type="button"
              disabled={lockedForm}
              onClick={() => changeNode(node.id, { richText: textDocument(node) })}
            >
              Format text
            </button>
          )}
        </>
      )
    if (node.kind === 'richText')
      return (
        <RenderLexical
          field={{
            name: 'content',
            type: 'richText',
            label: false,
            admin: { readOnly: lockedForm },
          }}
          path={`contentLayout.${node.id}`}
          schemaPath={lexicalSchemaPath}
          value={(node.richText ?? blankRichText) as never}
          setValue={(richText) => changeNode(node.id, { richText }, true)}
        />
      )
    if (['image', 'gallery'].includes(node.kind) && !node.media)
      return (
        <button type="button" onClick={() => select(node.id)}>
          Choose {node.kind}
        </button>
      )
    return undefined
  }
  const tree = (items: ContentNode[], parent = 'root'): React.ReactNode => (
    <>
      {items.map((node) => (
        <React.Fragment key={node.id}>
          {!locked && (
            <Insertion
              parent={parent}
              before={node.id}
              disabled={lockedForm}
              onChoose={() => {
                setDestination({ parent, before: node.id })
                setLeft(true)
                setLibraryMode('blocks')
              }}
            />
          )}
          <EditableNode
            node={node}
            selected={selected === node.id}
            locked={locked || lockedForm}
            onSelect={() => select(node.id)}
            onMove={(direction) => {
              const index = items.findIndex((item) => item.id === node.id)
              const target = direction === -1 ? items[index - 1]?.id : items[index + 2]?.id
              if (
                (direction === -1 && index === 0) ||
                (direction === 1 && index === items.length - 1)
              )
                return
              setNodes(moveContent(nodes, node.id, parent, target))
            }}
            onDuplicate={() => {
              const copy = duplicateContent(node)
              setNodes(insertContent(nodes, copy, parent, items[items.indexOf(node) + 1]?.id))
              select(copy.id)
            }}
            onRemove={() => {
              setNodes(removeContent(nodes, node.id))
              setSelected('')
            }}
          >
            <ContentBlock node={resolvedNode(node)} viewport={viewport} body={editorBody(node)}>
              {containerKinds.has(node.kind) && tree(node.children ?? [], node.id)}
            </ContentBlock>
          </EditableNode>
        </React.Fragment>
      ))}
      {!locked && (
        <Insertion
          parent={parent}
          disabled={lockedForm}
          onChoose={() => {
            setDestination({ parent })
            if (
              items.length === 0 &&
              parent !== 'root' &&
              walkContent(nodes).find((node) => node.id === parent)?.kind === 'columns'
            )
              add('column', parent)
            else {
              setLeft(true)
              setLibraryMode('blocks')
            }
          }}
        />
      )}
    </>
  )
  const issues = Object.entries(allFields).filter(
    ([, value]) => value.valid === false && value.errorMessage,
  )
  return (
    <BuilderCore
      id="content-workspace"
      onInsert={(item, parent, before) =>
        add(
          item.kind as ContentKind,
          parent,
          before,
          types.find((type) => String(type.id) === item.value),
        )
      }
      onMove={(id, parent, before) => {
        if (!locked) setNodes(moveContent(nodes, id, parent, before))
      }}
    >
      <section
        className="content-workspace"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && window.matchMedia('(max-width: 1100px)').matches) {
            setLeft(false)
            setRight(false)
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault()
            event.stopPropagation()
            undo(event.shiftKey)
          }
        }}
      >
        <div className="content-workspace__toolbar">
          <button
            type="button"
            aria-expanded={nav.navOpen}
            onClick={() => nav.setNavOpen(!nav.navOpen)}
          >
            Menu
          </button>
          <button
            type="button"
            aria-expanded={left}
            onClick={() => {
              setLeft(!left)
              if (window.matchMedia('(max-width: 1100px)').matches) setRight(false)
            }}
          >
            Blocks / List view
          </button>
          <button
            type="button"
            disabled={!history.current.past.length || lockedForm}
            onClick={() => undo()}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!history.current.future.length || lockedForm}
            onClick={() => undo(true)}
          >
            Redo
          </button>
          <select
            aria-label="Preview width"
            value={viewport}
            onChange={(event) => setViewport(event.target.value as Viewport)}
          >
            {['desktop', 'tablet', 'mobile'].map((device) => (
              <option key={device}>{device}</option>
            ))}
          </select>
          <button
            type="button"
            aria-expanded={right}
            onClick={() => {
              setRight(!right)
              if (window.matchMedia('(max-width: 1100px)').matches) setLeft(false)
            }}
          >
            Inspector
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {issues.length > 0 && (
          <div role="alert">
            {issues.map(([path, value]) => (
              <button
                type="button"
                key={path}
                onClick={() => {
                  const affected = walkContent(nodes).find(
                    (node) =>
                      node.binding?.path === path ||
                      path.includes(node.id) ||
                      node.fields?.some((field) => field.binding?.path === path),
                  )
                  if (affected) selectAndScroll(affected.id)
                  else {
                    setPanel('document')
                    setRight(true)
                    requestAnimationFrame(() => {
                      const input = window.document.getElementById(
                        `field-${path.replaceAll('.', '__')}`,
                      )
                      input?.scrollIntoView({ block: 'center' })
                      input?.focus()
                    })
                  }
                }}
              >
                {String(value.errorMessage)}
              </button>
            ))}
          </div>
        )}
        <BuilderPanels className="content-workspace__layout" leftOpen={left} rightOpen={right}>
          {left && (
            <aside className="content-workspace__left" aria-label="Block library and hierarchy">
              <button type="button" onClick={() => setLeft(false)}>
                Close left panel
              </button>
              <div role="tablist" aria-label="Blocks and hierarchy">
                {!locked && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={libraryMode === 'blocks'}
                    onClick={() => setLibraryMode('blocks')}
                  >
                    Blocks
                  </button>
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={locked || libraryMode === 'list'}
                  onClick={() => setLibraryMode('list')}
                >
                  List view
                </button>
              </div>
              {locked || libraryMode === 'list' ? (
                <Hierarchy
                  nodes={nodes}
                  selected={selected}
                  locked={locked || lockedForm}
                  onSelect={selectAndScroll}
                  onMove={(id, parent, before) => setNodes(moveContent(nodes, id, parent, before))}
                />
              ) : (
                <>
                  <input
                    aria-label="Search blocks"
                    placeholder="Search blocks…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <select
                    aria-label="Block category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {['All', 'Text', 'Media', 'Layout', 'Designed Blocks'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <p>
                    Insert into{' '}
                    {destination.parent === 'root'
                      ? 'document'
                      : (walkContent(nodes).find((node) => node.id === destination.parent)?.label ??
                        'container')}
                  </p>
                  {contentLibrary
                    .filter(
                      (item) =>
                        (category === 'All' || category === item.category) &&
                        item.label.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((item) => (
                      <LibraryItem
                        key={item.kind}
                        kind={item.kind}
                        label={item.label}
                        disabled={lockedForm}
                        onClick={() => add(item.kind)}
                      />
                    ))}
                  {(category === 'All' || category === 'Designed Blocks') &&
                    types
                      .filter(
                        (type) =>
                          type.rendererKey === 'hero-board' &&
                          type.name.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((type) => (
                        <LibraryItem
                          key={type.id}
                          kind="designed"
                          value={String(type.id)}
                          label={type.name}
                          disabled={lockedForm}
                          onClick={() =>
                            add('designed', destination.parent, destination.before, type)
                          }
                        />
                      ))}
                </>
              )}
            </aside>
          )}
          <div className="content-workspace__center">
            <div className="content-workspace__title">{renderFields(['title'])}</div>
            <div
              className="content-workspace__viewport"
              data-viewport={viewport}
              style={{
                maxWidth: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : undefined,
              }}
            >
              {locked && (!template || String(template.id) !== templateID) ? (
                <p>Loading template…</p>
              ) : (
                tree(nodes)
              )}
            </div>
          </div>
          {right && (
            <aside className="content-workspace__right" aria-label="Inspector">
              <button type="button" onClick={() => setRight(false)}>
                Close inspector
              </button>
              <div role="tablist" aria-label="Inspector tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={panel === 'block'}
                  onClick={() => setPanel('block')}
                >
                  Block
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-label="Document settings"
                  title="Document settings"
                  aria-selected={panel === 'document'}
                  onClick={() => setPanel('document')}
                >
                  ⚙
                </button>
              </div>
              {panel === 'document' ? (
                gear
              ) : !active ? (
                <p>Select a block on the canvas or in List view.</p>
              ) : (
                <>
                  <h3>{active.label ?? active.kind}</h3>
                  {locked ? (
                    <>
                      <p>Template structure and design are locked.</p>
                      {active.binding
                        ? bindField(active)
                        : (active.fields?.map(bindField) ?? (
                            <p>This element has no editable fields.</p>
                          ))}
                    </>
                  ) : (
                    <>
                      <label>
                        Move block into
                        <select
                          aria-label="Move block into"
                          value=""
                          disabled={lockedForm}
                          onChange={(event) => {
                            if (event.target.value)
                              setNodes(moveContent(nodes, active.id, event.target.value))
                          }}
                        >
                          <option value="">Choose destination?</option>
                          {active.kind !== 'column' && <option value="root">Document</option>}
                          {walkContent(nodes)
                            .filter(
                              (node) =>
                                containerKinds.has(node.kind) &&
                                (node.kind === 'columns') === (active.kind === 'column') &&
                                !walkContent([active]).some((child) => child.id === node.id),
                            )
                            .map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.label ?? node.kind}
                              </option>
                            ))}
                        </select>
                      </label>
                      <BlockInspector
                        node={active}
                        disabled={lockedForm}
                        viewport={viewport}
                        designs={designs}
                        types={types}
                        onChange={(patch) => changeNode(active.id, patch)}
                      />
                    </>
                  )}
                </>
              )}
            </aside>
          )}
        </BuilderPanels>
      </section>
    </BuilderCore>
  )
}

function InlineText({
  node,
  disabled,
  onChange,
}: {
  node: ContentNode
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <textarea
      className={`content-workspace__inline content-workspace__inline--${node.kind}`}
      aria-label={node.label ?? node.kind}
      placeholder={`Type ${node.kind}…`}
      value={node.text ?? ''}
      readOnly={disabled}
      rows={node.kind === 'heading' ? 1 : 3}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
function Insertion({
  parent,
  before,
  disabled,
  onChoose,
}: {
  parent: string
  before?: string
  disabled: boolean
  onChoose: () => void
}) {
  const drop = useDroppable({
    id: `insert:${parent}:${before ?? 'end'}`,
    data: { containerID: parent, beforeID: before },
    disabled,
  })
  return (
    <div ref={drop.setNodeRef} className="content-workspace__insert" data-over={drop.isOver}>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Insert block ${before ? 'before block' : 'at end'}`}
        onClick={onChoose}
      >
        +
      </button>
    </div>
  )
}
function LibraryItem({
  kind,
  value,
  label,
  disabled,
  onClick,
}: {
  kind: string
  value?: string
  label: string
  disabled: boolean
  onClick: () => void
}) {
  const drag = useDraggable({
    id: `library:${kind}:${value ?? ''}`,
    data: { library: { kind, value: value ?? kind, label } },
    disabled,
  })
  return (
    <div className="content-workspace__library-item">
      <button
        ref={drag.setNodeRef}
        type="button"
        disabled={disabled}
        {...drag.attributes}
        {...drag.listeners}
        aria-label={`Drag ${label}`}
      >
        ⠿
      </button>
      <button type="button" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </div>
  )
}
function EditableNode({
  node,
  selected,
  locked,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  children,
}: {
  node: ContentNode
  selected: boolean
  locked: boolean
  onSelect: () => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  children: React.ReactNode
}) {
  const drag = useDraggable({ id: `node:${node.id}`, data: { nodeID: node.id }, disabled: locked })
  return (
    <section
      id={`editor-${node.id}`}
      ref={drag.setNodeRef}
      className="content-workspace__node"
      data-selected={selected}
      aria-label={node.label ?? node.kind}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onFocus={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <div className="content-workspace__node-controls">
        <button type="button" onClick={onSelect}>
          {locked ? '🔒 ' : ''}
          {node.label ?? node.kind}
        </button>
        {!locked && (
          <>
            <button
              type="button"
              {...drag.attributes}
              {...drag.listeners}
              aria-label={`Drag ${node.label ?? node.kind}`}
            >
              ⠿
            </button>
            <button type="button" aria-label="Move block up" onClick={() => onMove(-1)}>
              ↑
            </button>
            <button type="button" aria-label="Move block down" onClick={() => onMove(1)}>
              ↓
            </button>
            <button type="button" onClick={onDuplicate}>
              Duplicate
            </button>
            <button type="button" onClick={onRemove}>
              Remove
            </button>
          </>
        )}
      </div>
      {children}
    </section>
  )
}
function Hierarchy({
  nodes,
  selected,
  locked,
  onSelect,
  onMove,
  parent = 'root',
}: {
  nodes: ContentNode[]
  selected: string
  locked: boolean
  onSelect: (id: string) => void
  onMove: (id: string, parent: string, before?: string) => void
  parent?: string
}) {
  return (
    <ul className="content-workspace__hierarchy">
      {nodes.map((node, index) => (
        <li key={node.id}>
          <HierarchyRow
            node={node}
            parent={parent}
            selected={selected === node.id}
            locked={locked}
            onSelect={() => onSelect(node.id)}
            onMove={(direction) => {
              if (
                (direction === -1 && index === 0) ||
                (direction === 1 && index === nodes.length - 1)
              )
                return
              onMove(
                node.id,
                parent,
                direction === -1 ? nodes[index - 1]?.id : nodes[index + 2]?.id,
              )
            }}
          />
          {node.children && (
            <details open>
              <summary>Children</summary>
              <Hierarchy
                nodes={node.children}
                parent={node.id}
                selected={selected}
                locked={locked}
                onSelect={onSelect}
                onMove={onMove}
              />
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}
function HierarchyRow({
  node,
  parent,
  selected,
  locked,
  onSelect,
  onMove,
}: {
  node: ContentNode
  parent: string
  selected: boolean
  locked: boolean
  onSelect: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const drag = useDraggable({
    id: 'outline:' + node.id,
    data: { nodeID: node.id },
    disabled: locked,
  })
  const drop = useDroppable({
    id: 'outline-drop:' + node.id,
    data: { containerID: parent, beforeID: node.id },
    disabled: locked,
  })
  return (
    <div ref={drop.setNodeRef} data-over={drop.isOver} className="content-workspace__outline-row">
      <button type="button" aria-current={selected} onClick={onSelect}>
        {locked ? '?? ' : ''}
        {node.label ?? node.kind}
      </button>
      {!locked && (
        <>
          <button
            ref={drag.setNodeRef}
            type="button"
            {...drag.attributes}
            {...drag.listeners}
            aria-label={'Drag ' + (node.label ?? node.kind) + ' in hierarchy'}
          >
            ?
          </button>
          <button type="button" aria-label="Move up in hierarchy" onClick={() => onMove(-1)}>
            ?
          </button>
          <button type="button" aria-label="Move down in hierarchy" onClick={() => onMove(1)}>
            ?
          </button>
        </>
      )}
    </div>
  )
}
function MediaPicker({
  value,
  onChange,
  many = false,
  disabled = false,
  label = 'Image',
}: {
  value: unknown
  onChange: (value: unknown) => void
  many?: boolean
  disabled?: boolean
  label?: string
}) {
  const { config } = useConfig()
  return (
    <UploadInput
      api={config.routes.api}
      allowCreate
      hasMany={many}
      isSortable={many}
      label={label}
      onChange={onChange}
      path="editor-media"
      readOnly={disabled}
      relationTo="media"
      serverURL={config.serverURL}
      showError={false}
      value={value as never}
    />
  )
}
function BoundValue({
  node,
  document,
  lexicalSchemaPath,
  disabled,
  onValues,
}: {
  node: ContentNode
  document: Record<string, unknown>
  lexicalSchemaPath: string
  disabled: boolean
  onValues: (path: string, value: unknown) => void
}) {
  const binding = node.binding!
  const field = useField({
    path: binding.path,
    disableFormData: binding.path.startsWith('templateValues.'),
  })
  const value = readPath(document, binding.path)
  const update = (value: unknown) =>
    binding.path.startsWith('templateValues.')
      ? onValues(binding.path, value)
      : field.setValue(value)
  if (binding.kind === 'image' || binding.kind === 'images')
    return (
      <MediaPicker
        value={value}
        onChange={update}
        many={binding.kind === 'images'}
        disabled={disabled}
        label={node.label}
      />
    )
  if (binding.kind === 'relationship' && binding.relationTo)
    return (
      <RelationshipInput
        label={node.label}
        relationTo={[binding.relationTo]}
        hasMany={false}
        path={binding.path}
        readOnly={disabled}
        value={
          value
            ? {
                relationTo: binding.relationTo as CollectionSlug,
                value: typeof value === 'object' ? (value as { id: number }).id : (value as number),
              }
            : null
        }
        onChange={(next) => update(next?.value ?? null)}
      />
    )
  if (binding.kind === 'richText')
    return (
      <RenderLexical
        field={{
          name: node.id,
          type: 'richText',
          label: node.label,
          admin: { readOnly: disabled },
        }}
        path={binding.path}
        schemaPath={lexicalSchemaPath}
        value={(value ?? blankRichText) as never}
        setValue={update}
      />
    )
  return (
    <label>
      {node.label}
      {binding.required ? ' *' : ''}
      {binding.kind === 'toggle' ? (
        <input
          type="checkbox"
          disabled={disabled}
          checked={Boolean(value)}
          onChange={(event) => update(event.target.checked)}
        />
      ) : binding.kind === 'select' ? (
        <select
          disabled={disabled}
          value={String(value ?? '')}
          onChange={(event) => update(event.target.value)}
        >
          <option value="">Choose…</option>
          {binding.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : binding.kind === 'longText' ? (
        <textarea
          disabled={disabled}
          value={String(value ?? '')}
          onChange={(event) => update(event.target.value)}
        />
      ) : (
        <input
          disabled={disabled}
          type={binding.kind === 'number' ? 'number' : binding.kind === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          onChange={(event) =>
            update(
              binding.kind === 'number' && event.target.value !== ''
                ? Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
    </label>
  )
}
function BlockInspector({
  node,
  disabled,
  viewport,
  designs,
  types,
  onChange,
}: {
  node: ContentNode
  disabled: boolean
  viewport: Viewport
  designs: BlockDesign[]
  types: BlockType[]
  onChange: (patch: Partial<ContentNode>) => void
}) {
  return (
    <fieldset disabled={disabled} className="content-workspace__inspector-fields">
      <details open>
        <summary>Settings</summary>
        <label>
          Block label
          <input
            value={node.label ?? ''}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
        {node.kind === 'heading' && (
          <label>
            Heading level
            <select
              value={node.level ?? 2}
              onChange={(event) => onChange({ level: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <option key={level} value={level}>
                  H{level}
                </option>
              ))}
            </select>
          </label>
        )}
        {node.kind === 'list' && (
          <label>
            <input
              type="checkbox"
              checked={!!node.ordered}
              onChange={(event) => onChange({ ordered: event.target.checked })}
            />
            Numbered list
          </label>
        )}
        {['button', 'video'].includes(node.kind) && (
          <>
            <label>
              URL
              <input
                value={node.url ?? ''}
                onChange={(event) => onChange({ url: event.target.value })}
              />
            </label>
            <label>
              Text
              <input
                value={node.text ?? ''}
                onChange={(event) => onChange({ text: event.target.value })}
              />
            </label>
          </>
        )}
        {['image', 'gallery'].includes(node.kind) && (
          <MediaPicker
            value={node.media}
            onChange={(media) => onChange({ media })}
            many={node.kind === 'gallery'}
            disabled={disabled}
          />
        )}
        {node.kind === 'image' && (
          <>
            <label>
              Alternative text
              <input
                value={node.alt ?? ''}
                onChange={(event) => onChange({ alt: event.target.value })}
              />
            </label>
            <label>
              Caption
              <input
                value={node.text ?? ''}
                onChange={(event) => onChange({ text: event.target.value })}
              />
            </label>
          </>
        )}
        {node.kind === 'columns' && (
          <button
            type="button"
            onClick={() =>
              onChange({ children: [...(node.children ?? []), createContentNode('column')] })
            }
          >
            Add column
          </button>
        )}
        {node.kind === 'designed' && (
          <>
            <label>
              Design
              <select
                value={node.blockDesign ?? ''}
                onChange={(event) =>
                  onChange({
                    blockDesign: designs.find((design) => String(design.id) === event.target.value)
                      ?.id,
                  })
                }
              >
                <option value="">Choose…</option>
                {designs
                  .filter((design) => relationID(design.blockType) === String(node.blockType))
                  .map((design) => (
                    <option key={design.id} value={design.id}>
                      {design.name}
                    </option>
                  ))}
              </select>
            </label>
            <DesignedFields
              fields={
                types.find((type) => String(type.id) === String(node.blockType))?.fields ?? []
              }
              values={node.values ?? {}}
              disabled={disabled}
              onChange={(values) => onChange({ values })}
            />
          </>
        )}
      </details>
      <details>
        <summary>Style</summary>
        <BlockStyleControls
          value={node.styles}
          viewport={viewport}
          onChange={(styles) => onChange({ styles })}
        />
      </details>
      <details>
        <summary>Advanced</summary>
        <label>
          HTML anchor
          <input
            value={node.anchor ?? ''}
            onChange={(event) => onChange({ anchor: event.target.value })}
          />
        </label>
      </details>
    </fieldset>
  )
}
function DesignedFields({
  fields,
  values,
  disabled,
  onChange,
}: {
  fields: BlockType['fields']
  values: Record<string, unknown>
  disabled: boolean
  onChange: (value: Record<string, unknown>) => void
}) {
  return (
    <>
      {fields.map((field) =>
        field.kind === 'group' ? (
          <fieldset key={field.key}>
            <legend>{field.label}</legend>
            <DesignedFields
              fields={field.children ?? []}
              values={(values[field.key] as Record<string, unknown>) ?? {}}
              disabled={disabled}
              onChange={(value) => onChange({ ...values, [field.key]: value })}
            />
          </fieldset>
        ) : field.kind === 'media' ? (
          <MediaPicker
            key={field.key}
            label={field.label}
            disabled={disabled}
            value={values[field.key]}
            onChange={(value) => onChange({ ...values, [field.key]: value })}
          />
        ) : (
          <label key={field.key}>
            {field.label}
            <input
              disabled={disabled}
              value={String(values[field.key] ?? '')}
              onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
            />
          </label>
        ),
      )}
    </>
  )
}
