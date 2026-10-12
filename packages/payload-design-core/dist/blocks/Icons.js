import { jsx as _jsx } from "react/jsx-runtime";
export const iconPaths = {
    check: 'm5 12 4 4L19 6',
    star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
    arrow: 'M4 12h16m-7-7 7 7-7 7',
    heart: 'M12 21 3 12C-3 3 9 0 12 7c3-7 15-4 9 5Z',
    info: 'M12 10v7m0-10v.1M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
    location: 'M12 22S3 14 3 9a9 9 0 0 1 18 0c0 5-9 13-9 13ZM15 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
    mail: 'M3 5h18v14H3ZM3 5l9 8 9-8',
    phone: 'm5 3 4 4-2 4 6 6 4-2 4 4c-6 9-27-12-16-16Z',
    plus: 'M12 3v18M3 12h18',
    minus: 'M3 12h18',
    user: 'M16 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0M3 22v-4c0-7 18-7 18 0v4',
    calendar: 'M3 5h18v17H3ZM3 10h18M7 2v6M17 2v6',
    clock: 'M12 7v5l4 3M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
    globe: 'M2 12h20M12 2c-8 5-8 15 0 20 8-5 8-15 0-20ZM22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
    home: 'm2 11 10-9 10 9M5 9v13h5v-7h4v7h5V9',
    search: 'M16 10a6 6 0 1 0-12 0 6 6 0 0 0 12 0m-2 4 8 8',
};
export function BlockIcon({ name, style }) {
    return (_jsx("svg", { viewBox: "0 0 24 24", width: "1em", height: "1em", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", style: style, children: _jsx("path", { d: iconPaths[name] ?? iconPaths.star }) }));
}
