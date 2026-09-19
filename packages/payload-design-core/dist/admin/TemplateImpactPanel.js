'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDocumentInfo } from '@payloadcms/ui';
import { useEffect, useState } from 'react';
import { HeroBoardRenderer } from '../hero-board/HeroBoard.js';
import { heroBoardSample } from '../hero-board/registration.js';
export function TemplateImpactPanel() {
    const { id } = useDocumentInfo();
    const [content, setContent] = useState([]);
    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    useEffect(() => {
        if (!id)
            return;
        fetch(`/api/design-templates/${id}/dependencies`, { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : Promise.resolve([]))
            .then((data) => setContent(Array.isArray(data) ? data : []))
            .catch(() => setContent([]));
    }, [id]);
    async function loadPreview() {
        if (!id)
            return;
        setPreviewError(null);
        const response = await fetch(`/api/design-templates/${id}?draft=true&depth=0`, { credentials: 'same-origin' });
        if (!response.ok) {
            setPreviewError('Save a draft before previewing this Template.');
            return;
        }
        const template = await response.json();
        const hero = template.sections?.[0];
        if (!hero) {
            setPreviewError('This Template has no sections to preview.');
            return;
        }
        const [typeResponse, designResponse] = await Promise.all([
            fetch(`/api/design-block-types/${hero.blockType}?depth=0`, { credentials: 'same-origin' }),
            fetch(`/api/design-block-designs/${hero.blockDesign}?depth=0`, { credentials: 'same-origin' }),
        ]);
        if (!typeResponse.ok || !designResponse.ok || (await typeResponse.json()).rendererKey !== 'hero-board') {
            setPreviewError('Preview is available for Hero Board sections.');
            return;
        }
        setPreview((await designResponse.json()).design);
    }
    const counts = Object.entries(content.reduce((result, item) => {
        result[item.collection] = (result[item.collection] ?? 0) + 1;
        return result;
    }, {}));
    return _jsxs("section", { children: [_jsx("h3", { children: "Template impact" }), _jsxs("p", { children: ["Published changes can affect ", content.filter((item) => item.status === 'published').length, " published content item", content.filter((item) => item.status === 'published').length === 1 ? '' : 's', " (", content.length, " linked total)."] }), _jsx("ul", { children: counts.map(([collection, count]) => _jsxs("li", { children: [count, " ", collection] }, collection)) }), _jsx("button", { type: "button", onClick: loadPreview, children: "Preview saved draft" }), previewError && _jsx("p", { role: "alert", children: previewError }), preview && _jsx(HeroBoardRenderer, { design: preview, values: heroBoardSample })] });
}
