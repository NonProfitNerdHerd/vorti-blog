'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function BuilderInspectorTabs({ active, onChange, settingsLabel = 'Settings' }) {
    const button = (name, text) => (_jsx("button", { type: "button", role: "tab", "aria-selected": active === name, onClick: () => onChange(name), style: { padding: '9px 6px', border: 0, borderBottom: active === name ? '2px solid var(--theme-success-500)' : '2px solid transparent', background: 'transparent' }, children: text }));
    return _jsxs("div", { role: "tablist", "aria-label": "Element settings", style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 18, borderBottom: '1px solid var(--theme-elevation-150)' }, children: [button('settings', settingsLabel), button('style', 'Style'), button('advanced', 'Advanced')] });
}
