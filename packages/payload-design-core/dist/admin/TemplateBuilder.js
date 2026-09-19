'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDocumentInfo, useField, useForm } from '@payloadcms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
const fieldStyle = { display: 'grid', gap: '0.4rem' };
const panelStyle = { border: '1px solid var(--theme-elevation-150)', borderRadius: '8px', padding: '1.25rem' };
function relationID(value) {
    if (typeof value === 'string' || typeof value === 'number')
        return value;
    if (value && typeof value === 'object' && 'id' in value)
        return value.id;
}
function makeSectionKey(name, sections) {
    const base = name.trim().replace(/[^a-zA-Z0-9]+(.)/g, (_, next) => next.toUpperCase()).replace(/^[^a-z]+/i, '').replace(/^./, (letter) => letter.toLowerCase()) || 'section';
    const used = new Set(sections.map((section) => section.key));
    if (!used.has(base))
        return base;
    let suffix = 2;
    while (used.has(`${base}${suffix}`))
        suffix += 1;
    return `${base}${suffix}`;
}
export function TemplateBuilder({ configuredCollections = ['posts'], registeredRendererKeys = ['hero-board'] }) {
    const { id, hasPublishedDoc } = useDocumentInfo();
    const { submit, disabled } = useForm();
    const { value: nameValue, setValue: setName } = useField({ path: 'name' });
    const { value: descriptionValue, setValue: setDescription } = useField({ path: 'description' });
    const { value: slugValue } = useField({ path: 'slug' });
    const { value: collectionsValue, setValue: setCollections } = useField({ path: 'allowedCollections' });
    const { value: sectionsValue, setValue: setSections } = useField({ path: 'sections' });
    const { value: documentStatus } = useField({ path: '_status' });
    const name = nameValue ?? '';
    const description = descriptionValue ?? '';
    const collections = Array.isArray(collectionsValue) ? collectionsValue : [];
    const sections = Array.isArray(sectionsValue) ? sectionsValue : [];
    const [blockTypes, setBlockTypes] = useState([]);
    const [designs, setDesigns] = useState([]);
    const [impact, setImpact] = useState([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [editingIndex, setEditingIndex] = useState(null);
    const [selectedType, setSelectedType] = useState(null);
    const [sectionName, setSectionName] = useState('Hero');
    const [selectedDesign, setSelectedDesign] = useState('');
    const [required, setRequired] = useState(true);
    const [allowOverride, setAllowOverride] = useState(true);
    const [error, setError] = useState(null);
    const [existingTemplateLoaded, setExistingTemplateLoaded] = useState(false);
    const sectionsModified = useRef(false);
    const publishedImpact = impact.filter((item) => item.status === 'published').length;
    useEffect(() => {
        fetch('/api/design-block-types?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published', { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : Promise.resolve({ docs: [] }))
            .then((body) => setBlockTypes((body.docs ?? []).filter((item) => item.rendererKey && registeredRendererKeys.includes(item.rendererKey))))
            .catch(() => setBlockTypes([]));
        fetch('/api/design-block-designs?depth=0&limit=100&where[status][equals]=published&where[_status][equals]=published', { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : Promise.resolve({ docs: [] }))
            .then((body) => setDesigns(body.docs ?? []))
            .catch(() => setDesigns([]));
    }, [registeredRendererKeys]);
    useEffect(() => {
        if (!id)
            return;
        fetch(`/api/design-templates/${id}?draft=true&depth=0`, { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : null)
            .then((body) => {
            if (!sectionsModified.current && body && Array.isArray(body.sections))
                setSections(body.sections);
            setExistingTemplateLoaded(true);
        })
            .catch(() => setExistingTemplateLoaded(true));
        fetch(`/api/design-templates/${id}/dependencies`, { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : Promise.resolve([]))
            .then((body) => setImpact(Array.isArray(body) ? body : []))
            .catch(() => setImpact([]));
    }, [id, setSections]);
    const designNames = useMemo(() => new Map(designs.map((design) => [String(design.id), design.name])), [designs]);
    function toggleCollection(slug) {
        setCollections(collections.includes(slug) ? collections.filter((item) => item !== slug) : [...collections, slug]);
    }
    function beginAdd(type) {
        setSelectedType(type);
        setEditingIndex(null);
        setSectionName(type.rendererKey === 'hero-board' ? 'Hero' : type.name);
        setSelectedDesign('');
        setRequired(true);
        setAllowOverride(true);
        setPickerOpen(false);
        setError(null);
    }
    function beginEdit(index) {
        const section = sections[index];
        const typeID = relationID(section.blockType);
        const type = blockTypes.find((item) => String(item.id) === String(typeID));
        if (!type) {
            setError('This section uses a Block Type that is not currently available.');
            return;
        }
        setSelectedType(type);
        setEditingIndex(index);
        setSectionName(section.name);
        setSelectedDesign(relationID(section.blockDesign) ?? '');
        setRequired(Boolean(section.required));
        setAllowOverride(Boolean(section.allowDesignOverride));
        setPickerOpen(false);
        setError(null);
    }
    function saveSection() {
        if (!selectedType || !sectionName.trim() || !selectedDesign) {
            setError('Section Name and Default Design are required.');
            return;
        }
        const prior = editingIndex === null ? undefined : sections[editingIndex];
        const next = {
            key: prior?.key ?? makeSectionKey(sectionName, sections), name: sectionName.trim(), blockType: selectedType.id,
            blockDesign: selectedDesign, required, allowDesignOverride: allowOverride,
        };
        sectionsModified.current = true;
        setSections(editingIndex === null ? [...sections, next] : sections.map((section, index) => index === editingIndex ? next : section));
        setSelectedType(null);
        setEditingIndex(null);
        setError(null);
    }
    function move(index, direction) {
        const target = index + direction;
        if (target < 0 || target >= sections.length)
            return;
        const next = [...sections];
        [next[index], next[target]] = [next[target], next[index]];
        sectionsModified.current = true;
        setSections(next);
    }
    function remove(index) {
        if (hasPublishedDoc && impact.length > 0 && !window.confirm(`This Template is used by ${impact.length} content item${impact.length === 1 ? '' : 's'}. Removing the section from the draft preserves historical content values. Continue?`))
            return;
        sectionsModified.current = true;
        setSections(sections.filter((_, current) => current !== index));
    }
    async function save(publish) {
        setError(null);
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        if (!collections.length) {
            setError('Choose at least one collection under Use With.');
            return;
        }
        const generatedSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await submit({ overrides: { slug: slugValue || generatedSlug, status: publish ? 'published' : 'draft', _status: publish ? 'published' : 'draft' } });
    }
    return _jsxs("div", { style: { display: 'grid', gap: '1.5rem', maxWidth: '960px' }, "data-testid": "template-builder", children: [_jsxs("header", { children: [_jsx("h1", { style: { marginBottom: '0.25rem', textTransform: id ? 'uppercase' : undefined }, children: name || 'Create Template' }), _jsx("strong", { children: documentStatus === 'published' ? 'Published' : 'Draft' }), id && _jsxs("p", { children: ["Used by: ", impact.length, " ", collections.includes('posts') ? 'Post' : 'content item', impact.length === 1 ? '' : 's'] }), publishedImpact > 0 && _jsxs("p", { role: "status", children: ["Publishing changes to this Template may affect ", publishedImpact, " published content item", publishedImpact === 1 ? '' : 's', "."] })] }), _jsx("section", { style: panelStyle, "aria-label": "Template details", children: _jsxs("div", { style: { display: 'grid', gap: '1rem' }, children: [_jsxs("label", { style: fieldStyle, children: ["Name", _jsx("input", { "aria-label": "Name", disabled: disabled, value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { style: fieldStyle, children: ["Description", _jsx("textarea", { "aria-label": "Description", disabled: disabled, value: description, onChange: (event) => setDescription(event.target.value) })] }), _jsxs("fieldset", { disabled: disabled, style: { border: 0, padding: 0 }, children: [_jsx("legend", { children: "Use With" }), configuredCollections.map((slug) => _jsxs("label", { style: { display: 'block', marginTop: '0.5rem' }, children: [_jsx("input", { type: "checkbox", checked: collections.includes(slug), onChange: () => toggleCollection(slug) }), " ", slug[0].toUpperCase() + slug.slice(1)] }, slug))] })] }) }), _jsxs("section", { "aria-labelledby": "template-structure-heading", children: [_jsx("h2", { id: "template-structure-heading", children: "Template Structure" }), id && !existingTemplateLoaded ? _jsx("div", { style: panelStyle, children: _jsx("p", { children: "Loading Template structure\u2026" }) }) : !sections.length && _jsx("div", { style: panelStyle, children: _jsx("p", { children: "No sections have been added yet." }) }), _jsx("div", { style: { display: 'grid', gap: '1rem' }, children: sections.map((section, index) => {
                            const type = blockTypes.find((item) => String(item.id) === String(relationID(section.blockType)));
                            const designName = designNames.get(String(relationID(section.blockDesign)));
                            return _jsxs("article", { style: panelStyle, children: [_jsx("h3", { style: { marginTop: 0, textTransform: 'uppercase' }, children: section.name }), _jsx("p", { children: type?.name ?? 'Registered Block Type' }), _jsxs("p", { children: ["Default Design: ", designName ?? 'Loading design…'] }), _jsx("p", { children: section.required ? 'Required' : 'Optional' }), _jsx("p", { children: section.allowDesignOverride ? 'Editor may change design' : 'Editor uses Template design' }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }, children: [_jsx("button", { type: "button", onClick: () => beginEdit(index), children: "Edit" }), _jsx("button", { type: "button", disabled: index === 0, onClick: () => move(index, -1), children: "Move Up" }), _jsx("button", { type: "button", disabled: index === sections.length - 1, onClick: () => move(index, 1), children: "Move Down" }), _jsx("button", { type: "button", onClick: () => remove(index), children: "Remove" })] })] }, section.key);
                        }) }), !selectedType && _jsx("button", { type: "button", style: { marginTop: '1rem' }, onClick: () => setPickerOpen(true), children: "+ Add Section" })] }), pickerOpen && _jsxs("section", { style: panelStyle, "aria-label": "Choose a Block Type", children: [_jsx("h2", { children: "Choose a Block Type" }), !blockTypes.length && _jsx("p", { children: "No published registered Block Types are available." }), blockTypes.map((type) => _jsxs("article", { children: [_jsx("h3", { children: type.name }), _jsx("p", { children: type.description || 'Prominent introductory area for a page or article.' }), _jsxs("button", { type: "button", onClick: () => beginAdd(type), children: ["Add ", type.name] })] }, type.id)), _jsx("button", { type: "button", onClick: () => setPickerOpen(false), children: "Cancel" })] }), selectedType && _jsxs("section", { style: panelStyle, "aria-label": "Configure section", children: [_jsxs("h2", { children: [editingIndex === null ? 'Add' : 'Edit', " Section"] }), _jsxs("div", { style: { display: 'grid', gap: '1rem' }, children: [_jsxs("label", { style: fieldStyle, children: ["Section Name", _jsx("input", { "aria-label": "Section Name", value: sectionName, onChange: (event) => setSectionName(event.target.value) })] }), _jsxs("p", { children: [_jsx("strong", { children: "Block" }), _jsx("br", {}), selectedType.name] }), _jsxs("label", { style: fieldStyle, children: ["Default Design", _jsxs("select", { "aria-label": "Default Design", value: String(selectedDesign), onChange: (event) => setSelectedDesign(designs.find((design) => String(design.id) === event.target.value)?.id ?? ''), children: [_jsx("option", { value: "", children: "Choose a published Design" }), designs.filter((design) => String(relationID(design.blockType)) === String(selectedType.id)).map((design) => _jsx("option", { value: String(design.id), children: design.name }, design.id))] })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: required, onChange: (event) => setRequired(event.target.checked) }), " Required"] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: allowOverride, onChange: (event) => setAllowOverride(event.target.checked) }), " Allow content editor to change design"] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("button", { type: "button", onClick: saveSection, children: editingIndex === null ? 'Add to Template' : 'Update Section' }), _jsx("button", { type: "button", onClick: () => setSelectedType(null), children: "Cancel" })] })] })] }), error && _jsx("p", { role: "alert", children: error }), _jsxs("footer", { style: { display: 'flex', gap: '0.75rem' }, children: [_jsx("button", { type: "button", disabled: disabled, onClick: () => void save(false), children: "Save Draft" }), _jsx("button", { type: "button", disabled: disabled, onClick: () => void save(true), children: hasPublishedDoc ? 'Publish Changes' : 'Publish Template' })] })] });
}
