'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import { FormPartIcon } from './FormPartIcon.js';
import { blockLabel, contactComponents } from './contact.js';
import { formFields } from './registry.js';
import { flattenFields } from './model.js';
import { virtualCanvasID } from './canvases.js';
function Row({ field, selected, select, menu, readOnly, children, expanded, toggle, open }) {
    const virtual = field.id === virtualCanvasID;
    const { setNodeRef: drag, attributes, listeners, isDragging } = useDraggable({ id: `list:${field.id}`, disabled: readOnly || virtual });
    const { setNodeRef: drop, isOver } = useDroppable({ id: `listtarget:${field.id}` });
    return _jsxs("li", { ref: drop, className: isOver ? 'forms-tree-drop' : undefined, children: [_jsxs("div", { className: `forms-tree-row ${selected === field.id ? 'is-selected' : ''}`, style: { opacity: isDragging ? .4 : 1 }, children: [(field.children || contactComponents(field).length > 0) ? _jsx("button", { type: "button", "aria-label": `${expanded ? 'Collapse' : 'Expand'} ${blockLabel(field)}`, "aria-expanded": expanded, onClick: toggle, children: expanded ? _jsx(ChevronDown, { size: 14 }) : _jsx(ChevronRight, { size: 14 }) }) : _jsx("span", { className: "forms-tree-spacer" }), _jsxs("button", { type: "button", ref: drag, ...attributes, ...listeners, "aria-disabled": undefined, "data-form-tree-row": true, "aria-pressed": selected === field.id, onClick: () => select(field.id), onDoubleClick: open, onKeyDown: event => {
                            if (event.key === 'ArrowRight' && (field.children || contactComponents(field).length)) {
                                event.preventDefault();
                                if (!expanded)
                                    toggle();
                                else
                                    event.currentTarget.closest('li')?.querySelector('ul [data-form-tree-row], ul [data-form-component-row]')?.focus();
                            }
                            else if (event.key === 'ArrowLeft') {
                                event.preventDefault();
                                if ((field.children || contactComponents(field).length) && expanded)
                                    toggle();
                                else
                                    event.currentTarget.closest('li')?.parentElement?.closest('li')?.querySelector('[data-form-tree-row]')?.focus();
                            }
                            else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                                event.preventDefault();
                                const rows = Array.from(event.currentTarget.closest('[aria-label="Form hierarchy"]')?.querySelectorAll('[data-form-tree-row], [data-form-component-row]') || []), index = rows.indexOf(event.currentTarget);
                                rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
                            }
                            else
                                listeners?.onKeyDown?.(event);
                        }, children: [_jsx(FormPartIcon, { kind: field.layout?.kind === 'column' ? 'column' : field.kind }), _jsxs("span", { children: [blockLabel(field) || 'Untitled part', _jsx("small", { children: virtual ? 'Existing content' : field.layout?.kind === 'column' ? 'Column' : formFields.get(field.kind)?.label })] })] }), _jsx("button", { type: "button", "aria-label": `Actions for ${blockLabel(field)}`, onClick: () => menu(field.id), children: _jsx(MoreVertical, { size: 16 }) })] }), expanded && children] });
}
export function FormHierarchy({ canvases, selected, select, menu, readOnly, component, open }) {
    const [collapsed, setCollapsed] = useState([]);
    const draw = (field) => {
        const containsSelected = flattenFields(field.children || []).some(child => child.id === selected);
        const expanded = !collapsed.includes(field.id) || containsSelected || (selected === field.id && !!component);
        return _jsxs(Row, { open: () => open(field.id), field: field, selected: selected, select: select, menu: menu, readOnly: readOnly, expanded: expanded, toggle: () => { if (containsSelected && expanded)
                select(field.id); setCollapsed(old => expanded ? [...old.filter(id => id !== field.id), field.id] : old.filter(id => id !== field.id)); }, children: [field.children?.length ? _jsx("ul", { children: field.children.map(draw) }) : null, contactComponents(field).length > 0 && _jsx("ul", { children: contactComponents(field).map(part => _jsx("li", { children: _jsxs("button", { type: "button", "data-form-component-row": true, onKeyDown: event => { if (event.key === 'ArrowLeft') {
                                event.preventDefault();
                                event.currentTarget.closest('ul')?.parentElement?.querySelector('[data-form-tree-row]')?.focus();
                            }
                            else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                                event.preventDefault();
                                const rows = Array.from(event.currentTarget.closest('[aria-label="Form hierarchy"]')?.querySelectorAll('[data-form-tree-row], [data-form-component-row]') || []), index = rows.indexOf(event.currentTarget);
                                rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
                            } }, "aria-pressed": selected === field.id && component === part.key, onClick: () => select(field.id, part.key), onDoubleClick: () => open(field.id, part.key), children: [_jsx(FormPartIcon, { kind: "text" }), part.label] }) }, part.key)) })] }, field.id);
    };
    return _jsx("ul", { className: "forms-hierarchy", "aria-label": "Form hierarchy", children: canvases.map(draw) });
}
