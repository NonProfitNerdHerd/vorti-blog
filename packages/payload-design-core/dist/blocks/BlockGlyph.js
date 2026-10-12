import { jsx as _jsx } from "react/jsx-runtime";
import { listViews, viewBlockKind } from '../views/model.js';
export function registerBlockIcon(key, path) {
    if (!/^[a-zA-Z][\w-]*$/.test(key) || blockGlyphs[key])
        throw new Error(`Invalid or duplicate icon ${key}`);
    if (!path || path.length > 5000 || !/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+\-]+$/.test(path))
        throw new Error('Icons must be bundled SVG path data');
    blockGlyphs[key] = path;
}
/** Editor identity icons; separate from icons authored inside page content. */
export const blockGlyphs = {
    heading: 'M4 4v16M20 4v16M4 12h16',
    paragraph: 'M13 4v16M18 4v16M20 4H9a5 5 0 0 0 0 10h4',
    richText: 'M4 4h16M12 4v12M7 16h10M3 21h18',
    text: 'M3 5h18M3 10h18M3 15h14M3 20h10',
    list: 'M3 5h1M3 12h1M3 19h1M8 5h13M8 12h13M8 19h13',
    quote: 'M3 6h7v7H6v5H3ZM14 6h7v7h-4v5h-3Z',
    image: 'M3 3h18v18H3ZM3 17l6-7 4 5 3-3 5 6M17 7h.01',
    gallery: 'M7 2h15v15H7ZM2 7v15h15M7 14l5-6 4 4 3-2 3 4',
    video: 'M3 4h18v16H3ZM10 8l6 4-6 4Z',
    button: 'M3 7h18v10H3ZM8 12h8',
    iconButton: 'M3 6h18v12H3ZM9 9l5 3-5 3',
    iconList: 'm2 5 2 2 3-4M10 5h12m-20 7 2 2 3-4M10 12h12m-20 7 2 2 3-4M10 19h12',
    icon: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
    group: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7h10v10H7Z',
    row: 'M2 6h8v12H2ZM14 6h8v12h-8Z',
    columns: 'M2 3h5v18H2ZM10 3h5v18h-5ZM18 3h4v18h-4Z',
    column: 'M7 3h10v18H7Z',
    spacer: 'M3 3h18M3 21h18M12 6v12m-3-9 3-3 3 3m-6 6 3 3 3-3',
    divider: 'M2 12h20M5 6h14M5 18h14',
    separator: 'M2 8c5 0 5 8 10 8s5-8 10-8M2 20h20',
    accordion: 'M3 3h18v6H3ZM3 13h18v8H3Zm13 3 2 2 2-2M16 6h4',
    notification: 'M3 5h18v14H3ZM7 9v3m0 3h.01M11 9h7M11 14h7',
    carousel: 'M6 4h12v16H6ZM2 7v10M22 7v10M10 22h4',
    horizontalScroller: 'M2 5h8v14H2ZM13 5h8v14h-8M18 11l4 3-4 3',
    expand: 'M4 3h16M4 7h16M8 13l4 4 4-4M4 21h16',
    tabs: 'M3 8h18v13H3ZM3 8V3h6v5M12 4h3M18 4h3',
    videoPopup: 'M2 3h15v5M2 3v13h5M8 9h14v13H8Zm5 4 5 3-5 3Z',
    progressBar: 'M2 8h20v8H2ZM5 11h9v2H5Z',
    progressCircle: 'M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6M12 2v4M18 12h4',
    numberBox: 'M3 3h18v18H3ZM9 9l3-2v10M8 17h8',
    countUp: 'M3 20V9l4-3v14M1 20h8M13 14l4-5 4 5M17 9v12',
    countdown: 'M7 2h10M12 2v3M20 6l2-2M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 8v5l3 2',
    socialButtons: 'M3 9h5v6H3ZM10 9h5v6h-5ZM17 9h5v6h-5M5 4h14M5 20h14',
    card: 'M3 2h18v20H3ZM3 10h18M7 14h10M7 18h6',
    iconLabel: 'M2 7h8v10H2Zm12 2h8M14 15h6M5 10l3 2-3 2',
    subtitle: 'M2 5h20M8 11h8M12 11v9M9 20h6',
    imageBox: 'M2 2h20v20H2ZM5 5h14v10H5ZM5 15l5-6 4 4 3-2 2 4M7 19h10',
    price: 'M12 2v20M18 6H9a4 4 0 0 0 0 8h6a4 4 0 0 0 0-8M6 18h12',
    map: 'm2 5 6-3 8 4 6-3v16l-6 3-8-4-6 3ZM8 2v16M16 6v16',
    tableOfContents: 'M3 3h18v18H3ZM6 7h2M11 7h7M6 12h2M11 12h7M6 17h2M11 17h7',
    postListing: 'M2 3h20v18H2ZM5 6h6v6H5ZM14 6h5M14 10h5M5 16h14',
    savedView: 'M3 3h15v15H3ZM7 7h7v7H7M8 22h14V8M14 11h.01',
    pagination: 'm5 7-4 5 4 5M19 7l4 5-4 5M8 9h3v6H8ZM14 9h3v6h-3Z',
    loadMore: 'M3 3h18v8H3ZM3 15h6M15 15h6M12 12v10M7 17h10',
    hero: 'M2 3h20v18H2ZM6 8h12M8 12h8M9 16h6',
    testimonial: 'M2 3h20v13H9l-5 5v-5H2ZM6 7h12M6 11h8',
    callToAction: 'M2 4h20v16H2ZM5 8h14M5 12h8M15 14h4v3h-4Z',
    iconBox: 'M3 3h18v18H3ZM9 6h6v5H9ZM7 15h10M8 18h8',
    timeline: 'M6 2v20M3 5h6v4H3ZM3 15h6v4H3ZM12 5h10M12 9h7M12 15h10M12 19h7',
    feature: 'M2 5h8v14H2ZM14 5h8M14 10h8M14 15h5M14 19h8',
    pricingBox: 'M3 2h18v20H3ZM3 7h18M8 11h8M8 14h8M7 18h10',
    featureGrid: 'M2 2h9v9H2ZM15 2h7v9h-7ZM2 15h9v7H2ZM15 15h7v7h-7Z',
    teamMember: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3c0-7 16-7 16 0v3M7 21h10',
    document: 'M5 2h10l5 5v15H5ZM15 2v6h5M8 12h9M8 16h9',
    designed: 'm12 2 10 6-10 6L2 8Zm-10 11 10 6 10-6M2 18l10 6 10-6',
    value: 'M5 3h14v18H5ZM8 8l3 3-3 3M13 15h4',
};
const viewGlyphs = {
    grid: 'M2 2h8v5H2ZM14 2h8v5h-8ZM2 10h8v5H2ZM14 10h8v5h-8Z',
    list: 'M2 2h5v5H2ZM10 3h12M10 6h8M2 10h5v5H2ZM10 11h12M10 14h8',
    calendar: 'M2 3h20v12H2ZM2 7h20M7 1v4M17 1v4M8 7v8M15 7v8M2 11h20',
    map: 'm2 4 6-2 8 3 6-3v11l-6 3-8-3-6 3ZM8 2v11M16 5v11',
    slider: 'M6 2h12v13H6ZM2 5v7M22 5v7',
    split: 'M2 2h11v13H2ZM16 3h6M16 7h6M16 11h6M16 15h6',
};
// Bundled vector numerals distinguish the layout variants within each family.
const digitSegments = ['abcedf', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abfgcd'];
const segments = { a: 'M0 0h3', b: 'M3 0v2', c: 'M3 2v2', d: 'M0 4h3', e: 'M0 2v2', f: 'M0 0v2', g: 'M0 2h3' };
for (const [index, view] of listViews().entries()) {
    const marks = String(index + 1).split('').map((digit, position) => digitSegments[Number(digit)].split('').map(segment => segments[segment].replace(/M(\d) (\d)/g, (_, x, y) => `M${Number(x) + 8 + position * 5} ${Number(y) + 19}`)).join('')).join('');
    blockGlyphs[viewBlockKind(view.key)] = viewGlyphs[view.thumbnail] + marks;
}
export function BlockGlyph({ kind, style }) {
    const aliases = {
        shortText: 'heading',
        longText: 'text',
        images: 'gallery',
        logo: 'image',
        container: 'group',
        stack: 'column',
        link: 'button',
        navigation: 'list',
        date: 'countdown',
        number: 'numberBox',
        toggle: 'notification',
        relationship: 'savedView',
        select: 'tabs',
    };
    return (_jsx("svg", { viewBox: "0 0 24 24", width: "22", height: "22", "aria-hidden": "true", fill: "none", stroke: "currentColor", strokeWidth: "1.65", strokeLinecap: "round", strokeLinejoin: "round", style: { verticalAlign: 'middle', flexShrink: 0, ...style }, children: _jsx("path", { d: blockGlyphs[kind] || blockGlyphs[aliases[kind]] || blockGlyphs.document }) }));
}
