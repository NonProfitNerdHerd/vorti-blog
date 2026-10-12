'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContentNode, duplicateContent } from '../content/model.js';
import { IconPicker } from './IconPicker.js';
import { beginInspectorGesture, endInspectorGesture } from './InspectorControls.js';
export function RepeatedItemsControl({ node, change, }) {
    if (!['tabs', 'accordion', 'carousel', 'timeline', 'featureGrid'].includes(node.kind))
        return null;
    const items = node.children ?? [];
    const commit = (children) => {
        beginInspectorGesture();
        try {
            change({ children });
        }
        finally {
            endInspectorGesture();
        }
    };
    return (_jsxs("details", { open: true, children: [_jsx("summary", { children: "Items" }), items.map((item, index) => (_jsxs("div", { children: [_jsxs("label", { children: ["Item ", index + 1, " label", _jsx("input", { value: item.label ?? '', onChange: (event) => change({
                                    children: items.map((child) => child.id === item.id ? { ...child, label: event.target.value } : child),
                                }) })] }), node.kind === 'tabs' && (_jsx(IconPicker, { value: String(item.props?.tabIcon ?? ''), change: (tabIcon) => change({
                            children: items.map((child) => child.id === item.id ? { ...child, props: { ...child.props, tabIcon } } : child),
                        }) })), _jsx("button", { type: "button", disabled: index === 0, onClick: () => {
                            const next = [...items];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            commit(next);
                        }, children: "Move item up" }), _jsx("button", { type: "button", onClick: () => commit([
                            ...items.slice(0, index + 1),
                            duplicateContent(item),
                            ...items.slice(index + 1),
                        ]), children: "Duplicate item" }), _jsx("button", { type: "button", onClick: () => commit(items.filter((child) => child.id !== item.id)), children: "Remove item" })] }, item.id))), _jsx("button", { type: "button", onClick: () => {
                    const item = createContentNode(node.kind === 'featureGrid' ? 'iconBox' : 'group');
                    item.label = `Item ${items.length + 1}`;
                    if (node.kind !== 'featureGrid')
                        item.children = [{ ...createContentNode('paragraph'), text: 'Add item content' }];
                    if (node.kind === 'timeline') {
                        item.role = 'item';
                        item.props = { date: '', marker: String(items.length + 1) };
                    }
                    commit([...items, item]);
                }, children: "Add item" })] }));
}
