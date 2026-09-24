'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useDocumentInfo, useField } from '@payloadcms/ui';
import { useEffect, useState } from 'react';
import { BuilderCore } from '../builder/BuilderCore.js';
import { BuilderElementPicker } from '../builder/BuilderElementPicker.js';
import { BuilderInspectorTabs } from '../builder/BuilderInspectorTabs.js';
import { BuilderLibraryButton } from '../builder/BuilderLibrary.js';
import { BuilderPreviewFrame, BuilderPreviewToolbar } from '../builder/BuilderPreviewToolbar.js';
import { BuilderCanvasTree, BuilderListView } from '../builder/BuilderTree.js';
import { BuilderWorkspace } from '../builder/BuilderWorkspace.js';
import { DropArea } from '../builder/DropArea.js';
import { insertSiteShellNode, moveSiteShellNode, moveSiteShellNodeTo, removeSiteShellNode, updateSiteShellNode } from '../site-shell-tree.js';
import './template-builder.css';
const layoutDefinitions = [
    ['container', 'Container', 'Constrain and group shell elements.'], ['row', 'Row', 'Arrange children horizontally.'],
    ['columns', 'Columns', 'Create responsive columns.'], ['stack', 'Stack', 'Arrange children vertically.'],
    ['spacer', 'Spacer', 'Add controlled empty space.'], ['divider', 'Divider', 'Separate shell areas.'],
].map(([value, label, description]) => ({ kind: 'layout', value, label, description, category: 'layout', keywords: [value, label.toLowerCase()] }));
const elementDescriptions = {
    logo: ['Site Logo', 'Uses a logo asset from Site Settings.'], siteName: ['Site Name', 'Uses Site Settings.siteName.'],
    navigation: ['Navigation Menu', 'Displays an existing Navigation menu source.'], button: ['Button / CTA', 'A call to action link.'],
    search: ['Search', 'A search control preview.'], text: ['Text', 'Simple shell text.'], richText: ['Rich Text', 'Lexical rich text content.'],
    icon: ['Icon', 'A presentation icon.'], image: ['Image', 'A selected Media image.'], socialLinks: ['Social Links', 'Uses configured Site Settings social URLs.'],
    mobileMenuToggle: ['Mobile Menu Toggle', 'Controls mobile navigation.'], copyright: ['Copyright', 'Dynamic copyright composition.'],
    currentYear: ['Current Year', 'Always represents the current year.'],
};
const headerElements = ['logo', 'siteName', 'navigation', 'button', 'search', 'text', 'richText', 'icon', 'image', 'socialLinks', 'mobileMenuToggle'];
const footerElements = ['logo', 'siteName', 'navigation', 'button', 'text', 'richText', 'icon', 'image', 'socialLinks', 'copyright', 'currentYear'];
const ratios = ['100', '50/50', '60/40', '40/60', '70/30', '30/70', '33/33/34', '25/50/25', '25/25/50', '25/25/25/25'];
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const isResponsiveStyle = (value) => typeof value === 'object' && value !== null && 'desktop' in value;
export function SiteTemplateBuilder() {
    const { id } = useDocumentInfo();
    const name = useField({ path: 'name' });
    const slug = useField({ path: 'slug' });
    const description = useField({ path: 'description' });
    const typography = useField({ path: 'typography' });
    const colors = useField({ path: 'colors' });
    const buttons = useField({ path: 'buttons' });
    const dimensions = useField({ path: 'dimensions' });
    const mobile = useField({ path: 'mobile' });
    const css = useField({ path: 'additionalCSS' });
    const mode = useField({ path: 'assignment.mode' });
    const priority = useField({ path: 'assignment.priority' });
    const [tab, setTab] = useState('overview');
    const [isDefault, setIsDefault] = useState(false);
    useEffect(() => { if (!id)
        return; fetch('/api/globals/site-settings?depth=0', { credentials: 'same-origin' }).then(async (response) => response.ok ? await response.json() : null).then((settings) => { const selected = settings?.defaultSiteTemplate; setIsDefault(String(typeof selected === 'object' ? selected?.id : selected) === String(id)); }).catch(() => undefined); }, [id]);
    const jsonEditor = (label, field) => _jsxs("label", { className: "site-shell__json-field", children: [_jsx("span", { children: label }), _jsx("textarea", { "aria-label": label, rows: 12, value: JSON.stringify(field.value ?? {}, null, 2), onChange: (event) => { try {
                    field.setValue(JSON.parse(event.target.value));
                }
                catch { /* keep editing until JSON is valid */ } } })] });
    return _jsxs("div", { "data-testid": "site-template-builder", className: "template-editor site-shell", children: [_jsx("header", { className: "template-editor__header", children: _jsxs("div", { children: [_jsx("h1", { children: name.value || 'Create Site Template' }), isDefault && _jsx("p", { children: "Current default Site Template" })] }) }), _jsx("nav", { role: "tablist", "aria-label": "Site Template sections", className: "template-editor__view-tabs", children: ['overview', 'header', 'footer', 'styles', 'assignments'].map((item) => _jsx("button", { role: "tab", type: "button", "aria-selected": tab === item, onClick: () => setTab(item), children: item === 'styles' ? 'Global Styles' : item[0].toUpperCase() + item.slice(1) }, item)) }), tab === 'overview' && _jsxs("section", { className: "template-editor__document", children: [_jsxs("label", { children: ["Name", _jsx("input", { "aria-label": "Name", value: name.value ?? '', onChange: (event) => name.setValue(event.target.value) })] }), _jsxs("label", { children: ["Slug", _jsx("input", { "aria-label": "Slug", value: slug.value ?? '', onChange: (event) => slug.setValue(event.target.value) })] }), _jsxs("label", { children: ["Description", _jsx("textarea", { "aria-label": "Description", rows: 5, value: description.value ?? '', onChange: (event) => description.setValue(event.target.value) })] })] }), tab === 'header' && _jsx(SiteShellBuilder, { region: "header" }), tab === 'footer' && _jsx(SiteShellBuilder, { region: "footer" }), tab === 'styles' && _jsxs("section", { className: "site-shell__styles", children: [jsonEditor('Typography', typography), jsonEditor('Colors', colors), jsonEditor('Buttons', buttons), jsonEditor('Dimensions', dimensions), jsonEditor('Mobile defaults', mobile), _jsxs("label", { className: "site-shell__json-field", children: [_jsx("span", { children: "Additional CSS" }), _jsx("textarea", { "aria-label": "Additional CSS", rows: 12, value: css.value ?? '', onChange: (event) => css.setValue(event.target.value) })] })] }), tab === 'assignments' && _jsxs("section", { className: "template-editor__document", children: [_jsx("h2", { children: "Assignments" }), _jsx("p", { children: "This phase supports the default assignment only. Site Settings remains the authoritative selection." }), _jsxs("label", { children: ["Mode", _jsx("input", { "aria-label": "Assignment Mode", readOnly: true, value: mode.value ?? 'default' })] }), _jsxs("label", { children: ["Priority", _jsx("input", { "aria-label": "Assignment Priority", type: "number", value: priority.value ?? 0, onChange: (event) => priority.setValue(Number(event.target.value)) })] })] })] });
}
export function SiteShellBuilder({ region }) {
    const layoutField = useField({ path: `${region}.layout` });
    const settingsField = useField({ path: `${region}.settings` });
    const nodes = Array.isArray(layoutField.value) ? layoutField.value : [];
    const [selected, setSelected] = useState(null);
    const [adding, setAdding] = useState(null);
    const [target, setTarget] = useState('root');
    const [picker, setPicker] = useState(null);
    const [libraryOpen, setLibraryOpen] = useState(true);
    const [libraryMode, setLibraryMode] = useState('blocks');
    const [viewport, setViewport] = useState('desktop');
    const allowed = region === 'header' ? headerElements : footerElements;
    const elementItems = allowed.map((value) => ({ kind: 'element', value, label: elementDescriptions[value][0], description: elementDescriptions[value][1], category: 'site', keywords: [value, ...elementDescriptions[value][0].toLowerCase().split(' ')] }));
    const items = [...layoutDefinitions, ...elementItems];
    const change = (next) => layoutField.setValue(next);
    const startAdd = (item, parent = 'root') => { setAdding(item); setTarget(parent); setSelected(null); };
    const actions = { add: setPicker, addItem: startAdd, edit: (node) => { setSelected(node); setAdding(null); }, move: (id, direction) => change(moveSiteShellNode(nodes, id, direction)), remove: (id) => { change(removeSiteShellNode(nodes, id)); if (selected?.id === id)
            setSelected(null); } };
    const describe = (node) => describeShellNode(node);
    const library = libraryMode === 'list' ? _jsx(BuilderListView, { nodes: nodes, id: (node) => node.id, describe: describe, onSelect: actions.edit, selectedID: selected?.id }) : _jsxs(_Fragment, { children: [_jsx("p", { className: "template-editor__section-label", children: "Layout" }), layoutDefinitions.map((item) => _jsx(BuilderLibraryButton, { item: item, onAdd: () => startAdd(item) }, item.value)), _jsx("p", { className: "template-editor__section-label", children: "Site Elements" }), elementItems.map((item) => _jsx(BuilderLibraryButton, { item: item, onAdd: () => startAdd(item) }, item.value))] });
    return _jsx(BuilderCore, { id: `site-shell-${region}-dnd`, onInsert: startAdd, onMove: (id, parent) => change(moveSiteShellNodeTo(nodes, id, parent)), children: _jsxs("section", { "data-testid": `site-shell-${region}`, className: "site-shell__region", children: [_jsx(BuilderPreviewToolbar, { value: viewport, onChange: setViewport }), _jsx(BuilderWorkspace, { libraryOpen: libraryOpen, onLibraryOpenChange: setLibraryOpen, libraryTitle: libraryMode === 'blocks' ? `${region[0].toUpperCase() + region.slice(1)} Elements` : 'List View', libraryNavigation: _jsxs("div", { role: "tablist", "aria-label": `${region} editor sidebar`, className: "template-editor__tabs", children: [_jsx("button", { role: "tab", "aria-selected": libraryMode === 'blocks', type: "button", onClick: () => setLibraryMode('blocks'), children: "Blocks" }), _jsx("button", { role: "tab", "aria-selected": libraryMode === 'list', type: "button", onClick: () => setLibraryMode('list'), children: "List View" })] }), library: library, canvasLabel: `${region} shell canvas`, canvasTitle: `${region[0].toUpperCase() + region.slice(1)} Shell`, canvas: _jsx(BuilderPreviewFrame, { viewport: viewport, children: _jsxs("div", { className: `site-shell__preview site-shell__preview--${region}`, children: [region === 'footer' && _jsx("div", { className: "site-shell__sample", children: "Sample page content" }), _jsxs(DropArea, { id: "root", label: `${region} shell drop area`, add: () => setPicker('root'), addItem: startAdd, children: [!nodes.length && _jsx("div", { className: "template-editor__empty", children: _jsxs("p", { children: ["Add the first element to this ", region, "."] }) }), _jsx(BuilderCanvasTree, { nodes: nodes, actions: actions, describe: describe, id: (node) => node.id, selectedID: selected?.id })] }), region === 'header' && _jsx("div", { className: "site-shell__sample", children: "Sample page content" })] }) }), inspectorTitle: "Settings", inspector: (adding || selected) ? _jsx(SiteShellInspector, { region: region, item: adding, node: selected, viewport: viewport, cancel: () => { setAdding(null); setSelected(null); }, save: (node) => { change(selected ? updateSiteShellNode(nodes, selected.id, node) : insertSiteShellNode(nodes, target, node)); setAdding(null); setSelected(node); } }) : _jsx(RegionSettings, { region: region, value: settingsField.value ?? {}, change: settingsField.setValue }) }), picker && _jsx(BuilderElementPicker, { categories: ['all', 'layout', 'site'], categoryLabels: { layout: 'Layout', site: 'Site Elements' }, elements: items, close: () => setPicker(null), onChoose: (item) => { startAdd(item, picker); setPicker(null); } })] }) });
}
function describeShellNode(node) {
    if (node.type === 'element') {
        const label = elementDescriptions[node.element][0];
        return { title: label, listTitle: label, icon: '◆', body: _jsxs(_Fragment, { children: [_jsx("strong", { className: "template-editor__node-title", children: label }), _jsx("p", { className: "template-editor__node-preview", children: previewText(node) })] }) };
    }
    const children = node.layout === 'columns' ? node.columns?.map((column, index) => ({ id: column.id, label: `Column ${index + 1}`, listLabel: `Column ${index + 1} · ${column.width}%`, className: 'template-editor__column', children: column.children })) : !['spacer', 'divider'].includes(node.layout) ? [{ id: node.id, label: `${node.layout} contents`, children: node.children ?? [] }] : undefined;
    const title = node.layout === 'columns' ? `Columns · ${node.columns?.map((column) => column.width).join(' / ')}` : node.layout[0].toUpperCase() + node.layout.slice(1);
    return { title, listTitle: title, icon: '◇', body: _jsx("strong", { className: "template-editor__node-title", children: title }), children, childrenClassName: node.layout === 'columns' ? 'template-editor__columns' : undefined, childrenStyle: node.layout === 'columns' ? { gridTemplateColumns: node.columns?.map((column) => `${column.width}fr`).join(' ') } : undefined };
}
function previewText(node) {
    if (node.element === 'siteName')
        return 'Sample Site Name · from Site Settings';
    if (node.element === 'logo')
        return 'Site Settings logo';
    if (node.element === 'navigation')
        return `${String(node.props?.menuSource ?? 'primary')} menu`;
    if (node.element === 'socialLinks')
        return 'Configured social links';
    if (node.element === 'currentYear')
        return String(new Date().getFullYear());
    if (node.element === 'copyright')
        return '© [Current Year] [Site Name]';
    return String(node.props?.label ?? node.props?.text ?? elementDescriptions[node.element][1]);
}
function createNode(item, existing) {
    if (item.kind === 'layout') {
        const layout = item.value;
        return { id: existing?.id ?? uid('shell'), type: 'layout', layout, ...(layout === 'columns' ? { columns: [{ id: uid('column'), width: 50, children: [] }, { id: uid('column'), width: 50, children: [] }] } : ['spacer', 'divider'].includes(layout) ? {} : { children: [] }) };
    }
    const element = item.value;
    const props = element === 'logo' ? { source: 'siteSettings.logo', linkToHomepage: true } : element === 'siteName' ? { source: 'siteSettings.siteName', htmlElement: 'span', linkToHomepage: true } : element === 'navigation' ? { menuSource: 'primary', orientation: 'horizontal', alignment: 'left', itemSpacing: 'medium', dropdownBehavior: 'hover' } : element === 'socialLinks' ? { source: 'siteSettings.socialLinks', networks: ['twitter', 'youtube', 'facebook', 'instagram', 'discord', 'github'], showLabels: false } : element === 'currentYear' ? { source: 'system.currentYear' } : element === 'copyright' ? { tokens: ['copyright', 'currentYear', 'siteName'] } : element === 'button' ? { label: 'Call to action', url: '/', newTab: false, buttonStyle: 'primary' } : element === 'richText' ? { lexical: lexicalDocument('') } : { text: item.label };
    return { id: existing?.id ?? uid('shell'), type: 'element', element, props };
}
function SiteShellInspector({ item, node, region, viewport, cancel, save }) {
    const seed = node ?? (item ? createNode(item) : null);
    const [draft, setDraft] = useState(seed);
    const [tab, setTab] = useState('settings');
    if (!draft)
        return null;
    const label = draft.type === 'layout' ? draft.layout : elementDescriptions[draft.element][0];
    const props = draft.type === 'element' ? draft.props ?? {} : {};
    const setProps = (next) => draft.type === 'element' && setDraft({ ...draft, props: next });
    const style = draft.style ?? {};
    const setStyle = (next) => setDraft({ ...draft, style: next });
    const responsive = (name, fallback = '') => { const value = style[name]; return typeof value === 'object' && value ? value[viewport] ?? value.desktop ?? fallback : viewport === 'desktop' ? String(value ?? fallback) : fallback; };
    const setResponsive = (name, value) => { const current = style[name]; const values = isResponsiveStyle(current) ? current : { desktop: current ?? '' }; setStyle({ ...style, [name]: { ...values, [viewport]: value } }); };
    if (draft.type === 'layout' && draft.layout === 'columns' && item && !node) { /* default is already valid */ }
    return _jsxs("section", { "aria-label": "Configure Site Shell element", children: [_jsxs("h2", { children: ["Configure ", label] }), _jsx(BuilderInspectorTabs, { active: tab, onChange: setTab, settingsLabel: draft.type === 'layout' ? 'Layout' : 'Settings' }), tab === 'settings' && draft.type === 'layout' && draft.layout === 'columns' && _jsx("div", { className: "site-shell__controls", children: _jsxs("label", { children: ["Column layout", _jsx("select", { "aria-label": "Column Layout", value: draft.columns?.map((column) => column.width).join('/') ?? '50/50', onChange: (event) => setDraft({ ...draft, columns: event.target.value.split('/').map((width, index) => ({ id: draft.columns?.[index]?.id ?? uid('column'), width: Number(width), children: draft.columns?.[index]?.children ?? [] })) }), children: ratios.map((ratio) => _jsx("option", { children: ratio }, ratio)) })] }) }), tab === 'settings' && draft.type === 'layout' && draft.layout !== 'columns' && _jsx("p", { children: "This layout accepts nested shell elements." }), tab === 'settings' && draft.type === 'element' && _jsx(ElementSettings, { element: draft.element, props: props, setProps: setProps, region: region }), tab === 'style' && _jsxs("div", { className: "site-shell__controls", children: [_jsxs("p", { children: ["Editing ", viewport, " values. Desktop cascades when no override exists."] }), ['width', 'maxWidth', 'minHeight', 'alignment', 'justification', 'gap', 'padding', 'margin', 'background', 'textColor', 'border', 'borderRadius', 'shadow', 'fontSize'].map((name) => _jsxs("label", { children: [name, _jsx("input", { "aria-label": name, value: responsive(name), onChange: (event) => setResponsive(name, event.target.value) })] }, name))] }), tab === 'advanced' && _jsxs("div", { className: "site-shell__controls", children: [_jsxs("label", { children: ["HTML ID", _jsx("input", { "aria-label": "HTML ID", value: String(style.htmlID ?? ''), onChange: (event) => setStyle({ ...style, htmlID: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }) })] }), _jsxs("label", { children: ["CSS classes", _jsx("input", { "aria-label": "CSS Classes", value: String(style.cssClass ?? ''), onChange: (event) => setStyle({ ...style, cssClass: event.target.value }) })] }), _jsxs("label", { children: ["Visibility (", viewport, ")", _jsxs("select", { "aria-label": "Visibility", value: responsive('visibility', 'visible'), onChange: (event) => setResponsive('visibility', event.target.value), children: [_jsx("option", { value: "visible", children: "Visible" }), _jsx("option", { value: "hidden", children: "Hidden" })] })] }), _jsxs("p", { children: ["Stable ID: ", draft.id] })] }), _jsxs("div", { className: "site-shell__actions", children: [_jsx("button", { type: "button", onClick: () => save(draft), children: "Save Element" }), _jsx("button", { type: "button", onClick: cancel, children: "Cancel" })] })] });
}
function ElementSettings({ element, props, setProps, region }) {
    const input = (label, key) => _jsxs("label", { children: [label, _jsx("input", { "aria-label": label, value: String(props[key] ?? ''), onChange: (event) => setProps({ ...props, [key]: event.target.value }) })] }, key);
    return _jsxs("div", { className: "site-shell__controls", children: [element === 'navigation' && _jsxs(_Fragment, { children: [_jsxs("label", { children: ["Menu source", _jsxs("select", { "aria-label": "Menu Source", value: String(props.menuSource ?? (region === 'footer' ? 'footer' : 'primary')), onChange: (event) => setProps({ ...props, menuSource: event.target.value }), children: [_jsx("option", { value: "primary", children: "Primary" }), _jsx("option", { value: "footer", children: "Footer" })] })] }), ['orientation', 'alignment', 'itemSpacing', 'dropdownBehavior'].map((key) => input(key, key))] }), element === 'logo' && _jsxs(_Fragment, { children: [_jsx("p", { children: "Source: Site Settings logo" }), input('Width', 'width'), input('Maximum width', 'maxWidth'), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: props.linkToHomepage !== false, onChange: (event) => setProps({ ...props, linkToHomepage: event.target.checked }) }), " Link to homepage"] }), _jsxs("label", { children: ["Logo source", _jsxs("select", { "aria-label": "Logo Source", value: String(props.source ?? 'siteSettings.logo'), onChange: (event) => setProps({ ...props, source: event.target.value }), children: [_jsx("option", { value: "siteSettings.logo", children: "Default logo" }), _jsx("option", { value: "siteSettings.darkLogo", children: "Dark logo" })] })] })] }), element === 'siteName' && _jsxs(_Fragment, { children: [_jsx("p", { children: "Source: Site Settings.siteName" }), _jsxs("label", { children: ["HTML element", _jsx("select", { "aria-label": "HTML Element", value: String(props.htmlElement ?? 'span'), onChange: (event) => setProps({ ...props, htmlElement: event.target.value }), children: ['span', 'div', 'p', 'h1', 'h2'].map((tag) => _jsx("option", { children: tag }, tag)) })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: props.linkToHomepage !== false, onChange: (event) => setProps({ ...props, linkToHomepage: event.target.checked }) }), " Link to homepage"] })] }), element === 'button' && _jsxs(_Fragment, { children: [input('Label', 'label'), input('URL', 'url'), input('Internal Page ID', 'page'), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: Boolean(props.newTab), onChange: (event) => setProps({ ...props, newTab: event.target.checked }) }), " Open in new tab"] }), _jsxs("label", { children: ["Button style", _jsxs("select", { "aria-label": "Button Style", value: String(props.buttonStyle ?? 'primary'), onChange: (event) => setProps({ ...props, buttonStyle: event.target.value }), children: [_jsx("option", { value: "primary", children: "Primary" }), _jsx("option", { value: "secondary", children: "Secondary" }), _jsx("option", { value: "custom", children: "Custom" })] })] })] }), element === 'text' && input('Text', 'text'), element === 'richText' && _jsxs("label", { children: ["Rich text", _jsx("textarea", { "aria-label": "Rich Text", rows: 6, value: lexicalText(props.lexical), onChange: (event) => setProps({ ...props, lexical: lexicalDocument(event.target.value) }) })] }), element === 'socialLinks' && _jsxs(_Fragment, { children: [_jsx("p", { children: "Source: Site Settings social URLs" }), input('Networks', 'networks'), input('Spacing', 'spacing'), input('Icon size', 'iconSize'), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: Boolean(props.showLabels), onChange: (event) => setProps({ ...props, showLabels: event.target.checked }) }), " Show labels"] })] }), element === 'copyright' && _jsx("p", { children: "Dynamic composition: \u00A9 [Current Year] [Site Name]" }), element === 'currentYear' && _jsx("p", { children: "Dynamic source: current system year" }), !['navigation', 'logo', 'siteName', 'button', 'text', 'richText', 'socialLinks', 'copyright', 'currentYear'].includes(element) && input('Label', 'text')] });
}
function lexicalDocument(text) {
    return { root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'paragraph', version: 1, direction: 'ltr', format: '', indent: 0, children: text ? [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }] : [] }] } };
}
function lexicalText(value) {
    if (!value || typeof value !== 'object')
        return '';
    const root = value.root;
    return root?.children?.flatMap((paragraph) => paragraph.children?.map((child) => child.text ?? '') ?? []).join('\n') ?? '';
}
function RegionSettings({ region, value, change }) {
    return _jsxs("section", { children: [_jsxs("h3", { children: [region[0].toUpperCase() + region.slice(1), " settings"] }), _jsxs("div", { className: "site-shell__controls", children: [_jsxs("label", { children: ["Width mode", _jsxs("select", { "aria-label": "Width Mode", value: value.widthMode ?? 'contained', onChange: (event) => change({ ...value, widthMode: event.target.value }), children: [_jsx("option", { value: "contained", children: "Contained" }), _jsx("option", { value: "full", children: "Full width" })] })] }), _jsxs("label", { children: ["Position", _jsxs("select", { "aria-label": "Position", value: value.position ?? 'static', onChange: (event) => change({ ...value, position: event.target.value }), children: [_jsx("option", { value: "static", children: "Static" }), _jsx("option", { value: "sticky", children: "Sticky" }), region === 'header' && _jsx("option", { value: "fixed", children: "Fixed" })] })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: Boolean(value.transparent), onChange: (event) => change({ ...value, transparent: event.target.checked }) }), " Transparent"] }), ['maxWidth', 'minHeight', 'padding', 'margin', 'backgroundColor', 'border', 'boxShadow', 'zIndex'].map((key) => _jsxs("label", { children: [key, _jsx("input", { "aria-label": key, value: String(value[key] ?? ''), onChange: (event) => change({ ...value, [key]: ['maxWidth', 'minHeight', 'zIndex'].includes(key) ? Number(event.target.value) : event.target.value }) })] }, key))] })] });
}
