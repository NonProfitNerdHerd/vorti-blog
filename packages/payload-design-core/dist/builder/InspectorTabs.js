'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import './inspector-tabs.css';
export function InspectorTabs({ value, onChange, documentLabel }) {
    return _jsx("div", { className: "editor-inspector-tabs", role: "tablist", "aria-label": "Inspector tabs", children: ['block', 'document'].map((tab, index) => _jsx("button", { type: "button", role: "tab", "aria-selected": value === tab, tabIndex: value === tab ? 0 : -1, "aria-label": tab === 'document' ? 'Document settings' : undefined, title: tab === 'document' ? 'Document settings' : undefined, onClick: () => onChange(tab), onKeyDown: event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                    return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
                onChange(next === 0 ? 'block' : 'document');
                event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
            }, children: tab === 'block' ? 'Block' : documentLabel }, tab)) });
}
