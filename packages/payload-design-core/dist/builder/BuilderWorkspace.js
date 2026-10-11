'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { InspectorDevice, InspectorToggle } from './InspectorControls.js';
import { BlockInspectorStateProvider } from './UnifiedBlockInspector.js';
/** Layout shared by content authoring, locked templates and template design adapters. */
export function BuilderPanels({ children, className, leftOpen, rightOpen, viewport = 'desktop', onViewportChange = () => { }, }) {
    return (_jsx("div", { className: className, "data-left": leftOpen, "data-right": rightOpen, "data-library": leftOpen ? 'open' : 'closed', "data-inspector": rightOpen ? 'open' : 'closed', children: _jsx(InspectorDevice.Provider, { value: { viewport, change: onViewportChange }, children: _jsx(BlockInspectorStateProvider, { children: children }) }) }));
}
export function BuilderWorkspace({ canvas, canvasLabel, canvasTitle, inspector, documentLabel = 'Template', viewport, onViewportChange, library, libraryNavigation, libraryOpen, libraryTitle, onLibraryOpenChange, documentSettings, selectionKey, sidebar, sidebarControls, readOnly, }) {
    const [inspectorOpen, setInspectorOpen] = useState(true);
    const [tab, setTab] = useState('block');
    useEffect(() => {
        if (selectionKey) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the adapter-owned selection.
            setTab('block');
            setInspectorOpen(true);
        }
    }, [selectionKey]);
    return (_jsxs(_Fragment, { children: [sidebarControls ?? (_jsxs("button", { type: "button", className: "template-editor__toggle", "aria-expanded": libraryOpen, "aria-controls": "template-element-library", onClick: () => onLibraryOpenChange(!libraryOpen), children: ["\u2630 ", libraryOpen ? 'Hide' : 'Show', " editor sidebar"] })), _jsx(InspectorToggle, { open: inspectorOpen, change: setInspectorOpen }), _jsxs(BuilderPanels, { className: "template-editor__workspace", leftOpen: libraryOpen, rightOpen: inspectorOpen, viewport: viewport, onViewportChange: onViewportChange, children: [libraryOpen && (_jsx("aside", { id: "template-element-library", className: "template-editor__sidebar template-editor__sidebar--left", "aria-label": "Element Library", children: _jsx("div", { className: "template-editor__sidebar-inner", children: sidebar ?? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "template-editor__sidebar-header", children: [_jsx("h2", { children: libraryTitle }), _jsx("button", { type: "button", className: "template-editor__icon-button", "aria-label": "Close Element Library", onClick: () => onLibraryOpenChange(false), children: "\u00D7" })] }), libraryNavigation, library] })) }) })), _jsxs("main", { "aria-label": canvasLabel, className: "template-editor__canvas", children: [canvasTitle && (_jsx("div", { className: "template-editor__canvas-header", children: _jsx("h2", { children: canvasTitle }) })), canvas] }), inspectorOpen && (_jsx("aside", { "aria-label": "Configure panel", className: "template-editor__sidebar template-editor__sidebar--right", children: _jsxs("div", { className: "template-editor__sidebar-inner", children: [documentSettings && (_jsxs("div", { role: "tablist", "aria-label": "Inspector", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": tab === 'block', onClick: () => setTab('block'), children: "Block" }), _jsx("button", { type: "button", role: "tab", "aria-label": "Document settings", title: "Document settings", "aria-selected": tab === 'document', onClick: () => setTab('document'), children: documentLabel })] })), _jsx("fieldset", { disabled: readOnly, style: { border: 0, padding: 0, margin: 0, minWidth: 0 }, children: tab === 'document' && documentSettings ? documentSettings : inspector })] }) }))] })] }));
}
