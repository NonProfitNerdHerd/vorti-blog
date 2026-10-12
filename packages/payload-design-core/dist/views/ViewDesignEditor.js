'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { UnifiedBlockInspector } from '../builder/UnifiedBlockInspector.js';
import { InspectorDevice } from '../builder/InspectorControls.js';
/** The same inspector and responsive state used by document blocks. */
export function ViewDesignEditor({ value, onChange, viewport, onDeviceChange, disabled, renderBackgroundMedia, tab, }) {
    return (_jsx(InspectorDevice.Provider, { value: { viewport, change: onDeviceChange }, children: _jsx(UnifiedBlockInspector, { node: { id: 'saved-view-design', kind: 'group', label: 'View appearance', ...value }, onChange: (patch) => onChange({ ...value, ...patch }), disabled: disabled, showFields: false, activeTab: tab, hideHeader: !!tab, renderBackgroundMedia: renderBackgroundMedia }) }));
}
