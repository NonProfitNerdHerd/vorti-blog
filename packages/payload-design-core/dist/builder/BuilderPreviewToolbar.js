'use client';
import { jsx as _jsx } from "react/jsx-runtime";
export const BUILDER_PREVIEW_SIZES = {
    desktop: { viewport: 'desktop', width: 1440, height: 900 },
    tablet: { viewport: 'tablet', width: 768, height: 1024 },
    mobile: { viewport: 'mobile', width: 390, height: 844 },
};
export function BuilderPreviewToolbar({ value, onChange }) {
    return _jsx("div", { role: "toolbar", "aria-label": "Responsive preview", className: "template-editor__preview-toolbar", children: Object.keys(BUILDER_PREVIEW_SIZES).map((viewport) => _jsx("button", { type: "button", "aria-pressed": value === viewport, onClick: () => onChange(viewport), children: viewport[0].toUpperCase() + viewport.slice(1) }, viewport)) });
}
export function BuilderPreviewFrame({ children, viewport }) {
    const size = BUILDER_PREVIEW_SIZES[viewport];
    return _jsx("div", { className: "template-editor__preview-frame", "data-viewport": viewport, style: { maxWidth: `min(100%, ${size.width}px)` }, children: children });
}
