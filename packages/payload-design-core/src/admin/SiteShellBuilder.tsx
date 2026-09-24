'use client'

import { useDocumentInfo, useField } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { BuilderCore, type BuilderDragItem } from '../builder/BuilderCore'
import { BuilderElementPicker, type BuilderPickerElement } from '../builder/BuilderElementPicker'
import { BuilderInspectorTabs, type BuilderInspectorTab } from '../builder/BuilderInspectorTabs'
import { BuilderLibraryButton } from '../builder/BuilderLibrary'
import { BuilderPreviewFrame, BuilderPreviewToolbar } from '../builder/BuilderPreviewToolbar'
import { BuilderCanvasTree, BuilderListView, type BuilderNodeDescriptor, type BuilderTreeActions } from '../builder/BuilderTree'
import { BuilderWorkspace } from '../builder/BuilderWorkspace'
import { DropArea } from '../builder/DropArea'
import type { BuilderViewport } from '../builder/contracts'
import type { ResponsiveValue, SiteShellElementKind, SiteShellLayoutKind, SiteShellNode, SiteShellRegionSettings, SiteShellStyle, SiteShellStyleScalar } from '../site-shell'
import { insertSiteShellNode, moveSiteShellNode, moveSiteShellNodeTo, removeSiteShellNode, updateSiteShellNode } from '../site-shell-tree'
import './template-builder.css'

export type SiteShellRegion = 'header' | 'footer'

const layoutDefinitions: BuilderPickerElement[] = [
  ['container', 'Container', 'Constrain and group shell elements.'], ['row', 'Row', 'Arrange children horizontally.'],
  ['columns', 'Columns', 'Create responsive columns.'], ['stack', 'Stack', 'Arrange children vertically.'],
  ['spacer', 'Spacer', 'Add controlled empty space.'], ['divider', 'Divider', 'Separate shell areas.'],
].map(([value, label, description]) => ({ kind: 'layout', value, label, description, category: 'layout', keywords: [value, label.toLowerCase()] }))

const elementDescriptions: Record<SiteShellElementKind, [string, string]> = {
  logo: ['Site Logo', 'Uses a logo asset from Site Settings.'], siteName: ['Site Name', 'Uses Site Settings.siteName.'],
  navigation: ['Navigation Menu', 'Displays an existing Navigation menu source.'], button: ['Button / CTA', 'A call to action link.'],
  search: ['Search', 'A search control preview.'], text: ['Text', 'Simple shell text.'], richText: ['Rich Text', 'Lexical rich text content.'],
  icon: ['Icon', 'A presentation icon.'], image: ['Image', 'A selected Media image.'], socialLinks: ['Social Links', 'Uses configured Site Settings social URLs.'],
  mobileMenuToggle: ['Mobile Menu Toggle', 'Controls mobile navigation.'], copyright: ['Copyright', 'Dynamic copyright composition.'],
  currentYear: ['Current Year', 'Always represents the current year.'],
}

const headerElements: SiteShellElementKind[] = ['logo', 'siteName', 'navigation', 'button', 'search', 'text', 'richText', 'icon', 'image', 'socialLinks', 'mobileMenuToggle']
const footerElements: SiteShellElementKind[] = ['logo', 'siteName', 'navigation', 'button', 'text', 'richText', 'icon', 'image', 'socialLinks', 'copyright', 'currentYear']
const ratios = ['100', '50/50', '60/40', '40/60', '70/30', '30/70', '33/33/34', '25/50/25', '25/25/50', '25/25/25/25']
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const isResponsiveStyle = (value: ResponsiveValue<SiteShellStyleScalar> | undefined): value is { desktop: SiteShellStyleScalar; tablet?: SiteShellStyleScalar; mobile?: SiteShellStyleScalar } => typeof value === 'object' && value !== null && 'desktop' in value

export function SiteTemplateBuilder() {
  const { id } = useDocumentInfo()
  const name = useField<string>({ path: 'name' }); const slug = useField<string>({ path: 'slug' }); const description = useField<string>({ path: 'description' })
  const typography = useField<Record<string, unknown>>({ path: 'typography' }); const colors = useField<Record<string, unknown>>({ path: 'colors' }); const buttons = useField<Record<string, unknown>>({ path: 'buttons' }); const dimensions = useField<Record<string, unknown>>({ path: 'dimensions' }); const mobile = useField<Record<string, unknown>>({ path: 'mobile' }); const css = useField<string>({ path: 'additionalCSS' })
  const mode = useField<string>({ path: 'assignment.mode' }); const priority = useField<number>({ path: 'assignment.priority' })
  const [tab, setTab] = useState<'overview' | 'header' | 'footer' | 'styles' | 'assignments'>('overview')
  const [isDefault, setIsDefault] = useState(false)
  useEffect(() => { if (!id) return; fetch('/api/globals/site-settings?depth=0', { credentials: 'same-origin' }).then(async (response): Promise<{ defaultSiteTemplate?: string | number | { id?: string | number } } | null> => response.ok ? await response.json() as { defaultSiteTemplate?: string | number | { id?: string | number } } : null).then((settings) => { const selected = settings?.defaultSiteTemplate; setIsDefault(String(typeof selected === 'object' ? selected?.id : selected) === String(id)) }).catch((): void => undefined) }, [id])
  const jsonEditor = (label: string, field: typeof typography) => <label className="site-shell__json-field"><span>{label}</span><textarea aria-label={label} rows={12} value={JSON.stringify(field.value ?? {}, null, 2)} onChange={(event) => { try { field.setValue(JSON.parse(event.target.value)) } catch { /* keep editing until JSON is valid */ } }} /></label>
  return <div data-testid="site-template-builder" className="template-editor site-shell"><header className="template-editor__header"><div><h1>{name.value || 'Create Site Template'}</h1>{isDefault && <p>Current default Site Template</p>}</div></header>
    <nav role="tablist" aria-label="Site Template sections" className="template-editor__view-tabs">{(['overview', 'header', 'footer', 'styles', 'assignments'] as const).map((item) => <button key={item} role="tab" type="button" aria-selected={tab === item} onClick={() => setTab(item)}>{item === 'styles' ? 'Global Styles' : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
    {tab === 'overview' && <section className="template-editor__document"><label>Name<input aria-label="Name" value={name.value ?? ''} onChange={(event) => name.setValue(event.target.value)} /></label><label>Slug<input aria-label="Slug" value={slug.value ?? ''} onChange={(event) => slug.setValue(event.target.value)} /></label><label>Description<textarea aria-label="Description" rows={5} value={description.value ?? ''} onChange={(event) => description.setValue(event.target.value)} /></label></section>}
    {tab === 'header' && <SiteShellBuilder region="header" />}
    {tab === 'footer' && <SiteShellBuilder region="footer" />}
    {tab === 'styles' && <section className="site-shell__styles">{jsonEditor('Typography', typography)}{jsonEditor('Colors', colors)}{jsonEditor('Buttons', buttons)}{jsonEditor('Dimensions', dimensions)}{jsonEditor('Mobile defaults', mobile)}<label className="site-shell__json-field"><span>Additional CSS</span><textarea aria-label="Additional CSS" rows={12} value={css.value ?? ''} onChange={(event) => css.setValue(event.target.value)} /></label></section>}
    {tab === 'assignments' && <section className="template-editor__document"><h2>Assignments</h2><p>This phase supports the default assignment only. Site Settings remains the authoritative selection.</p><label>Mode<input aria-label="Assignment Mode" readOnly value={mode.value ?? 'default'} /></label><label>Priority<input aria-label="Assignment Priority" type="number" value={priority.value ?? 0} onChange={(event) => priority.setValue(Number(event.target.value))} /></label></section>}
  </div>
}

export function SiteShellBuilder({ region }: { region: SiteShellRegion }) {
  const layoutField = useField<SiteShellNode[]>({ path: `${region}.layout` })
  const settingsField = useField<SiteShellRegionSettings>({ path: `${region}.settings` })
  const nodes = Array.isArray(layoutField.value) ? layoutField.value : []
  const [selected, setSelected] = useState<SiteShellNode | null>(null); const [adding, setAdding] = useState<BuilderDragItem | null>(null); const [target, setTarget] = useState('root'); const [picker, setPicker] = useState<string | null>(null); const [libraryOpen, setLibraryOpen] = useState(true); const [libraryMode, setLibraryMode] = useState<'blocks' | 'list'>('blocks'); const [viewport, setViewport] = useState<BuilderViewport>('desktop')
  const allowed = region === 'header' ? headerElements : footerElements
  const elementItems: BuilderPickerElement[] = allowed.map((value) => ({ kind: 'element', value, label: elementDescriptions[value][0], description: elementDescriptions[value][1], category: 'site', keywords: [value, ...elementDescriptions[value][0].toLowerCase().split(' ')] }))
  const items = [...layoutDefinitions, ...elementItems]
  const change = (next: SiteShellNode[]) => layoutField.setValue(next)
  const startAdd = (item: BuilderDragItem, parent = 'root') => { setAdding(item); setTarget(parent); setSelected(null) }
  const actions: BuilderTreeActions<SiteShellNode> = { add: setPicker, addItem: startAdd, edit: (node) => { setSelected(node); setAdding(null) }, move: (id, direction) => change(moveSiteShellNode(nodes, id, direction)), remove: (id) => { change(removeSiteShellNode(nodes, id)); if (selected?.id === id) setSelected(null) } }
  const describe = (node: SiteShellNode): BuilderNodeDescriptor<SiteShellNode> => describeShellNode(node)
  const library = libraryMode === 'list' ? <BuilderListView nodes={nodes} id={(node) => node.id} describe={describe} onSelect={actions.edit} selectedID={selected?.id} /> : <><p className="template-editor__section-label">Layout</p>{layoutDefinitions.map((item) => <BuilderLibraryButton key={item.value} item={item} onAdd={() => startAdd(item)} />)}<p className="template-editor__section-label">Site Elements</p>{elementItems.map((item) => <BuilderLibraryButton key={item.value} item={item} onAdd={() => startAdd(item)} />)}</>
  return <BuilderCore id={`site-shell-${region}-dnd`} onInsert={startAdd} onMove={(id, parent) => change(moveSiteShellNodeTo(nodes, id, parent))}><section data-testid={`site-shell-${region}`} className="site-shell__region"><BuilderPreviewToolbar value={viewport} onChange={setViewport} /><BuilderWorkspace libraryOpen={libraryOpen} onLibraryOpenChange={setLibraryOpen} libraryTitle={libraryMode === 'blocks' ? `${region[0].toUpperCase() + region.slice(1)} Elements` : 'List View'} libraryNavigation={<div role="tablist" aria-label={`${region} editor sidebar`} className="template-editor__tabs"><button role="tab" aria-selected={libraryMode === 'blocks'} type="button" onClick={() => setLibraryMode('blocks')}>Blocks</button><button role="tab" aria-selected={libraryMode === 'list'} type="button" onClick={() => setLibraryMode('list')}>List View</button></div>} library={library} canvasLabel={`${region} shell canvas`} canvasTitle={`${region[0].toUpperCase() + region.slice(1)} Shell`} canvas={<BuilderPreviewFrame viewport={viewport}><div className={`site-shell__preview site-shell__preview--${region}`}>{region === 'footer' && <div className="site-shell__sample">Sample page content</div>}<DropArea id="root" label={`${region} shell drop area`} add={() => setPicker('root')} addItem={startAdd}>{!nodes.length && <div className="template-editor__empty"><p>Add the first element to this {region}.</p></div>}<BuilderCanvasTree nodes={nodes} actions={actions} describe={describe} id={(node) => node.id} selectedID={selected?.id} /></DropArea>{region === 'header' && <div className="site-shell__sample">Sample page content</div>}</div></BuilderPreviewFrame>} inspectorTitle="Settings" inspector={(adding || selected) ? <SiteShellInspector region={region} item={adding} node={selected} viewport={viewport} cancel={() => { setAdding(null); setSelected(null) }} save={(node) => { change(selected ? updateSiteShellNode(nodes, selected.id, node) : insertSiteShellNode(nodes, target, node)); setAdding(null); setSelected(node) }} /> : <RegionSettings region={region} value={settingsField.value ?? {}} change={settingsField.setValue} />} />
    {picker && <BuilderElementPicker categories={['all', 'layout', 'site']} categoryLabels={{ layout: 'Layout', site: 'Site Elements' }} elements={items} close={() => setPicker(null)} onChoose={(item) => { startAdd(item, picker); setPicker(null) }} />}
  </section></BuilderCore>
}

function describeShellNode(node: SiteShellNode): BuilderNodeDescriptor<SiteShellNode> {
  if (node.type === 'element') { const label = elementDescriptions[node.element][0]; return { title: label, listTitle: label, icon: '◆', body: <><strong className="template-editor__node-title">{label}</strong><p className="template-editor__node-preview">{previewText(node)}</p></> } }
  const children = node.layout === 'columns' ? node.columns?.map((column, index) => ({ id: column.id, label: `Column ${index + 1}`, listLabel: `Column ${index + 1} · ${column.width}%`, className: 'template-editor__column', children: column.children })) : !['spacer', 'divider'].includes(node.layout) ? [{ id: node.id, label: `${node.layout} contents`, children: node.children ?? [] }] : undefined
  const title = node.layout === 'columns' ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}` : node.layout[0].toUpperCase() + node.layout.slice(1)
  return { title, listTitle: title, icon: '◇', body: <strong className="template-editor__node-title">{title}</strong>, children, childrenClassName: node.layout === 'columns' ? 'template-editor__columns' : undefined, childrenStyle: node.layout === 'columns' ? { gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' ') } : undefined }
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
  if (item.kind === 'layout') { const layout = item.value as SiteShellLayoutKind; return { id: existing?.id ?? uid('shell'), type: 'layout', layout, ...(layout === 'columns' ? { columns: [{ id: uid('column'), width: 50, children: [] }, { id: uid('column'), width: 50, children: [] }] } : ['spacer', 'divider'].includes(layout) ? {} : { children: [] }) } }
  const element = item.value as SiteShellElementKind
  const props: Record<string, unknown> = element === 'logo' ? { source: 'siteSettings.logo', linkToHomepage: true } : element === 'siteName' ? { source: 'siteSettings.siteName', htmlElement: 'span', linkToHomepage: true } : element === 'navigation' ? { menuSource: 'primary', orientation: 'horizontal', alignment: 'left', itemSpacing: 'medium', dropdownBehavior: 'hover' } : element === 'socialLinks' ? { source: 'siteSettings.socialLinks', networks: ['twitter', 'youtube', 'facebook', 'instagram', 'discord', 'github'], showLabels: false } : element === 'currentYear' ? { source: 'system.currentYear' } : element === 'copyright' ? { tokens: ['copyright', 'currentYear', 'siteName'] } : element === 'button' ? { label: 'Call to action', url: '/', newTab: false, buttonStyle: 'primary' } : element === 'richText' ? { lexical: lexicalDocument('') } : { text: item.label }
  return { id: existing?.id ?? uid('shell'), type: 'element', element, props }
}

function SiteShellInspector({ item, node, region, viewport, cancel, save }: { item: BuilderDragItem | null; node: SiteShellNode | null; region: SiteShellRegion; viewport: BuilderViewport; cancel: () => void; save: (node: SiteShellNode) => void }) {
  const seed = node ?? (item ? createNode(item) : null); const [draft, setDraft] = useState<SiteShellNode | null>(seed); const [tab, setTab] = useState<BuilderInspectorTab>('settings')
  if (!draft) return null
  const label = draft.type === 'layout' ? draft.layout : elementDescriptions[draft.element][0]
  const props = draft.type === 'element' ? draft.props ?? {} : {}
  const setProps = (next: Record<string, unknown>) => draft.type === 'element' && setDraft({ ...draft, props: next })
  const style = draft.style ?? {}; const setStyle = (next: SiteShellStyle) => setDraft({ ...draft, style: next })
  const responsive = (name: string, fallback = '') => { const value = style[name] as ResponsiveValue<string> | undefined; return typeof value === 'object' && value ? value[viewport] ?? value.desktop ?? fallback : viewport === 'desktop' ? String(value ?? fallback) : fallback }
  const setResponsive = (name: string, value: string) => { const current = style[name]; const values = isResponsiveStyle(current) ? current : { desktop: current ?? '' }; setStyle({ ...style, [name]: { ...values, [viewport]: value } }) }
  if (draft.type === 'layout' && draft.layout === 'columns' && item && !node) { /* default is already valid */ }
  return <section aria-label="Configure Site Shell element"><h2>Configure {label}</h2><BuilderInspectorTabs active={tab} onChange={setTab} settingsLabel={draft.type === 'layout' ? 'Layout' : 'Settings'} />
    {tab === 'settings' && draft.type === 'layout' && draft.layout === 'columns' && <div className="site-shell__controls"><label>Column layout<select aria-label="Column Layout" value={draft.columns?.map((column) => column.width).join('/') ?? '50/50'} onChange={(event) => setDraft({ ...draft, columns: event.target.value.split('/').map((width, index) => ({ id: draft.columns?.[index]?.id ?? uid('column'), width: Number(width), children: draft.columns?.[index]?.children ?? [] })) })}>{ratios.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label></div>}
    {tab === 'settings' && draft.type === 'layout' && draft.layout !== 'columns' && <p>This layout accepts nested shell elements.</p>}
    {tab === 'settings' && draft.type === 'element' && <ElementSettings element={draft.element} props={props} setProps={setProps} region={region} />}
    {tab === 'style' && <div className="site-shell__controls"><p>Editing {viewport} values. Desktop cascades when no override exists.</p>{['width', 'maxWidth', 'minHeight', 'alignment', 'justification', 'gap', 'padding', 'margin', 'background', 'textColor', 'border', 'borderRadius', 'shadow', 'fontSize'].map((name) => <label key={name}>{name}<input aria-label={name} value={responsive(name)} onChange={(event) => setResponsive(name, event.target.value)} /></label>)}</div>}
    {tab === 'advanced' && <div className="site-shell__controls"><label>HTML ID<input aria-label="HTML ID" value={String(style.htmlID ?? '')} onChange={(event) => setStyle({ ...style, htmlID: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} /></label><label>CSS classes<input aria-label="CSS Classes" value={String(style.cssClass ?? '')} onChange={(event) => setStyle({ ...style, cssClass: event.target.value })} /></label><label>Visibility ({viewport})<select aria-label="Visibility" value={responsive('visibility', 'visible')} onChange={(event) => setResponsive('visibility', event.target.value)}><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><p>Stable ID: {draft.id}</p></div>}
    <div className="site-shell__actions"><button type="button" onClick={() => save(draft)}>Save Element</button><button type="button" onClick={cancel}>Cancel</button></div>
  </section>
}

function ElementSettings({ element, props, setProps, region }: { element: SiteShellElementKind; props: Record<string, unknown>; setProps: (props: Record<string, unknown>) => void; region: SiteShellRegion }) {
  const input = (label: string, key: string) => <label key={key}>{label}<input aria-label={label} value={String(props[key] ?? '')} onChange={(event) => setProps({ ...props, [key]: event.target.value })} /></label>
  return <div className="site-shell__controls">
    {element === 'navigation' && <><label>Menu source<select aria-label="Menu Source" value={String(props.menuSource ?? (region === 'footer' ? 'footer' : 'primary'))} onChange={(event) => setProps({ ...props, menuSource: event.target.value })}><option value="primary">Primary</option><option value="footer">Footer</option></select></label>{['orientation', 'alignment', 'itemSpacing', 'dropdownBehavior'].map((key) => input(key, key))}</>}
    {element === 'logo' && <><p>Source: Site Settings logo</p>{input('Width', 'width')}{input('Maximum width', 'maxWidth')}<label><input type="checkbox" checked={props.linkToHomepage !== false} onChange={(event) => setProps({ ...props, linkToHomepage: event.target.checked })} /> Link to homepage</label><label>Logo source<select aria-label="Logo Source" value={String(props.source ?? 'siteSettings.logo')} onChange={(event) => setProps({ ...props, source: event.target.value })}><option value="siteSettings.logo">Default logo</option><option value="siteSettings.darkLogo">Dark logo</option></select></label></>}
    {element === 'siteName' && <><p>Source: Site Settings.siteName</p><label>HTML element<select aria-label="HTML Element" value={String(props.htmlElement ?? 'span')} onChange={(event) => setProps({ ...props, htmlElement: event.target.value })}>{['span', 'div', 'p', 'h1', 'h2'].map((tag) => <option key={tag}>{tag}</option>)}</select></label><label><input type="checkbox" checked={props.linkToHomepage !== false} onChange={(event) => setProps({ ...props, linkToHomepage: event.target.checked })} /> Link to homepage</label></>}
    {element === 'button' && <>{input('Label', 'label')}{input('URL', 'url')}{input('Internal Page ID', 'page')}<label><input type="checkbox" checked={Boolean(props.newTab)} onChange={(event) => setProps({ ...props, newTab: event.target.checked })} /> Open in new tab</label><label>Button style<select aria-label="Button Style" value={String(props.buttonStyle ?? 'primary')} onChange={(event) => setProps({ ...props, buttonStyle: event.target.value })}><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="custom">Custom</option></select></label></>}
    {element === 'text' && input('Text', 'text')}
    {element === 'richText' && <label>Rich text<textarea aria-label="Rich Text" rows={6} value={lexicalText(props.lexical)} onChange={(event) => setProps({ ...props, lexical: lexicalDocument(event.target.value) })} /></label>}
    {element === 'socialLinks' && <><p>Source: Site Settings social URLs</p>{input('Networks', 'networks')}{input('Spacing', 'spacing')}{input('Icon size', 'iconSize')}<label><input type="checkbox" checked={Boolean(props.showLabels)} onChange={(event) => setProps({ ...props, showLabels: event.target.checked })} /> Show labels</label></>}
    {element === 'copyright' && <p>Dynamic composition: © [Current Year] [Site Name]</p>}
    {element === 'currentYear' && <p>Dynamic source: current system year</p>}
    {!['navigation', 'logo', 'siteName', 'button', 'text', 'richText', 'socialLinks', 'copyright', 'currentYear'].includes(element) && input('Label', 'text')}
  </div>
}

function lexicalDocument(text: string) {
  return { root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'paragraph', version: 1, direction: 'ltr', format: '', indent: 0, children: text ? [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }] : [] }] } }
}

function lexicalText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const root = (value as { root?: { children?: Array<{ children?: Array<{ text?: string }> }> } }).root
  return root?.children?.flatMap((paragraph) => paragraph.children?.map((child) => child.text ?? '') ?? []).join('\n') ?? ''
}

function RegionSettings({ region, value, change }: { region: SiteShellRegion; value: SiteShellRegionSettings; change: (value: SiteShellRegionSettings) => void }) {
  return <section><h3>{region[0].toUpperCase() + region.slice(1)} settings</h3><div className="site-shell__controls"><label>Width mode<select aria-label="Width Mode" value={value.widthMode ?? 'contained'} onChange={(event) => change({ ...value, widthMode: event.target.value as 'contained' | 'full' })}><option value="contained">Contained</option><option value="full">Full width</option></select></label><label>Position<select aria-label="Position" value={value.position ?? 'static'} onChange={(event) => change({ ...value, position: event.target.value as 'static' | 'sticky' | 'fixed' })}><option value="static">Static</option><option value="sticky">Sticky</option>{region === 'header' && <option value="fixed">Fixed</option>}</select></label><label><input type="checkbox" checked={Boolean(value.transparent)} onChange={(event) => change({ ...value, transparent: event.target.checked })} /> Transparent</label>{['maxWidth', 'minHeight', 'padding', 'margin', 'backgroundColor', 'border', 'boxShadow', 'zIndex'].map((key) => <label key={key}>{key}<input aria-label={key} value={String(value[key as keyof SiteShellRegionSettings] ?? '')} onChange={(event) => change({ ...value, [key]: ['maxWidth', 'minHeight', 'zIndex'].includes(key) ? Number(event.target.value) : event.target.value })} /></label>)}</div></section>
}
