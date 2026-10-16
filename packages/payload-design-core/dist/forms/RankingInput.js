'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
function Item({ id, label, disabled }) {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
    return _jsxs("li", { ref: setNodeRef, style: { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .5 : 1 }, children: [_jsx("button", { type: "button", className: "forms-rank-handle", disabled: disabled, ...attributes, ...listeners, "aria-label": `Reorder ${label}`, title: "Drag to rank, or press Space and use arrow keys", children: _jsx(GripVertical, { size: 18 }) }), _jsx("span", { children: label })] });
}
export function RankingInput({ field, value, onChange, id, disabled }) {
    const context = useId(), [announcement, setAnnouncement] = useState('');
    const ordered = Array.isArray(value) ? value.map(String) : field.options?.map(option => option.id) || [];
    const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    return _jsxs("div", { id: id, className: "forms-ranking", children: [_jsx(DndContext, { id: context, sensors: sensors, collisionDetection: closestCenter, onDragEnd: ({ active, over }) => { if (disabled || !over || active.id === over.id)
                    return; const next = arrayMove(ordered, ordered.indexOf(String(active.id)), ordered.indexOf(String(over.id))); onChange(next); setAnnouncement(`${field.options?.find(option => option.id === active.id)?.label} moved to position ${next.indexOf(String(active.id)) + 1} of ${next.length}.`); }, onDragCancel: () => setAnnouncement('Ranking change cancelled.'), children: _jsx(SortableContext, { items: ordered, strategy: verticalListSortingStrategy, children: _jsx("ol", { children: ordered.map(item => _jsx(Item, { id: item, label: field.options?.find(option => option.id === item)?.label || item, disabled: disabled }, item)) }) }) }), _jsx("span", { className: "forms-sr-only", "aria-live": "polite", children: announcement }), _jsx("button", { type: "button", disabled: disabled, onClick: () => onChange(ordered), children: "Confirm this ranking" })] });
}
