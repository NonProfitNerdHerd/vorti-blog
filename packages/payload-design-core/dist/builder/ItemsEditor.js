'use client';
import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { blockItems } from '../blocks/items.js';
import { IconPicker } from './IconPicker.js';
export function ItemsEditor({ value, change, social = false, }) {
    const items = blockItems(value, social);
    const update = (index, patch) => change(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    return (_jsxs("div", { children: [items.map((item, index) => (_jsxs("fieldset", { children: [_jsxs("legend", { children: [social ? 'Link' : 'Item', " ", index + 1] }), _jsxs("label", { children: ["Label", _jsx("input", { value: item.label, onChange: (event) => update(index, { label: event.target.value }) })] }), _jsxs("label", { children: ["Link URL", _jsx("input", { value: item.url ?? '', onChange: (event) => update(index, { url: event.target.value }) })] }), _jsxs("details", { children: [_jsx("summary", { children: "Icon" }), _jsx(IconPicker, { value: item.icon ?? 'check', change: (icon) => update(index, { icon }) })] }), _jsx("button", { type: "button", disabled: index === 0, onClick: () => {
                            const next = [...items];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            change(next);
                        }, children: "Move item up" }), _jsx("button", { type: "button", onClick: () => change(items.filter((_, i) => i !== index)), children: "Remove item" })] }, index))), _jsxs("button", { type: "button", onClick: () => change([
                    ...items,
                    { label: social ? 'Website' : 'New item', icon: social ? 'globe' : 'check' },
                ]), children: ["Add ", social ? 'link' : 'item'] })] }));
}
