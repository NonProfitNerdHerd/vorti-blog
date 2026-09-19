'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useField, useFormFields } from '@payloadcms/ui';
import { useEffect, useState } from 'react';
export function TemplateContentEditor() {
    const selected = useFormFields(([fields]) => fields.designTemplate?.value);
    const templateID = typeof selected === 'object' && selected !== null ? selected.id : selected;
    // This component owns templateValues. Payload synchronizes the mounted field
    // with each save response, including subsequent edits on the same form.
    const { value: rawValues, setValue: setValues, disabled } = useField();
    const { value: rawOverrides, setValue: setOverrides } = useField({ path: 'designOverrides' });
    const values = rawValues && typeof rawValues === 'object' ? rawValues : {};
    const overrides = rawOverrides && typeof rawOverrides === 'object' ? rawOverrides : {};
    const [template, setTemplate] = useState(null);
    const [sections, setSections] = useState({});
    const [mediaOptions, setMediaOptions] = useState([]);
    const [error, setError] = useState(null);
    useEffect(() => {
        fetch('/api/media?limit=100&depth=0', { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : Promise.resolve({ docs: [] }))
            .then((data) => setMediaOptions(data.docs ?? []))
            .catch(() => setMediaOptions([]));
    }, []);
    useEffect(() => {
        if (!templateID)
            return;
        let active = true;
        async function load() {
            try {
                const response = await fetch(`/api/design-templates/${templateID}?depth=0`, { credentials: 'same-origin' });
                if (!response.ok)
                    throw new Error('The selected Template is unavailable');
                const next = await response.json();
                const details = await Promise.all(next.sections.map(async (section) => {
                    const [typeResponse, designsResponse] = await Promise.all([
                        fetch(`/api/design-block-types/${section.blockType}?depth=0`, { credentials: 'same-origin' }),
                        fetch(`/api/design-block-designs?depth=0&limit=100&where[blockType][equals]=${section.blockType}&where[status][equals]=published&where[_status][equals]=published`, { credentials: 'same-origin' }),
                    ]);
                    if (!typeResponse.ok || !designsResponse.ok)
                        throw new Error(`Could not load ${section.name}`);
                    const blockType = await typeResponse.json();
                    const designs = await designsResponse.json();
                    return [section.key, { fields: blockType.fields, designs: designs.docs }];
                }));
                if (active) {
                    setTemplate(next);
                    setSections(Object.fromEntries(details));
                    setError(null);
                }
            }
            catch (cause) {
                if (active)
                    setError(cause instanceof Error ? cause.message : 'Could not load Template');
            }
        }
        void load();
        return () => { active = false; };
    }, [templateID]);
    function update(sectionKey, key, value) {
        setValues({ ...values, [sectionKey]: { ...(values[sectionKey] ?? {}), [key]: value } });
    }
    if (!templateID)
        return _jsx("p", { children: "Select a published Template to edit its sections." });
    if (error)
        return _jsx("p", { role: "alert", children: error });
    if (!template || String(template.id) !== String(templateID))
        return _jsx("p", { children: "Loading Template sections\u2026" });
    return _jsxs("section", { children: [_jsx("h3", { children: "Template content" }), template.sections.map((section) => _jsxs("fieldset", { style: { marginBottom: '1.5rem', padding: '1rem' }, children: [_jsxs("legend", { children: [section.name, section.required ? ' (required)' : ''] }), section.required && (sections[section.key]?.fields ?? []).some((field) => field.required && !values[section.key]?.[field.key]) &&
                        _jsx("p", { role: "alert", children: "This section is missing required content. Fill it before publishing this Post." }), section.allowDesignOverride && _jsxs("label", { children: ["Design", _jsxs("select", { disabled: disabled, value: String(overrides[section.key] ?? ''), onChange: (event) => setOverrides({ ...overrides, [section.key]: event.target.value || null }), children: [_jsx("option", { value: "", children: "Use Template Default" }), sections[section.key]?.designs.map((design) => _jsx("option", { value: String(design.id), children: design.name }, design.id))] })] }), (sections[section.key]?.fields ?? []).map((field) => _jsx("div", { style: { marginTop: '0.75rem' }, children: _jsxs("label", { children: [field.label, field.required ? ' *' : '', field.kind === 'textarea' ? _jsx("textarea", { disabled: disabled, value: String(values[section.key]?.[field.key] ?? ''), onChange: (event) => update(section.key, field.key, event.target.value) })
                                    : field.kind === 'boolean' ? _jsx("input", { disabled: disabled, type: "checkbox", checked: Boolean(values[section.key]?.[field.key]), onChange: (event) => update(section.key, field.key, event.target.checked) })
                                        : field.kind === 'media' ? _jsxs("select", { disabled: disabled, value: String(values[section.key]?.[field.key] ?? ''), onChange: (event) => update(section.key, field.key, event.target.value || null), children: [_jsx("option", { value: "", children: "Choose Media" }), mediaOptions.map((media) => _jsx("option", { value: String(media.id), children: media.alt || media.filename || media.id }, media.id))] })
                                            : field.kind === 'group' ? _jsx("div", { children: field.children?.map((child) => _jsxs("label", { children: [child.label, _jsx("input", { disabled: disabled, value: String(values[section.key]?.[field.key]?.[child.key] ?? ''), onChange: (event) => update(section.key, field.key, { ...(values[section.key]?.[field.key] ?? {}), [child.key]: event.target.value }) })] }, child.key)) })
                                                : _jsx("input", { disabled: disabled, type: field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text', value: String(values[section.key]?.[field.key] ?? ''), onChange: (event) => update(section.key, field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value) })] }) }, field.key))] }, section.key)), Object.keys(values).filter((key) => !template.sections.some((section) => section.key === key)).length > 0 && _jsx("p", { children: "Values for removed sections remain stored for recovery." })] });
}
