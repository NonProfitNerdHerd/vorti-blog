'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, PanelsTopLeft, TextCursorInput, MoreVertical, Mail, CalendarDays, ListChecks, Hash, Rows3, FileUp, Heading, AlignLeft, SquareCheck } from 'lucide-react';
import { formFields } from './registry.js';
import { flattenFields } from './model.js';
import { virtualCanvasID } from './canvases.js';
function Row({ field, selected, select, menu, readOnly, children, expanded, toggle }) {
    const virtual = field.id === virtualCanvasID;
    const { setNodeRef: drag, attributes, listeners, isDragging } = useDraggable({ id: `list:${field.id}`, disabled: readOnly || virtual });
    const { setNodeRef: drop, isOver } = useDroppable({ id: `listtarget:${field.id}` });
    const Icon = field.kind === 'step' ? PanelsTopLeft : ['section', 'row', 'repeater'].includes(field.kind) ? Rows3 : field.kind === 'email' ? Mail : ['date', 'time', 'datetime', 'dateRange'].includes(field.kind) ? CalendarDays : ['select', 'searchSelect', 'radio', 'multiSelect', 'ranking', 'likert'].includes(field.kind) ? ListChecks : ['checkbox', 'consent', 'terms'].includes(field.kind) ? SquareCheck : ['number', 'currency', 'slider', 'calculated', 'rating', 'nps'].includes(field.kind) ? Hash : field.kind === 'upload' ? FileUp : field.kind === 'heading' ? Heading : ['textarea', 'content'].includes(field.kind) ? AlignLeft : TextCursorInput;
    return _jsxs("li", { ref: drop, className: isOver ? 'forms-tree-drop' : undefined, children: [_jsxs("div", { className: `forms-tree-row ${selected === field.id ? 'is-selected' : ''}`, style: { opacity: isDragging ? .4 : 1 }, children: [field.children ? _jsx("button", { type: "button", "aria-label": `${expanded ? 'Collapse' : 'Expand'} ${field.label}`, "aria-expanded": expanded, onClick: toggle, children: expanded ? _jsx(ChevronDown, { size: 14 }) : _jsx(ChevronRight, { size: 14 }) }) : _jsx("span", { className: "forms-tree-spacer" }), _jsxs("button", { type: "button", ref: drag, ...attributes, ...listeners, "aria-disabled": undefined, "data-form-tree-row": true, "aria-pressed": selected === field.id, onClick: () => select(field.id), onKeyDown: event => {
                            if (event.key === 'ArrowRight' && field.children) {
                                event.preventDefault();
                                if (!expanded)
                                    toggle();
                                else
                                    event.currentTarget.closest('li')?.querySelector('ul [data-form-tree-row]')?.focus();
                            }
                            else if (event.key === 'ArrowLeft') {
                                event.preventDefault();
                                if (field.children && expanded)
                                    toggle();
                                else
                                    event.currentTarget.closest('li')?.parentElement?.closest('li')?.querySelector('[data-form-tree-row]')?.focus();
                            }
                            else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                                event.preventDefault();
                                const rows = Array.from(event.currentTarget.closest('[aria-label="Form hierarchy"]')?.querySelectorAll('[data-form-tree-row]') || []), index = rows.indexOf(event.currentTarget);
                                rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
                            }
                            else
                                listeners?.onKeyDown?.(event);
                        }, children: [_jsx(Icon, { size: 16 }), _jsxs("span", { children: [field.label || 'Untitled part', _jsx("small", { children: virtual ? 'Existing content' : formFields.get(field.kind)?.label })] })] }), _jsx("button", { type: "button", "aria-label": `Actions for ${field.label}`, onClick: () => menu(field.id), children: _jsx(MoreVertical, { size: 16 }) })] }), expanded && children] });
}
export function FormHierarchy({ canvases, selected, select, menu, readOnly }) {
    const [collapsed, setCollapsed] = useState([]);
    const draw = (field) => {
        const containsSelected = flattenFields(field.children || []).some(child => child.id === selected);
        const expanded = !collapsed.includes(field.id) || containsSelected;
        return _jsx(Row, { field: field, selected: selected, select: select, menu: menu, readOnly: readOnly, expanded: expanded, toggle: () => { if (containsSelected && expanded)
                select(field.id); setCollapsed(old => expanded ? [...old.filter(id => id !== field.id), field.id] : old.filter(id => id !== field.id)); }, children: field.children?.length ? _jsx("ul", { children: field.children.map(draw) }) : null }, field.id);
    };
    return _jsx("ul", { className: "forms-hierarchy", "aria-label": "Form hierarchy", children: canvases.map(draw) });
}
