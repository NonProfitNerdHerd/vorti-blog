'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { usePublicFetch } from '../PublicSiteContext.js';
import { useEffect, useState } from 'react';
import { FormHost } from './FormHost.js';
import { FormRenderer } from './FormRenderer.js';
export function FormPlacement({ formID, editing }) {
    const publicFetch = usePublicFetch();
    const [loaded, setLoaded] = useState();
    const [error, setError] = useState();
    useEffect(() => {
        if (!formID)
            return;
        const controller = new AbortController();
        publicFetch(`/api/forms-placement/${encodeURIComponent(formID)}`, { signal: controller.signal }).then(async (response) => {
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.message || 'This form is unavailable.');
            setLoaded({ ...body, id: formID });
            setError(undefined);
        }).catch(error => { if (!controller.signal.aborted)
            setError({ id: formID, message: error.message }); });
        return () => controller.abort();
    }, [formID, publicFetch]);
    if (!formID)
        return editing ? _jsx("p", { children: "Select a published Form in the inspector. Build and publish its fields in Forms." }) : null;
    if (error?.id === formID)
        return _jsx("p", { role: "status", children: error.message });
    if (loaded?.id !== formID)
        return _jsx("p", { role: "status", children: "Loading form\u2026" });
    return editing ? _jsxs("section", { "aria-label": "Form block preview", children: [_jsx("h2", { children: loaded.title }), _jsx("p", { children: "Preview only. Submissions, uploads, and reservations are disabled in the page editor." }), _jsx(FormRenderer, { definition: loaded.definition, preview: true })] }) : _jsx(FormHost, { slug: loaded.slug, embedded: true });
}
