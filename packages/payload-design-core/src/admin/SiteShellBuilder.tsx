'use client'

import { useDocumentInfo, useField, useForm } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'
import { BuilderCore, type BuilderDragItem } from '../builder/BuilderCore'
import { type BuilderPickerElement } from '../builder/BuilderElementPicker'
import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector'
import { RegisteredBlockEditor, NewRegisteredBlock } from '../builder/RegisteredBlockEditor'
import { listBlockDefinitions, getBlockDefinition } from '../blocks/registry'
import { toShellBlock } from '../blocks/adapters'
import { ContentBlock } from '../content/ContentRenderer'
import { createContentNode } from '../content/model'
import { type BuilderInspectorTab } from '../builder/BuilderInspectorTabs'
import { BuilderSidebar, SidebarControls, useBuilderSidebar } from '../builder/BuilderSidebar'
import { shellSidebarNodes, duplicateBuilderNode, locateSidebar } from '../builder/sidebar-model'
import { BuilderPreviewFrame, BuilderPreviewToolbar } from '../builder/BuilderPreviewToolbar'
import {
  BuilderCanvasTree,
  type BuilderNodeDescriptor,
  type BuilderTreeActions,
} from '../builder/BuilderTree'
import { InspectorGesture, markInspectorGesture } from '../builder/InspectorControls'
import { BuilderWorkspace } from '../builder/BuilderWorkspace'
import { DropArea } from '../builder/DropArea'
import { shellInspectorStyles } from '../site-shell'
import { resolveStyle } from '../content/model'
import type { BuilderViewport } from '../builder/contracts'
import type {
  SiteShellElementKind,
  SiteShellLayoutKind,
  SiteShellNode,
  SiteShellRegionSettings,
} from '../site-shell'
import {
  findSiteShellNode,
  insertSiteShellNode,
  moveSiteShellNode,
  moveSiteShellNodeTo,
  removeSiteShellNode,
  updateSiteShellNode,
} from '../site-shell-tree'
import './template-builder.css'

export type SiteShellRegion = 'header' | 'footer'

const layoutDefinitions: BuilderPickerElement[] = [
  ['container', 'Container', 'Constrain and group shell elements.'],
  ['row', 'Row', 'Arrange children horizontally.'],
  ['columns', 'Columns', 'Create responsive columns.'],
  ['stack', 'Stack', 'Arrange children vertically.'],
  ['spacer', 'Spacer', 'Add controlled empty space.'],
  ['divider', 'Divider', 'Separate shell areas.'],
].map(([value, label, description]) => ({
  kind: 'layout',
  value,
  label,
  description,
  category: 'layout',
  keywords: [value, label.toLowerCase()],
}))

const elementDescriptions: Record<SiteShellElementKind, [string, string]> = {
  logo: ['Site Logo', 'Uses a logo asset from Site Settings.'],
  siteName: ['Site Name', 'Uses Site Settings.siteName.'],
  navigation: ['Navigation Menu', 'Displays an existing Navigation menu source.'],
  button: ['Button / CTA', 'A call to action link.'],
  search: ['Search', 'A search control preview.'],
  text: ['Text', 'Simple shell text.'],
  richText: ['Rich Text', 'Lexical rich text content.'],
  icon: ['Icon', 'A presentation icon.'],
  image: ['Image', 'A selected Media image.'],
  socialLinks: ['Social Links', 'Uses configured Site Settings social URLs.'],
  mobileMenuToggle: ['Mobile Menu Toggle', 'Controls mobile navigation.'],
  copyright: ['Copyright', 'Dynamic copyright composition.'],
  currentYear: ['Current Year', 'Always represents the current year.'],
}

const headerElements: SiteShellElementKind[] = [
  'logo',
  'siteName',
  'navigation',
  'button',
  'search',
  'text',
  'richText',
  'icon',
  'image',
  'socialLinks',
  'mobileMenuToggle',
]
const footerElements: SiteShellElementKind[] = [
  'logo',
  'siteName',
  'navigation',
  'button',
  'text',
  'richText',
  'icon',
  'image',
  'socialLinks',
  'copyright',
  'currentYear',
]
const ratios = [
  '100',
  '50/50',
  '60/40',
  '40/60',
  '70/30',
  '30/70',
  '33/33/34',
  '25/50/25',
  '25/25/50',
  '25/25/25/25',
]
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
export function SiteTemplateBuilder() {
  const { id } = useDocumentInfo()
  const name = useField<string>({ path: 'name' })
  const slug = useField<string>({ path: 'slug' })
  const description = useField<string>({ path: 'description' })
  const typography = useField<Record<string, unknown>>({ path: 'typography' })
  const colors = useField<Record<string, unknown>>({ path: 'colors' })
  const buttons = useField<Record<string, unknown>>({ path: 'buttons' })
  const dimensions = useField<Record<string, unknown>>({ path: 'dimensions' })
  const mobile = useField<Record<string, unknown>>({ path: 'mobile' })
  const css = useField<string>({ path: 'additionalCSS' })
  const mode = useField<string>({ path: 'assignment.mode' })
  const priority = useField<number>({ path: 'assignment.priority' })
  const [tab, setTab] = useState<'overview' | 'header' | 'footer' | 'styles' | 'assignments'>(
    'overview',
  )
  const [isDefault, setIsDefault] = useState(false)
  useEffect(() => {
    if (!id) return
    fetch('/api/globals/site-settings?depth=0', { credentials: 'same-origin' })
      .then(
        async (
          response,
        ): Promise<{ defaultSiteTemplate?: string | number | { id?: string | number } } | null> =>
          response.ok
            ? ((await response.json()) as {
                defaultSiteTemplate?: string | number | { id?: string | number }
              })
            : null,
      )
      .then((settings) => {
        const selected = settings?.defaultSiteTemplate
        setIsDefault(String(typeof selected === 'object' ? selected?.id : selected) === String(id))
      })
      .catch((): void => undefined)
  }, [id])
  return (
    <div data-testid="site-template-builder" className="template-editor site-shell">
      <header className="template-editor__header">
        <div>
          <h1>{name.value || 'Create Site Template'}</h1>
          {isDefault && <p>Current default Site Template</p>}
        </div>
      </header>
      <nav
        role="tablist"
        aria-label="Site Template sections"
        className="template-editor__view-tabs"
      >
        {(['overview', 'header', 'footer', 'styles', 'assignments'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            type="button"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
          >
            {item === 'styles' ? 'Global Styles' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && (
        <section className="template-editor__document">
          <label>
            Name
            <input
              aria-label="Name"
              value={name.value ?? ''}
              onChange={(event) => name.setValue(event.target.value)}
            />
          </label>
          <label>
            Slug
            <input
              aria-label="Slug"
              value={slug.value ?? ''}
              onChange={(event) => slug.setValue(event.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              aria-label="Description"
              rows={5}
              value={description.value ?? ''}
              onChange={(event) => description.setValue(event.target.value)}
            />
          </label>
        </section>
      )}
      {tab === 'header' && <SiteShellBuilder key="header" region="header" />}
      {tab === 'footer' && <SiteShellBuilder key="footer" region="footer" />}
      {tab === 'styles' && (
        <GlobalStyles
          values={{
            typography: typography.value ?? {},
            colors: colors.value ?? {},
            buttons: buttons.value ?? {},
            dimensions: dimensions.value ?? {},
            mobile: mobile.value ?? {},
            css: css.value ?? '',
          }}
          change={{
            typography: typography.setValue,
            colors: colors.setValue,
            buttons: buttons.setValue,
            dimensions: dimensions.setValue,
            mobile: mobile.setValue,
            css: css.setValue,
          }}
        />
      )}
      {tab === 'assignments' && (
        <section className="template-editor__document">
          <h2>Assignments</h2>
          <p>
            This phase supports the default assignment only. Site Settings remains the authoritative
            selection.
          </p>
          <label>
            Mode
            <input aria-label="Assignment Mode" readOnly value={mode.value ?? 'default'} />
          </label>
          <label>
            Priority
            <input
              aria-label="Assignment Priority"
              type="number"
              value={priority.value ?? 0}
              onChange={(event) => priority.setValue(Number(event.target.value))}
            />
          </label>
        </section>
      )}
    </div>
  )
}

type StyleGroup = 'typography' | 'colors' | 'buttons' | 'dimensions' | 'mobile' | 'css'
type StyleValues = Record<Exclude<StyleGroup, 'css'>, Record<string, unknown>> & { css: string }

const styleTabs: Array<[StyleGroup, string]> = [
  ['typography', 'Typography'],
  ['colors', 'Colors'],
  ['buttons', 'Buttons'],
  ['dimensions', 'Dimensions'],
  ['mobile', 'Mobile Defaults'],
  ['css', 'Additional CSS'],
]
const styleControls: Record<
  Exclude<StyleGroup, 'css'>,
  Array<[string, string, 'text' | 'number' | 'color']>
> = {
  typography: [
    ['bodyFont', 'Body font', 'text'],
    ['headingFont', 'Heading font', 'text'],
    ['baseFontSize', 'Base font size', 'number'],
    ['lineHeight', 'Line height', 'number'],
    ['bodyWeight', 'Body weight', 'text'],
    ['letterSpacing', 'Letter spacing', 'number'],
  ],
  colors: [
    ['background', 'Page background', 'color'],
    ['surface', 'Surface', 'color'],
    ['text', 'Body text', 'color'],
    ['mutedText', 'Muted text', 'color'],
    ['heading', 'Headings', 'color'],
    ['primary', 'Primary', 'color'],
    ['secondary', 'Secondary', 'color'],
    ['accent', 'Accent', 'color'],
    ['border', 'Borders', 'color'],
    ['success', 'Success', 'color'],
    ['warning', 'Warning', 'color'],
    ['error', 'Error', 'color'],
  ],
  buttons: [
    ['fontFamily', 'Font family', 'text'],
    ['fontSize', 'Font size', 'number'],
    ['fontWeight', 'Font weight', 'text'],
    ['borderRadius', 'Corner radius', 'text'],
    ['padding', 'Padding', 'text'],
    ['primaryBackground', 'Primary background', 'color'],
    ['primaryText', 'Primary text', 'color'],
    ['secondaryBackground', 'Secondary background', 'color'],
    ['secondaryText', 'Secondary text', 'color'],
  ],
  dimensions: [
    ['contentWidth', 'Content width', 'number'],
    ['wideWidth', 'Wide width', 'number'],
    ['fullWidth', 'Full width', 'number'],
    ['pagePadding', 'Page padding', 'text'],
    ['sectionSpacing', 'Section spacing', 'text'],
    ['contentSpacing', 'Content spacing', 'text'],
  ],
  mobile: [
    ['breakpoint', 'Tablet breakpoint', 'number'],
    ['mobileBreakpoint', 'Mobile breakpoint', 'number'],
    ['pagePadding', 'Page padding', 'text'],
    ['sectionSpacing', 'Section spacing', 'text'],
    ['baseFontSize', 'Base font size', 'number'],
  ],
}

function GlobalStyles({
  values,
  change,
}: {
  values: StyleValues
  change: { [K in StyleGroup]: (value: K extends 'css' ? string : Record<string, unknown>) => void }
}) {
  const [active, setActive] = useState<StyleGroup>('typography')
  const update = (
    group: Exclude<StyleGroup, 'css'>,
    key: string,
    value: string,
    type: 'text' | 'number' | 'color',
  ) =>
    change[group]({
      ...values[group],
      [key]: type === 'number' && value !== '' ? Number(value) : value,
    })
  return (
    <section className="site-shell__style-editor">
      <aside className="site-shell__style-nav" role="tablist" aria-label="Global style sections">
        {styleTabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
          >
            {label}
          </button>
        ))}
      </aside>
      <div className="site-shell__style-panel" role="tabpanel">
        <header>
          <p className="template-editor__section-label">Global Styles</p>
          <h2>{styleTabs.find(([key]) => key === active)?.[1]}</h2>
        </header>
        {active === 'css' ? (
          <label className="site-shell__json-field">
            <span>Additional CSS</span>
            <small>
              Use custom CSS for advanced adjustments after configuring the visual controls.
            </small>
            <textarea
              aria-label="Additional CSS"
              rows={18}
              value={values.css}
              onChange={(event) => change.css(event.target.value)}
            />
          </label>
        ) : (
          <>
            <div className={`site-shell__control-grid site-shell__control-grid--${active}`}>
              {styleControls[active].map(([key, label, type]) => (
                <label key={key}>
                  <span>{label}</span>
                  <div className={type === 'color' ? 'site-shell__color-control' : undefined}>
                    {type === 'color' && (
                      <input
                        aria-label={`${label} color picker`}
                        type="color"
                        value={String(values[active][key] ?? '#000000')}
                        onChange={(event) => update(active, key, event.target.value, type)}
                      />
                    )}
                    <input
                      aria-label={label}
                      type={type === 'number' ? 'number' : 'text'}
                      value={String(values[active][key] ?? '')}
                      onChange={(event) => update(active, key, event.target.value, type)}
                    />
                  </div>
                </label>
              ))}
            </div>
            {active === 'mobile' && (
              <label className="site-shell__check-control">
                <input
                  type="checkbox"
                  checked={values.mobile.stackColumns !== false}
                  onChange={(event) =>
                    change.mobile({ ...values.mobile, stackColumns: event.target.checked })
                  }
                />{' '}
                Stack columns on small screens
              </label>
            )}
            <details className="site-shell__advanced-json">
              <summary>Advanced JSON</summary>
              <textarea
                aria-label={`${styleTabs.find(([key]) => key === active)?.[1]} JSON`}
                rows={12}
                value={JSON.stringify(values[active], null, 2)}
                onChange={(event) => {
                  try {
                    change[active](JSON.parse(event.target.value))
                  } catch {
                    /* wait for valid JSON */
                  }
                }}
              />
            </details>
          </>
        )}
      </div>
    </section>
  )
}

export function SiteShellBuilder({ region }: { region: SiteShellRegion }) {
  const { disabled } = useForm()
  const { id: documentID } = useDocumentInfo()
  const sidebar = useBuilderSidebar(`site:${documentID ?? 'new'}:${region}`)
  const [sidebarSelected, setSidebarSelected] = useState<string>()
  const [beforeTarget, setBeforeTarget] = useState<string>()
  const layoutField = useField<SiteShellNode[]>({ path: `${region}.layout` })
  const settingsField = useField<SiteShellRegionSettings>({ path: `${region}.settings` })
  const nodes = Array.isArray(layoutField.value) ? layoutField.value : []
  const [selected, setSelected] = useState<SiteShellNode | null>(null)
  const [adding, setAdding] = useState<BuilderDragItem | null>(null)
  const [target, setTarget] = useState('root')
  const [viewport, setViewport] = useState<BuilderViewport>('desktop')
  const [history, setHistory] = useState<SiteShellNode[][]>([])
  const [future, setFuture] = useState<SiteShellNode[][]>([])
  const lastHistoryChange = useRef(0)
  const allowed = region === 'header' ? headerElements : footerElements
  const elementItems: BuilderPickerElement[] = allowed.map((value) => ({
    kind: 'element',
    value,
    label: elementDescriptions[value][0],
    description: elementDescriptions[value][1],
    category: 'site',
    keywords: [value, ...elementDescriptions[value][0].toLowerCase().split(' ')],
  }))
  const items = [
    ...layoutDefinitions,
    ...elementItems,
    ...listBlockDefinitions(region)
      .filter(
        (def) =>
          def.type !== 'column' &&
          ![...layoutDefinitions, ...elementItems].some(
            (item) => item.label === def.label || item.value === def.type,
          ),
      )
      .map((def) => ({
        kind: 'registered',
        value: def.type,
        label: def.label,
        description: def.description,
        category: def.category,
        keywords: def.keywords,
      })),
  ]
  const change = (next: SiteShellNode[], typing = false) => {
    if (disabled) return
    const now = Date.now()
    if (
      InspectorGesture.active
        ? !InspectorGesture.changed
        : InspectorGesture.pending || !typing || now - lastHistoryChange.current > 700
    )
      setHistory((previous) => [...previous.slice(-99), structuredClone(nodes)])
    markInspectorGesture()
    lastHistoryChange.current = typing ? now : 0
    setFuture([])
    layoutField.setValue(next)
    setSelected((current) => (current ? findSiteShellNode(next, current.id) : null))
  }
  const redo = () => {
    const next = future.at(-1)
    if (!next || disabled) return
    setFuture((items) => items.slice(0, -1))
    setHistory((items) => [...items, structuredClone(nodes)])
    layoutField.setValue(next)
    setSelected(null)
    lastHistoryChange.current = 0
  }
  const undo = () => {
    if (disabled) return
    setFuture((items) => [...items, structuredClone(nodes)])
    lastHistoryChange.current = 0
    const previous = history.at(-1)
    if (!previous) return
    setHistory((entries) => entries.slice(0, -1))
    layoutField.setValue(previous)
    setSelected(null)
    setAdding(null)
  }
  const startAdd = (item: BuilderDragItem, parent = 'root', before?: string) => {
    if (disabled) return
    setBeforeTarget(before)
    setAdding(item)
    setTarget(parent)
    setSelected(null)
  }
  const actions: BuilderTreeActions<SiteShellNode> = {
    add: (parent, before) => sidebar.insert({ parent, before }),
    addItem: startAdd,
    edit: (node) => {
      setSidebarSelected(node.id)
      setSelected(node)
      setAdding(null)
    },
    move: (id, direction) => change(moveSiteShellNode(nodes, id, direction)),
    remove: (id) => {
      change(removeSiteShellNode(nodes, id))
      if (selected?.id === id) setSelected(null)
    },
  }
  const describe = (node: SiteShellNode): BuilderNodeDescriptor<SiteShellNode> => ({
    ...describeShellNode(node, viewport),
    style:
      node.type === 'layout' && node.block
        ? undefined
        : resolveStyle(shellInspectorStyles(node), viewport),
  })
  return (
    <BuilderCore
      id={`site-shell-${region}-dnd`}
      onInsert={startAdd}
      onMove={(id, parent, before) => change(moveSiteShellNodeTo(nodes, id, parent, before))}
    >
      <section data-testid={`site-shell-${region}`} className="site-shell__region">
        <div className="site-shell__editor-toolbar">
          <BuilderPreviewToolbar value={viewport} onChange={setViewport} />
          <button
            type="button"
            className="site-shell__undo"
            disabled={disabled || !history.length}
            onClick={undo}
            aria-label="Undo last change"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            disabled={disabled || !future.length}
            onClick={redo}
            aria-label="Redo last change"
          >
            Redo
          </button>
        </div>
        <BuilderWorkspace
          viewport={viewport}
          onViewportChange={setViewport}
          documentLabel="Site Template"
          readOnly={disabled}
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
                nodes: shellSidebarNodes(nodes),
                selected: sidebarSelected ?? selected?.id,
                canEdit: !disabled,
                items: items.map((item) => ({
                  ...item,
                  category: item.category === 'layout' ? 'Layout' : 'Site Elements',
                })),
                onSelect: (id) => {
                  setSidebarSelected(id)
                  const node = findSiteShellNode(nodes, id)
                  if (node) actions.edit(node)
                  else {
                    setSelected(null)
                    setAdding(null)
                  }
                },
                onInsert: (item, target) => startAdd(item, target.parent, target.before),
                onMove: (id, target) =>
                  change(moveSiteShellNodeTo(nodes, id, target.parent, target.before)),
                onDelete: (id) => {
                  actions.remove(id)
                  setSidebarSelected(undefined)
                },
                onDuplicate: (id) => {
                  const node = findSiteShellNode(nodes, id)
                  const position = locateSidebar(shellSidebarNodes(nodes), id)
                  if (node && position) {
                    const copy = duplicateBuilderNode(node)
                    change(
                      insertSiteShellNode(
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
          canvasLabel={`${region} shell canvas`}
          canvasTitle=""
          canvas={
            <BuilderPreviewFrame viewport={viewport}>
              <div className={`site-shell__preview site-shell__preview--${region}`}>
                {region === 'footer' && (
                  <div className="site-shell__sample">Sample page content</div>
                )}
                <DropArea
                  id="root"
                  label={`${region} shell drop area`}
                  add={() => sidebar.insert({ parent: 'root' })}
                  addItem={startAdd}
                >
                  {!nodes.length && (
                    <div className="template-editor__empty">
                      <p>Add the first element to this {region}.</p>
                    </div>
                  )}
                  <BuilderCanvasTree
                    nodes={nodes}
                    actions={actions}
                    describe={describe}
                    id={(node) => node.id}
                    selectedID={sidebarSelected ?? selected?.id}
                  />
                </DropArea>
                {region === 'header' && (
                  <div className="site-shell__sample">Sample page content</div>
                )}
              </div>
            </BuilderPreviewFrame>
          }
          inspectorTitle="Settings"
          inspector={
            selected?.type === 'layout' && selected.block ? (
              <RegisteredBlockEditor
                viewport={viewport}
                node={selected.block}
                change={(block) =>
                  change(updateSiteShellNode(nodes, selected.id, { ...selected, block }), true)
                }
              />
            ) : adding?.kind === 'registered' ? (
              <NewRegisteredBlock
                key={adding.value}
                node={createContentNode(adding.value)}
                cancel={() => setAdding(null)}
                create={(block) => {
                  const node = toShellBlock(block)
                  change(insertSiteShellNode(nodes, target, node, beforeTarget))
                  setSelected(node)
                  setAdding(null)
                  sidebar.inserted()
                }}
              />
            ) : adding || selected ? (
              <SiteShellInspector
                key={
                  selected?.id ?? `${adding?.kind}:${adding?.value}:${target}:${beforeTarget ?? ''}`
                }
                region={region}
                item={adding}
                node={selected}
                viewport={viewport}
                cancel={() => {
                  setAdding(null)
                  setSelected(null)
                }}
                save={(node) => {
                  change(
                    selected
                      ? updateSiteShellNode(nodes, selected.id, node)
                      : insertSiteShellNode(nodes, target, node, beforeTarget),
                    !!selected,
                  )
                  setAdding(null)
                  setSelected(node)
                  setSidebarSelected(node.id)
                  sidebar.inserted()
                }}
              />
            ) : (
              <RegionSettings
                region={region}
                value={settingsField.value ?? {}}
                change={settingsField.setValue}
              />
            )
          }
        />
      </section>
    </BuilderCore>
  )
}

function describeShellNode(
  node: SiteShellNode,
  viewport: BuilderViewport = 'desktop',
): BuilderNodeDescriptor<SiteShellNode> {
  if (node.type === 'layout' && node.block) {
    const definition = getBlockDefinition(node.block.kind)
    return {
      title: node.block.label ?? definition?.label ?? node.block.kind,
      icon: definition?.icon,
      body: definition?.container ? null : <ContentBlock node={node.block} viewport={viewport} />,
      wrap: definition?.container
        ? (children) => (
            <ContentBlock node={node.block!} viewport={viewport}>
              {children}
            </ContentBlock>
          )
        : undefined,
      children: definition?.container
        ? [{ id: node.id, label: 'Block contents', children: node.children ?? [] }]
        : undefined,
    }
  }
  if (node.type === 'element') {
    const label = elementDescriptions[node.element][0]
    return {
      title: label,
      listTitle: label,
      icon: '◆',
      body: (
        <>
          <strong className="template-editor__node-title">{label}</strong>
          <p className="template-editor__node-preview">{previewText(node)}</p>
        </>
      ),
    }
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
  const title =
    node.layout === 'columns'
      ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}`
      : node.layout[0].toUpperCase() + node.layout.slice(1)
  return {
    title,
    listTitle: title,
    icon: '◇',
    body: ['spacer', 'divider'].includes(node.layout) ? (
      <span
        className={`site-shell__layout-preview site-shell__layout-preview--${node.layout}`}
        aria-label={title}
      />
    ) : null,
    children,
    childrenClassName: node.layout === 'columns' ? 'template-editor__columns' : undefined,
    childrenStyle:
      node.layout === 'columns'
        ? { gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' ') }
        : undefined,
  }
}

function previewText(node: Extract<SiteShellNode, { type: 'element' }>) {
  if (node.element === 'siteName') return 'Sample Site Name · from Site Settings'
  if (node.element === 'logo') return 'Site Settings logo'
  if (node.element === 'navigation') return `${String(node.props?.menuSource ?? 'primary')} menu`
  if (node.element === 'socialLinks') return 'Configured social links'
  if (node.element === 'currentYear') return String(new Date().getFullYear())
  if (node.element === 'copyright') return '© [Current Year] [Site Name]'
  return String(node.props?.label ?? node.props?.text ?? elementDescriptions[node.element][1])
}

function createNode(item: BuilderDragItem, existing?: SiteShellNode | null): SiteShellNode {
  if (item.kind === 'layout') {
    const layout = item.value as SiteShellLayoutKind
    return {
      id: existing?.id ?? uid('shell'),
      type: 'layout',
      layout,
      ...(layout === 'columns'
        ? {
            columns: [
              { id: uid('column'), width: 50, children: [] },
              { id: uid('column'), width: 50, children: [] },
            ],
          }
        : ['spacer', 'divider'].includes(layout)
          ? {}
          : { children: [] }),
    }
  }
  const element = item.value as SiteShellElementKind
  const props: Record<string, unknown> =
    element === 'logo'
      ? { source: 'siteSettings.logo', linkToHomepage: true }
      : element === 'siteName'
        ? { source: 'siteSettings.siteName', htmlElement: 'span', linkToHomepage: true }
        : element === 'navigation'
          ? {
              menuSource: 'primary',
              orientation: 'horizontal',
              alignment: 'left',
              itemSpacing: 'medium',
              dropdownBehavior: 'hover',
            }
          : element === 'socialLinks'
            ? {
                source: 'siteSettings.socialLinks',
                networks: ['twitter', 'youtube', 'facebook', 'instagram', 'discord', 'github'],
                showLabels: false,
              }
            : element === 'currentYear'
              ? { source: 'system.currentYear' }
              : element === 'copyright'
                ? { tokens: ['copyright', 'currentYear', 'siteName'] }
                : element === 'button'
                  ? { label: 'Call to action', url: '/', newTab: false, buttonStyle: 'primary' }
                  : element === 'richText'
                    ? { lexical: lexicalDocument('') }
                    : { text: item.label }
  return { id: existing?.id ?? uid('shell'), type: 'element', element, props }
}

function SiteShellInspector({
  item,
  node,
  region,
  viewport,
  cancel,
  save,
}: {
  item: BuilderDragItem | null
  node: SiteShellNode | null
  region: SiteShellRegion
  viewport: BuilderViewport
  cancel: () => void
  save: (node: SiteShellNode) => void
}) {
  const seed = node ?? (item ? createNode(item) : null)
  const [draft, setDraftValue] = useState<SiteShellNode | null>(seed)
  const setDraft = (next: SiteShellNode) => {
    setDraftValue(next)
    if (node) save(next)
  }
  const tab = 'settings' as BuilderInspectorTab
  if (!draft) return null
  const label = draft.type === 'layout' ? draft.layout : elementDescriptions[draft.element][0]
  const props = draft.type === 'element' ? (draft.props ?? {}) : {}
  const setProps = (next: Record<string, unknown>) =>
    draft.type === 'element' && setDraft({ ...draft, props: next })
  if (draft.type === 'layout' && draft.layout === 'columns' && item && !node) {
    /* default is already valid */
  }
  return (
    <section aria-label="Configure Site Shell element">
      <UnifiedBlockInspector
        showFields={false}
        node={{
          id: draft.id,
          label,
          kind:
            draft.type === 'layout'
              ? draft.layout === 'container' || draft.layout === 'stack'
                ? 'group'
                : draft.layout
              : draft.element,
          styles: shellInspectorStyles(draft),
          presentation: draft.appearance,
        }}
        viewport={viewport}
        onChange={(patch) => {
          const next = {
            ...draft,
            responsiveStyles: patch.styles ?? draft.responsiveStyles,
            appearance: patch.presentation ?? draft.appearance,
          }
          setDraft(next)
        }}
      >
        {tab === 'settings' && draft.type === 'layout' && draft.layout === 'columns' && (
          <div className="site-shell__controls">
            <label>
              Column layout
              <select
                aria-label="Column Layout"
                value={draft.columns?.map((column) => column.width).join('/') ?? '50/50'}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    columns: event.target.value.split('/').map((width, index) => ({
                      id: draft.columns?.[index]?.id ?? uid('column'),
                      width: Number(width),
                      children: draft.columns?.[index]?.children ?? [],
                    })),
                  })
                }
              >
                {ratios.map((ratio) => (
                  <option key={ratio}>{ratio}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {tab === 'settings' && draft.type === 'layout' && draft.layout !== 'columns' && (
          <p>This layout accepts nested shell elements.</p>
        )}
        {tab === 'settings' && draft.type === 'element' && (
          <ElementSettings
            element={draft.element}
            props={props}
            setProps={setProps}
            region={region}
          />
        )}
      </UnifiedBlockInspector>
      <div className="site-shell__actions">
        <button type="button" onClick={() => save(draft)}>
          Save Element
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function ElementSettings({
  element,
  props,
  setProps,
  region,
}: {
  element: SiteShellElementKind
  props: Record<string, unknown>
  setProps: (props: Record<string, unknown>) => void
  region: SiteShellRegion
}) {
  const input = (label: string, key: string) => (
    <label key={key}>
      {label}
      <input
        aria-label={label}
        value={String(props[key] ?? '')}
        onChange={(event) => setProps({ ...props, [key]: event.target.value })}
      />
    </label>
  )
  return (
    <div className="site-shell__controls">
      {element === 'navigation' && (
        <>
          <label>
            Menu source
            <select
              aria-label="Menu Source"
              value={String(props.menuSource ?? (region === 'footer' ? 'footer' : 'primary'))}
              onChange={(event) => setProps({ ...props, menuSource: event.target.value })}
            >
              <option value="primary">Primary</option>
              <option value="footer">Footer</option>
            </select>
          </label>
          {['orientation', 'alignment', 'itemSpacing', 'dropdownBehavior'].map((key) =>
            input(key, key),
          )}
        </>
      )}
      {element === 'logo' && (
        <>
          <p>Source: Site Settings logo</p>
          {input('Width', 'width')}
          {input('Maximum width', 'maxWidth')}
          <label>
            <input
              type="checkbox"
              checked={props.linkToHomepage !== false}
              onChange={(event) => setProps({ ...props, linkToHomepage: event.target.checked })}
            />{' '}
            Link to homepage
          </label>
          <label>
            Logo source
            <select
              aria-label="Logo Source"
              value={String(props.source ?? 'siteSettings.logo')}
              onChange={(event) => setProps({ ...props, source: event.target.value })}
            >
              <option value="siteSettings.logo">Default logo</option>
              <option value="siteSettings.darkLogo">Dark logo</option>
            </select>
          </label>
        </>
      )}
      {element === 'siteName' && (
        <>
          <p>Source: Site Settings.siteName</p>
          <label>
            HTML element
            <select
              aria-label="HTML Element"
              value={String(props.htmlElement ?? 'span')}
              onChange={(event) => setProps({ ...props, htmlElement: event.target.value })}
            >
              {['span', 'div', 'p', 'h1', 'h2'].map((tag) => (
                <option key={tag}>{tag}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={props.linkToHomepage !== false}
              onChange={(event) => setProps({ ...props, linkToHomepage: event.target.checked })}
            />{' '}
            Link to homepage
          </label>
        </>
      )}
      {element === 'button' && (
        <>
          {input('Label', 'label')}
          {input('URL', 'url')}
          {input('Internal Page ID', 'page')}
          <label>
            <input
              type="checkbox"
              checked={Boolean(props.newTab)}
              onChange={(event) => setProps({ ...props, newTab: event.target.checked })}
            />{' '}
            Open in new tab
          </label>
          <label>
            Button style
            <select
              aria-label="Button Style"
              value={String(props.buttonStyle ?? 'primary')}
              onChange={(event) => setProps({ ...props, buttonStyle: event.target.value })}
            >
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </>
      )}
      {element === 'text' && input('Text', 'text')}
      {element === 'richText' && (
        <label>
          Rich text
          <textarea
            aria-label="Rich Text"
            rows={6}
            value={lexicalText(props.lexical)}
            onChange={(event) =>
              setProps({ ...props, lexical: lexicalDocument(event.target.value) })
            }
          />
        </label>
      )}
      {element === 'socialLinks' && (
        <>
          <p>Source: Site Settings social URLs</p>
          {input('Networks', 'networks')}
          {input('Spacing', 'spacing')}
          {input('Icon size', 'iconSize')}
          <label>
            <input
              type="checkbox"
              checked={Boolean(props.showLabels)}
              onChange={(event) => setProps({ ...props, showLabels: event.target.checked })}
            />{' '}
            Show labels
          </label>
        </>
      )}
      {element === 'copyright' && <p>Dynamic composition: © [Current Year] [Site Name]</p>}
      {element === 'currentYear' && <p>Dynamic source: current system year</p>}
      {![
        'navigation',
        'logo',
        'siteName',
        'button',
        'text',
        'richText',
        'socialLinks',
        'copyright',
        'currentYear',
      ].includes(element) && input('Label', 'text')}
    </div>
  )
}

function lexicalDocument(text: string) {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: 'ltr',
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: 'ltr',
          format: '',
          indent: 0,
          children: text
            ? [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }]
            : [],
        },
      ],
    },
  }
}

function lexicalText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const root = (value as { root?: { children?: Array<{ children?: Array<{ text?: string }> }> } })
    .root
  return (
    root?.children
      ?.flatMap((paragraph) => paragraph.children?.map((child) => child.text ?? '') ?? [])
      .join('\n') ?? ''
  )
}

function RegionSettings({
  region,
  value,
  change,
}: {
  region: SiteShellRegion
  value: SiteShellRegionSettings
  change: (value: SiteShellRegionSettings) => void
}) {
  return (
    <section>
      <h3>{region[0].toUpperCase() + region.slice(1)} settings</h3>
      <div className="site-shell__controls">
        <label>
          Width mode
          <select
            aria-label="Width Mode"
            value={value.widthMode ?? 'contained'}
            onChange={(event) =>
              change({ ...value, widthMode: event.target.value as 'contained' | 'full' })
            }
          >
            <option value="contained">Contained</option>
            <option value="full">Full width</option>
          </select>
        </label>
        <label>
          Position
          <select
            aria-label="Position"
            value={value.position ?? 'static'}
            onChange={(event) =>
              change({ ...value, position: event.target.value as 'static' | 'sticky' | 'fixed' })
            }
          >
            <option value="static">Static</option>
            <option value="sticky">Sticky</option>
            {region === 'header' && <option value="fixed">Fixed</option>}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(value.transparent)}
            onChange={(event) => change({ ...value, transparent: event.target.checked })}
          />{' '}
          Transparent
        </label>
        {[
          'maxWidth',
          'minHeight',
          'padding',
          'margin',
          'backgroundColor',
          'border',
          'boxShadow',
          'zIndex',
        ].map((key) => (
          <label key={key}>
            {key}
            <input
              aria-label={key}
              value={String(value[key as keyof SiteShellRegionSettings] ?? '')}
              onChange={(event) =>
                change({
                  ...value,
                  [key]: ['maxWidth', 'minHeight', 'zIndex'].includes(key)
                    ? Number(event.target.value)
                    : event.target.value,
                })
              }
            />
          </label>
        ))}
      </div>
    </section>
  )
}
