'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import './inspector-tabs.css';
import { Maximize2 } from 'lucide-react';
export function InspectorTabs({ value, onChange, documentLabel, onExpand, seo = false, }) {
    const tabs = seo ? ['block', 'document', 'seo'] : ['block', 'document'];
    return (_jsxs("div", { className: "editor-inspector-heading", children: [_jsx("div", { className: "editor-inspector-tabs", role: "tablist", "aria-label": "Inspector tabs", children: tabs.map((tab, index) => (_jsx("button", { type: "button", role: "tab", "aria-selected": value === tab, tabIndex: value === tab ? 0 : -1, "aria-label": tab === 'document' ? 'Document settings' : tab === 'seo' ? 'SEO' : undefined, title: tab === 'document' ? 'Document settings' : tab === 'seo' ? 'SEO settings' : undefined, onClick: () => onChange(tab), onKeyDown: (event) => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                            return;
                        event.preventDefault();
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                        onChange(tabs[next]);
                        event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
                    }, children: tab === 'block' ? 'Block' : tab === 'seo' ? 'SEO' : documentLabel }, tab))) }), onExpand && (_jsx("button", { type: "button", className: "editor-inspector-expand", "aria-label": "Expand inspector", title: "Expand inspector", onClick: onExpand, children: _jsx(Maximize2, { size: 17 }) }))] }));
}
