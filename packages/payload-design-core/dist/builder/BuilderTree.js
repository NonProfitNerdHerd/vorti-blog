'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs through hook results. */
import { useDroppable } from '@dnd-kit/core';
import { Fragment } from 'react';
import { DropArea } from './DropArea.js';
export function BuilderCanvasTree({ actions, describe, id, nodes, selectedID, parentID = 'root' }) {
    return _jsx("div", { className: "template-editor__tree", children: nodes.map((node) => _jsxs(Fragment, { children: [_jsx(TreeInsertion, { parentID: parentID, beforeID: id(node), add: () => actions.add(parentID, id(node)) }), _jsx(CanvasNode, { node: node, siblings: nodes, actions: actions, describe: describe, id: id, selectedID: selectedID })] }, id(node))) });
}
function TreeInsertion({ parentID, beforeID, add }) {
    const drop = useDroppable({ id: `tree-insert:${parentID}:${beforeID}`, data: { containerID: parentID, beforeID } });
    return _jsx("div", { ref: drop.setNodeRef, className: "template-editor__between", "data-over": drop.isOver, children: _jsx("button", { type: "button", "aria-label": "Insert before element", onClick: add, children: "+" }) });
}
function CanvasNode({ actions, describe, id, node, selectedID }) {
    const nodeID = id(node);
    const descriptor = describe(node);
    return (_jsx("article", { "data-builder-node": nodeID, className: "template-editor__node", "data-selected": selectedID === nodeID, style: descriptor.style, children: (descriptor.wrap ?? ((content) => content))(_jsxs(_Fragment, { children: [_jsx("div", { className: "template-editor__node-body", role: "button", tabIndex: 0, "aria-label": descriptor.bodyAriaLabel, onClick: () => actions.edit(node), onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ')
                        actions.edit(node); }, children: descriptor.body }), descriptor.children?.length ? (descriptor.childrenClassName || descriptor.childrenStyle ? _jsx("div", { className: descriptor.childrenClassName, style: descriptor.childrenStyle, children: descriptor.children.map((container) => _jsx("div", { className: container.className, "data-builder-node": container.id, "data-selected": selectedID === container.id, children: _jsx(DropArea, { id: container.id, label: container.label, add: () => actions.add(container.id), addItem: (item) => actions.addItem(item, container.id), children: _jsx(BuilderCanvasTree, { parentID: container.id, nodes: container.children, actions: actions, describe: describe, id: id, selectedID: selectedID }) }) }, container.id)) }) : _jsx(_Fragment, { children: descriptor.children.map((container) => _jsx(DropArea, { id: container.id, label: container.label, add: () => actions.add(container.id), addItem: (item) => actions.addItem(item, container.id), children: _jsx(BuilderCanvasTree, { parentID: container.id, nodes: container.children, actions: actions, describe: describe, id: id, selectedID: selectedID }) }, container.id)) })) : null] })) }));
}
export function BuilderListView({ describe, id, nodes, onSelect, selectedID, depth = 0 }) {
    return _jsx("div", { role: depth ? 'group' : 'tree', "aria-label": depth ? undefined : 'Template block list', children: nodes.map((node) => {
            const descriptor = describe(node);
            const nodeID = id(node);
            return _jsxs("div", { role: "treeitem", "aria-level": depth + 1, "aria-selected": selectedID === nodeID, style: { marginLeft: depth * 12 }, children: [_jsxs("button", { type: "button", className: "template-editor__list-row", "data-selected": selectedID === nodeID, onClick: () => onSelect(node), children: [_jsx("span", { className: "template-editor__list-icon", "aria-hidden": "true", children: descriptor.icon ?? '¶' }), _jsx("span", { children: descriptor.listTitle ?? descriptor.title })] }), descriptor.children?.map((container) => container.listLabel ? _jsxs("div", { style: { marginLeft: (depth + 1) * 12 }, children: [_jsx("div", { className: "template-editor__column-label", children: container.listLabel }), _jsx(BuilderListView, { nodes: container.children, describe: describe, id: id, onSelect: onSelect, selectedID: selectedID, depth: depth + 2 })] }, container.id) : _jsx(BuilderListView, { nodes: container.children, describe: describe, id: id, onSelect: onSelect, selectedID: selectedID, depth: depth + 1 }, container.id))] }, nodeID);
        }) });
}
