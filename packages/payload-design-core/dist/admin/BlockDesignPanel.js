'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useDocumentInfo, useFormFields } from '@payloadcms/ui';
import { useEffect, useState } from 'react';
import { createRendererRegistry } from '../registry.js';
import { HeroBoardRenderer } from '../hero-board/HeroBoard.js';
import { heroBoardSample } from '../hero-board/registration.js';
const renderers = createRendererRegistry({ 'hero-board': HeroBoardRenderer });
const HeroPreview = renderers.get('hero-board');
const settingNames = ['alignment', 'width', 'spacing', 'imageTreatment', 'overlay', 'textContrast', 'buttonStyle'];
export function BlockDesignPanel() {
    const { id } = useDocumentInfo();
    const form = useFormFields(([fields]) => ({
        name: fields.name?.value,
        slug: fields.slug?.value,
        blockType: fields.blockType?.value,
        design: Object.fromEntries(settingNames.map((name) => [name, fields[`design.${name}`]?.value])),
    }));
    const [rendererKey, setRendererKey] = useState(null);
    const [dependencies, setDependencies] = useState(null);
    const [headline, setHeadline] = useState(heroBoardSample.headline);
    const [subheadline, setSubheadline] = useState(heroBoardSample.subheadline);
    const [error, setError] = useState(null);
    const typeID = typeof form.blockType === 'object' && form.blockType !== null ? form.blockType.id : form.blockType;
    useEffect(() => {
        if (!typeID)
            return;
        fetch(`/api/design-block-types/${typeID}?depth=0`, { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : null)
            .then((data) => setRendererKey(typeof data?.rendererKey === 'string' ? data.rendererKey : null))
            .catch(() => setRendererKey(null));
    }, [typeID]);
    useEffect(() => {
        if (!id)
            return;
        fetch(`/api/design-block-designs/${id}/dependencies`, { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : null)
            .then((data) => setDependencies(data))
            .catch(() => setDependencies(null));
    }, [id]);
    async function duplicate() {
        setError(null);
        const blockType = typeof form.blockType === 'object' && form.blockType !== null ? form.blockType.id : form.blockType;
        if (!blockType) {
            setError('Select a Block Type before duplicating.');
            return;
        }
        const name = `${String(form.name || 'Untitled Design')} Copy`;
        const slug = `${String(form.slug || 'design')}-copy-${Date.now().toString(36)}`;
        const response = await fetch('/api/design-block-designs', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, slug, blockType, design: form.design, status: 'draft', _status: 'draft' }),
        });
        if (!response.ok) {
            const failure = await response.json().catch(() => null);
            setError(failure?.errors?.map((item) => item.message).filter(Boolean).join('; ') || failure?.message || `Could not duplicate this design (${response.status}).`);
            return;
        }
        const body = await response.json();
        if (body.doc?.id)
            window.location.assign(`/admin/collections/design-block-designs/${body.doc.id}`);
    }
    return _jsxs("section", { style: { marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1.5rem' }, children: [_jsx("h3", { children: "Design Preview" }), _jsx("p", { children: "Sample values stay in this browser and are never saved as content." }), _jsxs("div", { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }, children: [_jsxs("label", { children: ["Sample headline ", _jsx("input", { value: headline, onChange: (event) => setHeadline(event.target.value) })] }), _jsxs("label", { children: ["Sample subheadline ", _jsx("input", { value: subheadline, onChange: (event) => setSubheadline(event.target.value) })] })] }), typeID && rendererKey === 'hero-board' ? _jsx(HeroPreview, { design: form.design, values: { ...heroBoardSample, headline, subheadline } }) : _jsx("p", { children: "Select a registered Block Type to preview its design." }), _jsx("div", { style: { marginTop: '1rem' }, children: _jsx("button", { type: "button", onClick: duplicate, children: "Duplicate as draft" }) }), error && _jsx("p", { role: "alert", children: error }), id && _jsxs("div", { style: { marginTop: '1.5rem' }, children: [_jsx("h4", { children: "Dependencies" }), dependencies ? _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Used by ", dependencies.templates.length, " Template", dependencies.templates.length === 1 ? '' : 's', "; affects ", dependencies.content.length, " content item", dependencies.content.length === 1 ? '' : 's', "."] }), _jsx("ul", { children: dependencies.templates.map((template) => _jsx("li", { children: template.name }, template.id)) })] }) : _jsx("p", { children: "Loading dependencies\u2026" })] })] });
}
