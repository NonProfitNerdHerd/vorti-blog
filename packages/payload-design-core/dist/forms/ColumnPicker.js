import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { columnPresets } from './columns.js';
export function ColumnPicker({ value, onChange, disabled }) {
    return _jsx("div", { className: "forms-column-presets", role: "group", "aria-label": "Column layouts", children: columnPresets.map(weights => _jsxs("button", { type: "button", disabled: disabled, "aria-label": `${weights.join('/')} columns`, "aria-pressed": weights.join('/') === value.join('/'), onClick: () => onChange(weights), children: [_jsx("span", { "aria-hidden": "true", style: { gridTemplateColumns: weights.map(weight => `${weight}fr`).join(' ') }, children: weights.map((_, index) => _jsx("i", {}, index)) }), _jsx("small", { children: weights.join(' / ') })] }, weights.join('/'))) });
}
