'use client'
/* eslint-disable react-hooks/refs -- Undo history mutations also trigger a React state revision. */

import { useDocumentInfo, useField, useForm, useNav } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'
import { BuilderCore } from '../builder/BuilderCore'
import { BuilderSidebar, SidebarControls, useBuilderSidebar } from '../builder/BuilderSidebar'
import { templateSidebarNodes, duplicateBuilderNode, locateSidebar } from '../builder/sidebar-model'
import { type BuilderInspectorTab } from '../builder/BuilderInspectorTabs'
import {
  BuilderCanvasTree,
  type BuilderNodeDescriptor,
  type BuilderTreeActions,
} from '../builder/BuilderTree'
import { RegisteredBlockEditor, NewRegisteredBlock } from '../builder/RegisteredBlockEditor'
import { listBlockDefinitions, getBlockDefinition } from '../blocks/registry'
import {
  toTemplateBlock,
  templateBlockValue,
  adapterListings,
  adapterPreviewNodes,
  mergeTemplateBlock,
} from '../blocks/adapters'
import { ContentBlock } from '../content/ContentRenderer'
import { createContentNode, walkContent, type ContentNode } from '../content/model'
import { variationsFor, styleOnlyKinds } from '../blocks/variations'
import { VariationPicker } from '../builder/VariationPicker'
import { resolveStyle, templateStyle } from '../content/model'
import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector'
import { InspectorGesture, markInspectorGesture } from '../builder/InspectorControls'
import { EditorHeaderPortal, EditorHistory, EditorName } from '../builder/EditorHeader'
import { BuilderWorkspace } from '../builder/BuilderWorkspace'
import { BuilderPreviewFrame } from '../builder/BuilderPreviewToolbar'
import type { BuilderViewport } from '../builder/contracts'
import { DropArea } from '../builder/DropArea'
import {
  coreEditorElements,
  editorCategoryLabels,
  toLibraryItem,
  type EditorLibraryItem,
} from '../editor-registry'
import {
  findTemplateNode,
  insertTemplateNode,
  moveTemplateNode,
  moveTemplateNodeTo,
  removeTemplateNode,
  updateTemplateNode,
} from '../template-tree'
import type {
  FieldDefinition,
  ID,
  TemplateBlockNode,
  TemplateCustomField,
  TemplateDocumentField,
  TemplateElementStyle,
  TemplateField,
  TemplateFieldKind,
  TemplateLayoutKind,
  TemplateLayoutNode,
  TemplateNode,
} from '../types'
import './template-builder.css'

type BlockTypeOption = {
  id: ID
  name: string
  description?: string
  rendererKey?: string
  fields?: FieldDefinition[]
}
type DesignOption = { id: ID; name: string; blockType: ID }
type Impact = { collection: string; id: ID; status?: string }
type LegacySection = { key: string; name: string; blockType: ID; blockDesign: ID }
type LibraryItem = EditorLibraryItem

const fieldItems = coreEditorElements.filter((item) => item.kind === 'field').map(toLibraryItem)
const panel = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 8,
  padding: '1rem',
} as const
const relationID = (value: unknown): ID | undefined =>
  typeof value === 'string' || typeof value === 'number'
    ? value
    : value && typeof value === 'object' && 'id' in value
      ? (value as { id?: ID }).id
      : undefined
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const columnRatios = [
  '100',
  '50/50',
  '60/40',
  '40/60',
  '70/30',
  '30/70',
  '33/33/34',
  '50/25/25',
  '25/50/25',
  '25/25/50',
  '25/25/25/25',
]
const defaultConfiguredCollections = ['posts']
const defaultRegisteredRendererKeys = ['hero-board']
async function fetchDocs<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) return []
  const body = (await response.json()) as { docs?: T[] }
  return body.docs ?? []
}

type TreeActions = BuilderTreeActions<TemplateNode> & {
  updateStatic: (node: TemplateField, value: string) => void
}
function describeTemplateNode(
  node: TemplateNode,
  actions: TreeActions,
  viewport: BuilderViewport = 'desktop',
  previews = new Map<string, ContentNode>(),
): BuilderNodeDescriptor<TemplateNode> {
  if (node.type === 'layout' && node.block) {
    const definition = getBlockDefinition(node.block.kind)
    return {
      title: node.block.label ?? definition?.label ?? node.block.kind,
      icon: definition?.icon,
      directChildren: true,
      body: definition?.container ? null : (
        <ContentBlock node={previews.get(node.id) ?? node.block} viewport={viewport} />
      ),
      wrap: definition?.container
        ? (children) => (
            <ContentBlock node={templateBlockValue(node)!} viewport={viewport}>
              {children}
            </ContentBlock>
          )
        : undefined,
      children: definition?.container
        ? [{ id: node.id, label: 'Block contents', children: node.children ?? [] }]
        : undefined,
    }
  }
  const title = node.type === 'field' ? node.label : node.type === 'block' ? node.name : node.layout
  const previewText =
    node.type === 'field'
      ? node.content?.source === 'static'
        ? node.content.value
        : node.content?.source === 'document'
          ? node.content.preview || `Sample ${node.content.field}`
          : node.placeholder ||
            (node.fieldType === 'shortText'
              ? 'Click to add heading text'
              : 'Add text for this area.')
      : ''
  const fieldPreview =
    node.type === 'field' &&
    (node.fieldType === 'shortText' ? (
      <div className="template-editor__inline-wrap">
        {node.content?.source === 'document' && (
          <span className="template-editor__binding-badge">↗ {node.content.field}</span>
        )}
        <p
          className="template-editor__node-preview template-editor__node-preview--heading"
          contentEditable={node.content?.source !== 'document'}
          suppressContentEditableWarning
          onClick={(event) => event.stopPropagation()}
          onFocus={() => actions.edit(node)}
          onBlur={(event) => actions.updateStatic(node, event.currentTarget.textContent ?? '')}
        >
          {previewText}
        </p>
      </div>
    ) : ['longText', 'richText'].includes(node.fieldType) ? (
      <p
        className="template-editor__node-preview template-editor__node-preview--paragraph"
        contentEditable={node.content?.source === 'static'}
        suppressContentEditableWarning
        onFocus={() => actions.edit(node)}
        onBlur={(event) => {
          if (node.content?.source === 'static')
            actions.updateStatic(node, event.currentTarget.textContent ?? '')
        }}
      >
        {previewText}
      </p>
    ) : node.fieldType === 'image' ? (
      <div className="template-editor__node-preview--image" />
    ) : node.fieldType === 'images' ? (
      <div className="template-editor__node-preview--gallery">
        <span />
        <span />
        <span />
      </div>
    ) : (
      <p className="template-editor__node-preview">
        {fieldItems.find((item) => item.value === node.fieldType)?.label}
        {node.required ? ' · Required' : ''}
      </p>
    ))
  if (node.type === 'field')
    return {
      title,
      listTitle: node.label,
      bodyAriaLabel: node.label,
      icon: '¶',
      body: fieldPreview,
    }
  if (node.type === 'block')
    return {
      title,
      icon: '◆',
      body: (
        <>
          <strong className="template-editor__node-title">{node.name}</strong>
          <p className="template-editor__node-preview">
            Designed Block · {node.fields.length} mapped field{node.fields.length === 1 ? '' : 's'}
          </p>
        </>
      ),
    }
  const children =
    node.layout === 'columns'
      ? node.columns?.map((column, index) => ({
          id: column.id,
          label: `Column ${index + 1}`,
          listLabel: `Column ${index + 1} · ${column.width}%`,
          className: 'template-editor__column',
          children: column.children,
        }))
      : !['spacer', 'divider'].includes(node.layout)
        ? [{ id: node.id, label: `${node.layout} contents`, children: node.children ?? [] }]
        : undefined
  const layoutTitle =
    node.layout === 'columns'
      ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}`
      : title
  return {
    title: layoutTitle,
    listTitle:
      node.layout === 'columns'
        ? `Columns ${node.columns?.map((column) => column.width).join('/')}`
        : title,
    icon: '▦',
    body: <strong className="template-editor__node-title">{layoutTitle}</strong>,
    children,
    childrenClassName: node.layout === 'columns' ? 'template-editor__columns' : undefined,
    childrenStyle:
      node.layout === 'columns'
        ? { gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' ') }
        : undefined,
  }
}

export function ContentTemplateBuilder({
  configuredCollections = defaultConfiguredCollections,
  registeredRendererKeys = defaultRegisteredRendererKeys,
}: {
  configuredCollections?: string[]
  registeredRendererKeys?: string[]
}) {
  const { id, hasPublishedDoc } = useDocumentInfo()
  const { submit, disabled } = useForm()
  const nameField = useField<string>({ path: 'name' })
  const descriptionField = useField<string>({ path: 'description' })
  const slugField = useField<string>({ path: 'slug' })
  const collectionsField = useField<string[]>({ path: 'allowedCollections' })
  const layoutField = useField<TemplateNode[]>({ path: 'layout' })
  const customFieldsField = useField<TemplateCustomField[]>({ path: 'customFields' })
  const sectionsField = useField<LegacySection[]>({ path: 'sections' })
  const name = nameField.value ?? ''
  const collections = Array.isArray(collectionsField.value) ? collectionsField.value : []
  const nodes = Array.isArray(layoutField.value) ? layoutField.value : []
  const previews = new Map(walkContent(adapterPreviewNodes(nodes)).map((node) => [node.id, node]))
  const customFields = Array.isArray(customFieldsField.value) ? customFieldsField.value : []
  const legacy = Array.isArray(sectionsField.value) ? sectionsField.value : []
  const [types, setTypes] = useState<BlockTypeOption[]>([])
  const [designs, setDesigns] = useState<DesignOption[]>([])
  const [impact, setImpact] = useState<Impact[]>([])
  const [editing, setEditing] = useState<TemplateNode | null>(null)
  const [adding, setAdding] = useState<LibraryItem | null>(null)
  const [variationChooser, setVariationChooser] = useState('')
  const [target, setTarget] = useState('root')
  const [beforeTarget, setBeforeTarget] = useState<string | undefined>()
  const sidebar = useBuilderSidebar(`template:${id ?? 'new'}`)
  const [sidebarSelected, setSidebarSelected] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState<BuilderViewport>('desktop')
  const nav = useNav()
  const collapsed = useRef(false)
  useEffect(() => {
    if (nav.hydrated && !collapsed.current) {
      collapsed.current = true
      nav.setNavOpen(false)
    }
  }, [nav])
  const history = useRef<{
    past: Array<{ nodes: TemplateNode[]; fields: TemplateCustomField[] }>
    future: Array<{ nodes: TemplateNode[]; fields: TemplateCustomField[] }>
  }>({ past: [], future: [] })
  const lastHistoryChange = useRef(0)
  const snapshot = () => structuredClone({ nodes, fields: customFields })
  const record = (typing = false) => {
    const now = Date.now()
    if (
      InspectorGesture.active
        ? !InspectorGesture.changed
        : InspectorGesture.pending || !typing || now - lastHistoryChange.current > 700
    )
      history.current.past.push(snapshot())
    markInspectorGesture()
    lastHistoryChange.current = typing ? now : 0
    history.current.past = history.current.past.slice(-100)
    history.current.future = []
  }
  const restore = (redo = false) => {
    lastHistoryChange.current = 0
    const next = (redo ? history.current.future : history.current.past).pop()
    if (!next) return
    ;(redo ? history.current.past : history.current.future).push(snapshot())
    layoutField.setValue(next.nodes)
    customFieldsField.setValue(next.fields)
    setEditing(null)
  }
  const modified = useRef(false)
  useEffect(() => {
    Promise.all([
      fetchDocs<BlockTypeOption>(
        '/api/design-block-types?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published',
      ),
      fetchDocs<DesignOption>(
        '/api/design-block-designs?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published',
      ),
    ])
      .then(([typeDocs, designDocs]) => {
        setTypes(
          typeDocs.filter(
            (item) => item.rendererKey && registeredRendererKeys.includes(item.rendererKey),
          ),
        )
        setDesigns(designDocs)
      })
      .catch(() => setError('Could not load the registered design library.'))
  }, [registeredRendererKeys])
  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const response = await fetch(`/api/design-templates/${id}?draft=true&depth=0`, {
          credentials: 'same-origin',
        })
        const doc = response.ok
          ? ((await response.json()) as {
              layout?: TemplateNode[]
              customFields?: TemplateCustomField[]
              sections?: LegacySection[]
            })
          : null
        if (!modified.current) {
          if (Array.isArray(doc?.layout)) layoutField.setValue(doc.layout)
          if (Array.isArray(doc?.customFields)) customFieldsField.setValue(doc.customFields)
          if (Array.isArray(doc?.sections)) sectionsField.setValue(doc.sections)
        }
      } catch {
        /* keep current form data */
      }
      try {
        const response = await fetch(`/api/design-templates/${id}/dependencies`, {
          credentials: 'same-origin',
        })
        const body = response.ok ? ((await response.json()) as Impact[]) : []
        setImpact(Array.isArray(body) ? body : [])
      } catch {
        setImpact([])
      }
    }
    void load()
  }, [customFieldsField, id, layoutField, sectionsField])
  const setNodes = (next: TemplateNode[], typing = false) => {
    if (disabled) return
    record(typing)
    modified.current = true
    layoutField.setValue(next)
    setEditing((current) => (current ? findTemplateNode(next, current.id) : null))
  }
  const startAdd = (item: LibraryItem, container = 'root', before?: string) => {
    if (disabled) return
    if (
      item.kind === 'registered' &&
      variationsFor(item.value).length > 1 &&
      !styleOnlyKinds.has(item.value)
    ) {
      const node = toTemplateBlock(createContentNode(item.value))
      setNodes(insertTemplateNode(nodes, container, node, before))
      setEditing(node)
      setSidebarSelected(node.id)
      setVariationChooser(node.id)
      setAdding(null)
      sidebar.inserted()
      return
    }
    setBeforeTarget(before)
    setAdding(item)
    setTarget(container)
    setEditing(null)
  }
  const openPickerFor = (containerID: string, before?: string) =>
    sidebar.insert({ parent: containerID, before })
  const actions: TreeActions = {
    edit: (node) => {
      setSidebarSelected(node.id)
      setEditing(node)
      setAdding(null)
    },
    updateStatic: (node, value) => {
      const next = { ...node, placeholder: value, content: { source: 'static' as const, value } }
      setNodes(updateTemplateNode(nodes, node.id, () => next))
      setEditing(next)
    },
    add: openPickerFor,
    addItem: (item, containerID) => startAdd(item as LibraryItem, containerID),
    move: (nodeID, direction) => setNodes(moveTemplateNode(nodes, nodeID, direction)),
    remove: (nodeID) => {
      if (
        !hasPublishedDoc ||
        !impact.length ||
        window.confirm(
          `This Template is used by ${impact.length} content items. Removed field values remain stored. Continue?`,
        )
      ) {
        setNodes(removeTemplateNode(nodes, nodeID))
        setEditing(null)
        setSidebarSelected(undefined)
      }
    },
  }
  async function save(publish: boolean) {
    if (!name.trim() || !collections.length) {
      setError('Name and Use With are required.')
      return
    }
    await submit({
      overrides: {
        slug:
          slugField.value ||
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        status: publish ? 'published' : 'draft',
        _status: publish ? 'published' : 'draft',
      },
    })
  }
  return (
    <BuilderCore
      id="template-builder-dnd"
      onInsert={(item, containerID, before) => startAdd(item as LibraryItem, containerID, before)}
      onMove={(nodeID, containerID, before) =>
        setNodes(moveTemplateNodeTo(nodes, nodeID, containerID, before))
      }
    >
      <div data-testid="template-builder" className="template-editor">
        <EditorName />
        <EditorHistory
          undo={() => restore()}
          redo={() => restore(true)}
          canUndo={!disabled && Boolean(history.current.past.length)}
          canRedo={!disabled && Boolean(history.current.future.length)}
        />

        {
          <>
            <BuilderWorkspace
              viewport={viewport}
              onViewportChange={setViewport}
              documentLabel="Template"
              readOnly={disabled}
              documentSettings={
                <>
                  <h3>Template Properties</h3>
                  {id && (
                    <p>
                      Used by {impact.length} content item{impact.length === 1 ? '' : 's'}
                    </p>
                  )}
                  <section className="template-editor__document">
                    <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                      Description
                      <textarea
                        aria-label="Description"
                        value={descriptionField.value ?? ''}
                        onChange={(e) => descriptionField.setValue(e.target.value)}
                        style={{
                          display: 'block',
                          width: '100%',
                          minHeight: 88,
                          resize: 'vertical',
                        }}
                      />
                    </label>
                    <fieldset style={{ marginTop: 12 }}>
                      <legend>Use With</legend>
                      {configuredCollections.map((slug) => (
                        <label key={slug}>
                          <input
                            type="checkbox"
                            checked={collections.includes(slug)}
                            onChange={() =>
                              collectionsField.setValue(
                                collections.includes(slug)
                                  ? collections.filter((item) => item !== slug)
                                  : [...collections, slug],
                              )
                            }
                          />{' '}
                          {slug[0].toUpperCase() + slug.slice(1)}
                        </label>
                      ))}
                    </fieldset>
                  </section>
                  <h3>Custom Fields</h3>
                  <CustomFieldsPanel
                    fields={customFields}
                    setFields={(next) => {
                      record()
                      modified.current = true
                      customFieldsField.setValue(next)
                    }}
                  />
                </>
              }
              selectionKey={editing?.id ?? adding?.value}
              libraryOpen={sidebar.open}
              onLibraryOpenChange={sidebar.setOpen}
              libraryTitle=""
              libraryNavigation={null}
              library={null}
              sidebarControls={<SidebarControls state={sidebar} canInsert={!disabled} />}
              sidebar={
                <BuilderSidebar
                  state={sidebar}
                  adapter={{
                    nodes: templateSidebarNodes(nodes),
                    selected: sidebarSelected ?? editing?.id,
                    canEdit: !disabled,
                    items: [
                      ...listBlockDefinitions('template')
                        .filter(
                          (def) =>
                            def.type !== 'column' &&
                            !coreEditorElements.some(
                              (item) => item.label === def.label || item.value === def.type,
                            ),
                        )
                        .map((def) => ({
                          kind: 'registered',
                          value: def.type,
                          label: def.label,
                          category: def.category,
                        })),
                      ...coreEditorElements.map((item) => ({
                        ...toLibraryItem(item),
                        category: editorCategoryLabels[item.category],
                        keywords: item.keywords,
                      })),
                      ...types.map((type) => ({
                        kind: 'block',
                        value: String(type.id),
                        label: type.name,
                        category: 'Designed Blocks',
                      })),
                    ],
                    onSelect: (id) => {
                      setSidebarSelected(id)
                      const node = findTemplateNode(nodes, id)
                      if (node) actions.edit(node)
                      else {
                        setEditing(null)
                        setAdding(null)
                      }
                    },
                    onInsert: (item, target) =>
                      startAdd(item as LibraryItem, target.parent, target.before),
                    onMove: (id, target) =>
                      setNodes(moveTemplateNodeTo(nodes, id, target.parent, target.before)),
                    onDelete: actions.remove,
                    onDuplicate: (id) => {
                      const node = findTemplateNode(nodes, id)
                      const position = locateSidebar(templateSidebarNodes(nodes), id)
                      if (node && position) {
                        const copy = duplicateBuilderNode(node)
                        setNodes(
                          insertTemplateNode(
                            nodes,
                            position.parent,
                            copy,
                            position.siblings[position.index + 1]?.id,
                          ),
                        )
                        actions.edit(copy)
                      }
                    },
                  }}
                />
              }
              canvasNotice={error && <p role="alert">{error}</p>}
              canvasLabel="Template Canvas"
              canvasTitle="Template Canvas"
              canvas={
                <BuilderPreviewFrame viewport={viewport}>
                  <DropArea
                    id="root"
                    label="Template Canvas drop area"
                    add={() => openPickerFor('root')}
                    addItem={(item) => startAdd(item as LibraryItem, 'root')}
                  >
                    {!nodes.length && !legacy.length && (
                      <div className="template-editor__empty">
                        <p>Add the first block to this template.</p>
                      </div>
                    )}
                    <BuilderCanvasTree
                      nodes={nodes}
                      actions={actions}
                      describe={(node) => ({
                        ...describeTemplateNode(node, actions, viewport, previews),
                        before:
                          !disabled &&
                          variationChooser === node.id &&
                          node.type === 'layout' &&
                          node.block ? (
                            <VariationPicker
                              node={templateBlockValue(node)!}
                              initial
                              onChange={(next) =>
                                setNodes(
                                  updateTemplateNode(nodes, node.id, () => toTemplateBlock(next)),
                                )
                              }
                              onDone={() => setVariationChooser('')}
                            />
                          ) : undefined,
                        style: resolveStyle(templateStyle(node.style), viewport),
                      })}
                      id={(node) => node.id}
                      selectedID={sidebarSelected ?? editing?.id}
                    />
                    {legacy.length > 0 && (
                      <section>
                        <h3>Existing Designed Blocks</h3>
                        {legacy.map((section) => (
                          <article key={section.key} style={panel}>
                            <strong>{section.name}</strong>
                            <p>Legacy live reference retained. Rebuild on the canvas when ready.</p>
                          </article>
                        ))}
                      </section>
                    )}
                  </DropArea>
                </BuilderPreviewFrame>
              }
              inspectorTitle="Settings"
              inspector={
                editing?.type === 'layout' && editing.block ? (
                  <RegisteredBlockEditor
                    listings={adapterListings(nodes)}
                    bindingFields={customFields.map((field) => ({
                      path: `templateValues.${field.id}`,
                      label: field.label,
                    }))}
                    viewport={viewport}
                    node={templateBlockValue(editing)!}
                    change={(block) =>
                      setNodes(
                        updateTemplateNode(nodes, editing.id, () =>
                          mergeTemplateBlock(editing, block),
                        ),
                        true,
                      )
                    }
                  />
                ) : adding?.kind === 'registered' ? (
                  <NewRegisteredBlock
                    key={adding.value}
                    node={createContentNode(adding.value)}
                    cancel={() => setAdding(null)}
                    create={(block) => {
                      const node = toTemplateBlock(block)
                      setNodes(insertTemplateNode(nodes, target, node, beforeTarget))
                      setEditing(node)
                      setAdding(null)
                      sidebar.inserted()
                    }}
                  />
                ) : adding || editing ? (
                  <NodeEditor
                    key={
                      editing?.id ??
                      `${adding?.kind}:${adding?.value}:${target}:${beforeTarget ?? ''}`
                    }
                    item={adding}
                    node={editing}
                    types={types}
                    designs={designs}
                    allowedCollections={collections}
                    customFields={customFields}
                    cancel={() => {
                      setAdding(null)
                      setEditing(null)
                    }}
                    create={(node) => {
                      setNodes(insertTemplateNode(nodes, target, node, beforeTarget))
                      setAdding(null)
                      setEditing(node)
                      setSidebarSelected(node.id)
                      sidebar.inserted()
                    }}
                    update={(node) => {
                      setNodes(
                        updateTemplateNode(nodes, node.id, () => node),
                        true,
                      )
                      setEditing(node)
                    }}
                  />
                ) : (
                  <p className="template-editor__inspector-empty">
                    Select a block on the canvas or in List View to edit its settings and styles.
                  </p>
                )
              }
            />
          </>
        }

        <EditorHeaderPortal slot="actions">
          <div className="editor-header__buttons">
            <button type="button" disabled={disabled} onClick={() => void save(false)}>
              Save Draft
            </button>
            <button type="button" disabled={disabled} onClick={() => void save(true)}>
              {hasPublishedDoc ? 'Publish Changes' : 'Publish Template'}
            </button>
          </div>
        </EditorHeaderPortal>
      </div>
    </BuilderCore>
  )
}

// Backward-compatible Payload component export. Existing import-map paths and
// collection configuration continue to resolve `TemplateBuilder` unchanged.
export const TemplateBuilder = ContentTemplateBuilder

const customFieldTypeOptions: Array<{ value: TemplateFieldKind; label: string }> = [
  { value: 'shortText', label: 'Short Text' },
  { value: 'longText', label: 'Multi Paragraph' },
  { value: 'richText', label: 'Rich Text' },
  { value: 'image', label: 'Image' },
  { value: 'images', label: 'Gallery' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'select', label: 'Select' },
  { value: 'link', label: 'Link' },
  { value: 'relationship', label: 'Relationship' },
]

function CustomFieldsPanel({
  fields,
  setFields,
}: {
  fields: TemplateCustomField[]
  setFields: (fields: TemplateCustomField[]) => void
}) {
  const update = (id: string, changes: Partial<TemplateCustomField>) =>
    setFields(fields.map((field) => (field.id === id ? { ...field, ...changes } : field)))
  const move = (index: number, offset: -1 | 1) => {
    const next = [...fields]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setFields(next)
  }
  const add = () =>
    setFields([...fields, { id: uid('custom'), label: 'New field', fieldType: 'longText' }])
  return (
    <section className="template-editor__fields-panel">
      <header>
        <div>
          <h2>Custom Fields</h2>
          <p>
            Define the information editors fill in after selecting this template. Bind these fields
            to elements on the Canvas.
          </p>
        </div>
        <button type="button" className="template-editor__primary-action" onClick={add}>
          + Add field
        </button>
      </header>
      {!fields.length && (
        <div className="template-editor__fields-empty">
          <strong>No custom fields yet</strong>
          <p>Add a field such as an introduction, callout, image, or date.</p>
          <button type="button" onClick={add}>
            Add your first field
          </button>
        </div>
      )}
      <div className="template-editor__field-list">
        {fields.map((field, index) => (
          <article key={field.id} className="template-editor__field-card">
            <div className="template-editor__field-card-header">
              <div>
                <span className="template-editor__field-index">{index + 1}</span>
                <strong>{field.label || 'Untitled field'}</strong>
                <small>
                  {customFieldTypeOptions.find((option) => option.value === field.fieldType)?.label}
                </small>
              </div>
              <div>
                <button
                  type="button"
                  aria-label={`Move ${field.label} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${field.label} down`}
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate ${field.label}`}
                  onClick={() =>
                    setFields([
                      ...fields.slice(0, index + 1),
                      { ...field, id: uid('custom'), label: `${field.label} copy` },
                      ...fields.slice(index + 1),
                    ])
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="template-editor__danger-action"
                  aria-label={`Remove ${field.label}`}
                  onClick={() => setFields(fields.filter((item) => item.id !== field.id))}
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="template-editor__field-grid">
              <label>
                Field label
                <input
                  aria-label={`Field Label ${index + 1}`}
                  value={field.label}
                  onChange={(event) => update(field.id, { label: event.target.value })}
                />
              </label>
              <label>
                Field type
                <select
                  aria-label={`Field Type ${index + 1}`}
                  value={field.fieldType}
                  onChange={(event) =>
                    update(field.id, { fieldType: event.target.value as TemplateFieldKind })
                  }
                >
                  {customFieldTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="template-editor__field-wide">
                Help text
                <textarea
                  aria-label={`Field Help Text ${index + 1}`}
                  rows={2}
                  value={field.helpText ?? ''}
                  onChange={(event) => update(field.id, { helpText: event.target.value })}
                />
              </label>
              <label>
                Placeholder
                <input
                  aria-label={`Field Placeholder ${index + 1}`}
                  value={field.placeholder ?? ''}
                  onChange={(event) => update(field.id, { placeholder: event.target.value })}
                />
              </label>
              <label className="template-editor__checkbox">
                <input
                  type="checkbox"
                  checked={!!field.required}
                  onChange={(event) => update(field.id, { required: event.target.checked })}
                />{' '}
                Required
              </label>
              {field.fieldType === 'select' && (
                <label className="template-editor__field-wide">
                  Options <span>one per line</span>
                  <textarea
                    aria-label={`Field Options ${index + 1}`}
                    rows={4}
                    value={(field.options ?? []).join('\n')}
                    onChange={(event) =>
                      update(field.id, {
                        options: event.target.value
                          .split('\n')
                          .map((option) => option.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              )}
              {field.fieldType === 'relationship' && (
                <label>
                  Related collection
                  <input
                    aria-label={`Related Collection ${index + 1}`}
                    value={field.relationTo ?? ''}
                    placeholder="posts"
                    onChange={(event) => update(field.id, { relationTo: event.target.value })}
                  />
                </label>
              )}
            </div>
            <p className="template-editor__field-id">Stable ID: {field.id}</p>
          </article>
        ))}
      </div>
      <p className="template-editor__retention-note">
        Removing a definition does not delete values already stored on content.
      </p>
    </section>
  )
}

function NodeEditor({
  item,
  node,
  types,
  designs,
  allowedCollections,
  customFields,
  cancel,
  create,
  update,
}: {
  item: LibraryItem | null
  node: TemplateNode | null
  types: BlockTypeOption[]
  designs: DesignOption[]
  allowedCollections: string[]
  customFields: TemplateCustomField[]
  cancel: () => void
  create: (node: TemplateNode) => void
  update: (node: TemplateNode) => void
}) {
  const kind = item?.kind ?? node?.type
  const value =
    item?.value ??
    (node?.type === 'field'
      ? node.fieldType
      : node?.type === 'layout'
        ? node.layout
        : node?.type === 'block'
          ? String(relationID(node.blockType))
          : '')
  const [label, setLabel] = useState(node?.type === 'field' ? node.label : (item?.label ?? ''))
  const [required, setRequired] = useState(node?.type === 'field' && !!node.required)
  const [help, setHelp] = useState(node?.type === 'field' ? (node.helpText ?? '') : '')
  const [placeholder, setPlaceholder] = useState(
    node?.type === 'field' ? (node.placeholder ?? '') : '',
  )
  const existingContent = node?.type === 'field' ? node.content : undefined
  const [contentSource, setContentSource] = useState<
    'custom' | 'customField' | 'static' | 'document'
  >(existingContent?.source ?? 'custom')
  const [customFieldID, setCustomFieldID] = useState(
    existingContent?.source === 'customField' ? existingContent.fieldId : '',
  )
  const [documentField, setDocumentField] = useState<TemplateDocumentField>(
    existingContent?.source === 'document'
      ? existingContent.field
      : value === 'image'
        ? 'featuredImage'
        : 'title',
  )
  const [staticValue, setStaticValue] = useState(
    existingContent?.source === 'static'
      ? existingContent.value
      : node?.type === 'field'
        ? (node.placeholder ?? '')
        : '',
  )
  const [ratio, setRatio] = useState(
    node?.type === 'layout' && node.layout === 'columns'
      ? (node.columns?.map((column) => column.width).join('/') ?? '50/50')
      : '50/50',
  )
  const type = types.find((option) => String(option.id) === value)
  const block = node?.type === 'block' ? node : null
  const [design, setDesign] = useState<ID | ''>(relationID(block?.blockDesign) ?? '')
  const allowOverride = false
  const [fields, setFields] = useState<TemplateField[]>(block?.fields ?? [])
  const [mappings, setMappings] = useState<Record<string, string>>(block?.slotMappings ?? {})
  const tab = 'settings' as BuilderInspectorTab
  const [style, setStyle] = useState<TemplateElementStyle>(node?.style ?? {})
  const documentFields: Array<{ label: string; value: TemplateDocumentField }> =
    value === 'image'
      ? allowedCollections.includes('posts')
        ? [{ label: 'Featured Image', value: 'featuredImage' }]
        : []
      : [
          { label: 'Title', value: 'title' },
          { label: 'Excerpt', value: 'excerpt' },
          { label: 'Publication date', value: 'publishedAt' },
          { label: 'Author', value: 'author' },
          { label: 'Slug', value: 'slug' },
        ]
  function finish() {
    let next: TemplateNode
    if (kind === 'layout') {
      const layout = value as TemplateLayoutKind
      const oldColumns =
        node?.type === 'layout' && node.layout === 'columns' ? (node.columns ?? []) : []
      next = {
        id: node?.id ?? uid('layout'),
        type: 'layout',
        layout,
        style,
        ...(layout === 'columns'
          ? {
              columns: ratio.split('/').map((width, index) => ({
                id: oldColumns[index]?.id ?? uid('column'),
                width: Number(width),
                children: oldColumns[index]?.children ?? ([] as TemplateNode[]),
              })),
            }
          : ['spacer', 'divider'].includes(layout)
            ? {}
            : {
                children: node?.type === 'layout' ? (node.children ?? []) : ([] as TemplateNode[]),
              }),
      } as TemplateLayoutNode
    } else if (kind === 'field') {
      if (contentSource === 'customField' && !customFieldID) return
      const content =
        contentSource === 'static'
          ? { source: 'static' as const, value: staticValue }
          : contentSource === 'document'
            ? {
                source: 'document' as const,
                field: documentField,
                preview: staticValue || undefined,
              }
            : contentSource === 'customField'
              ? {
                  source: 'customField' as const,
                  fieldId: customFieldID,
                  preview: placeholder || undefined,
                }
              : { source: 'custom' as const }
      next = {
        id: node?.id ?? uid('field'),
        type: 'field',
        fieldType: value as TemplateFieldKind,
        label: label || item?.label || 'Untitled',
        required,
        helpText: help,
        placeholder: contentSource === 'static' ? staticValue : placeholder,
        content,
        style,
      } as TemplateField
    } else {
      if (!type || !design) return
      next = {
        id: node?.id ?? uid('block'),
        type: 'block',
        name: type.name,
        blockType: type.id,
        blockDesign: design,
        allowDesignOverride: allowOverride,
        fields,
        slotMappings: mappings,
        style,
      } as TemplateBlockNode
    }
    if (node) update(next)
    else create(next)
  }
  const contentRevision = JSON.stringify([
    label,
    required,
    help,
    placeholder,
    contentSource,
    customFieldID,
    documentField,
    staticValue,
    ratio,
    design,
    fields,
    mappings,
  ])
  const previousContent = useRef(contentRevision)
  const commitContent = useRef(finish)
  commitContent.current = finish
  useEffect(() => {
    if (previousContent.current === contentRevision) return
    previousContent.current = contentRevision
    if (node) commitContent.current()
  }, [contentRevision, node])
  function mapSlot(slot: FieldDefinition) {
    const old = mappings[slot.key]
    if (old) {
      setMappings(Object.fromEntries(Object.entries(mappings).filter(([key]) => key !== slot.key)))
      setFields(fields.filter((field) => field.id !== old))
      return
    }
    const field: TemplateField = {
      id: uid('field'),
      type: 'field',
      fieldType:
        slot.kind === 'media'
          ? 'image'
          : slot.kind === 'textarea'
            ? 'longText'
            : slot.kind === 'boolean'
              ? 'toggle'
              : 'shortText',
      label: slot.label,
      required: !!slot.required,
    }
    setFields([...fields, field])
    setMappings({ ...mappings, [slot.key]: field.id })
  }
  const control = { display: 'grid', gap: 6 } as const
  return (
    <section aria-label="Configure element">
      <UnifiedBlockInspector
        node={{
          id: node?.id ?? 'new',
          label:
            item?.label ??
            (node?.type === 'field'
              ? node.label
              : node?.type === 'block'
                ? node.name
                : node?.layout),
          kind:
            kind === 'layout'
              ? value === 'container' || value === 'stack'
                ? 'group'
                : value
              : ((
                  { shortText: 'heading', longText: 'paragraph', image: 'image' } as Record<
                    string,
                    string
                  >
                )[value] ?? value),
          styles: templateStyle(style),
          presentation: style.presentation,
          anchor: style.anchor,
        }}
        onChange={(patch) => {
          const next = {
            ...style,
            ...(patch.styles ? { responsive: patch.styles } : {}),
            ...(patch.presentation ? { presentation: patch.presentation } : {}),
            ...(patch.anchor !== undefined ? { anchor: patch.anchor } : {}),
          }
          setStyle(next)
          if (node) update({ ...node, style: next })
        }}
      >
        {tab === 'settings' && kind === 'field' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={control}>
              <span>Block label</span>
              <input
                aria-label="Block Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
            <label style={control}>
              <span>Content source</span>
              <select
                aria-label="Content Source"
                value={contentSource}
                onChange={(event) => setContentSource(event.target.value as typeof contentSource)}
              >
                <option value="customField">Template custom field</option>
                <option value="document">
                  {allowedCollections.includes('pages') && !allowedCollections.includes('posts')
                    ? 'Page'
                    : 'Post'}{' '}
                  field
                </option>
                <option value="static">Static template text</option>
                <option value="custom">Legacy canvas field</option>
              </select>
            </label>
            {contentSource === 'customField' && (
              <label style={control}>
                <span>Custom field</span>
                <select
                  aria-label="Custom Field"
                  value={customFieldID}
                  onChange={(event) => setCustomFieldID(event.target.value)}
                >
                  <option value="">Choose a custom field</option>
                  {customFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
                </select>
                {!customFields.length && (
                  <small>Create fields in the Custom Fields tab first.</small>
                )}
              </label>
            )}
            {contentSource === 'document' && (
              <label style={control}>
                <span>Document field</span>
                <select
                  aria-label="Document Field"
                  value={documentField}
                  onChange={(event) =>
                    setDocumentField(event.target.value as TemplateDocumentField)
                  }
                >
                  {documentFields.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {contentSource === 'static' && (
              <label style={control}>
                <span>Text</span>
                <input
                  aria-label="Static Text"
                  value={staticValue}
                  onChange={(event) => setStaticValue(event.target.value)}
                />
              </label>
            )}
            {contentSource === 'document' && value !== 'image' && (
              <label style={control}>
                <span>Preview text</span>
                <input
                  aria-label="Preview Text"
                  value={staticValue}
                  placeholder={`Sample ${documentField}`}
                  onChange={(event) => setStaticValue(event.target.value)}
                />
              </label>
            )}
            {(contentSource === 'custom' || contentSource === 'customField') && (
              <label style={control}>
                <span>Preview text</span>
                <input
                  aria-label="Placeholder"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />{' '}
              Required
            </label>
            <label style={control}>
              <span>Help text</span>
              <textarea
                aria-label="Help Text"
                value={help}
                onChange={(e) => setHelp(e.target.value)}
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </label>
            <p style={{ margin: 0, color: 'var(--theme-elevation-600)', fontSize: 12 }}>
              The Block Label identifies this element in List View. It is not rendered on the page.
            </p>
          </div>
        )}
        {tab === 'settings' && kind === 'layout' && value === 'columns' && (
          <div>
            <h3 style={{ marginTop: 0 }}>Choose a variation</h3>
            <div
              role="radiogroup"
              aria-label="Column Layout"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}
            >
              {columnRatios.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={ratio === option}
                  onClick={() => setRatio(option)}
                  style={{
                    padding: 10,
                    border:
                      ratio === option
                        ? '2px solid var(--theme-success-500)'
                        : '1px solid var(--theme-elevation-250)',
                    borderRadius: 6,
                    background: ratio === option ? 'var(--theme-elevation-100)' : 'transparent',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: option
                        .split('/')
                        .map((width) => `${width}fr`)
                        .join(' '),
                      gap: 3,
                      height: 30,
                      marginBottom: 6,
                    }}
                  >
                    {option.split('/').map((_, index) => (
                      <span
                        key={index}
                        style={{
                          display: 'block',
                          border: '1px solid currentColor',
                          borderRadius: 2,
                        }}
                      />
                    ))}
                  </span>
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'settings' && kind === 'layout' && value !== 'columns' && (
          <p>Use the Style tab to control this layout’s presentation.</p>
        )}
        {tab === 'settings' && kind === 'block' && type && (
          <div style={{ display: 'grid', gap: 14 }}>
            <p>
              Component: <strong>{type.name}</strong>
            </p>
            <label style={control}>
              <span>Design</span>
              <select
                aria-label="Design"
                value={String(design)}
                onChange={(e) =>
                  setDesign(
                    designs.find((option) => String(option.id) === e.target.value)?.id ?? '',
                  )
                }
                style={{ width: '100%' }}
              >
                <option value="">Choose Design</option>
                {designs
                  .filter((option) => String(relationID(option.blockType)) === String(type.id))
                  .map((option) => (
                    <option key={option.id} value={String(option.id)}>
                      {option.name}
                    </option>
                  ))}
              </select>
            </label>
            <h3>Content mapping</h3>
            {(type.fields ?? []).map((slot) => {
              const mapped = fields.find((field) => field.id === mappings[slot.key])
              return (
                <section key={slot.key} style={{ ...panel, padding: 10 }}>
                  <strong>{slot.label}</strong>{' '}
                  <button type="button" onClick={() => mapSlot(slot)}>
                    {mapped ? 'Remove mapped field' : 'Add / Map Field'}
                  </button>
                  {mapped && (
                    <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                      <label style={control}>
                        <span>Field label</span>
                        <input
                          aria-label={`${slot.label} Field Label`}
                          value={mapped.label}
                          onChange={(event) =>
                            setFields(
                              fields.map((field) =>
                                field.id === mapped.id
                                  ? { ...field, label: event.target.value }
                                  : field,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!mapped.required}
                          onChange={(event) =>
                            setFields(
                              fields.map((field) =>
                                field.id === mapped.id
                                  ? { ...field, required: event.target.checked }
                                  : field,
                              ),
                            )
                          }
                        />{' '}
                        Required
                      </label>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </UnifiedBlockInspector>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button type="button" onClick={finish}>
          Save Element
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}
