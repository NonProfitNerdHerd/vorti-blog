const registeredVariations = new Map();
export function registerVariations(kind, variations = []) {
    registeredVariations.set(kind, variations);
}
const families = {
    hero: ['Default', 'Horizontal', 'Half Overlay', 'Center Overlay', 'Side Overlay', 'Half'],
    card: ['Default', 'Default 2', 'Horizontal', 'Full', 'Faded'],
    callToAction: ['Default', 'Horizontal', 'Horizontal 2', 'Horizontal 3', 'Split Centered'],
    feature: [
        'Default',
        'Horizontal',
        ...Array.from({ length: 5 }, (_, i) => `Overlap Shape ${i + 1}`),
        ...Array.from({ length: 5 }, (_, i) => `Overlap Background ${i + 1}`),
    ],
    featureGrid: ['Default', 'Float', 'Horizontal', 'Large Mid', 'Offset', 'Zigzag'],
    postListing: [
        'Default',
        'List',
        'Image Card',
        'Horizontal',
        'Horizontal 2',
        'Portfolio',
        'Portfolio 2',
        'Vertical Card',
        'Vertical Card 2',
    ],
    imageBox: ['Default', 'Plain', 'Box', 'Captioned', 'Fade', 'Line'],
    accordion: ['Default', 'Plain', 'Shadow', 'Colored', 'Plus'],
    notification: ['Default', 'Plain', 'Side', 'Bordered', 'Outlined', 'Large Icon'],
    quote: ['Default', 'Simple', 'Highlighted', 'Huge', 'Centered Quote'],
    testimonial: ['Default', 'Compact', 'Horizontal', 'Bubble', 'Vertical', 'Inverted Vertical'],
    pricingBox: ['Default', 'Compact', 'Banner', 'Colored', 'Sectioned'],
    teamMember: ['Default', 'Plain', 'Horizontal', 'Horizontal 2', 'Cover'],
    button: ['Default', 'Ghost', 'Plain', 'Link'],
    iconButton: ['Default', 'Ghost', 'Pill', 'Link'],
    socialButtons: ['Default', 'Ghost', 'Pill', 'Plain'],
    tabs: ['Horizontal', 'Vertical'],
    timeline: ['Default'],
    iconBox: ['Default'],
};
export const styleOnlyKinds = new Set(['button', 'iconButton', 'socialButtons']);
export const compositeKinds = new Set([
    'hero',
    'card',
    'callToAction',
    'feature',
    'featureGrid',
    'imageBox',
    'testimonial',
    'iconBox',
    'pricingBox',
    'teamMember',
    'timeline',
]);
export function variationsFor(kind) {
    const registered = registeredVariations.get(kind);
    if (registered)
        return registered;
    return (families[kind] ?? []).map((label) => ({
        id: label.toLowerCase().replaceAll(' ', '-'),
        label,
        thumbnail: /overlay|overlap|cover|full|faded|fade|portfolio/.test(label.toLowerCase())
            ? 'overlay'
            : /horizontal|half|split/.test(label.toLowerCase())
                ? 'split'
                : kind === 'featureGrid'
                    ? 'grid'
                    : 'stack',
    }));
}
export function targetsFor(kind) {
    const targets = [];
    if (compositeKinds.has(kind))
        targets.push({
            id: 'container',
            label: 'Content container',
            selector: '> .block-composition > .block-content',
        }, { id: 'media', label: 'Media', selector: '> .block-composition > .block-media' }, { id: 'heading', label: 'Heading', selector: '[data-role="heading"]' }, { id: 'description', label: 'Description', selector: '[data-role="description"]' }, { id: 'actions', label: 'Actions', selector: '[data-role="actions"]' });
    if (['progressBar', 'progressCircle'].includes(kind))
        targets.push({ id: 'track', label: 'Track', selector: '.progress-track' }, { id: 'fill', label: 'Fill', selector: '.progress-fill' }, { id: 'label', label: 'Label', selector: '.progress-label' });
    if (kind === 'price')
        targets.push(...['currency', 'amount', 'period'].map((id) => ({
            id,
            label: id[0].toUpperCase() + id.slice(1),
            selector: `.price-${id}`,
        })));
    if (kind === 'numberBox')
        targets.push({ id: 'number', label: 'Number', selector: '.number-badge' }, { id: 'label', label: 'Label', selector: '.number-label' });
    if (kind === 'tabs')
        targets.push({ id: 'tab', label: 'Tab', selector: '[role="tab"]' }, { id: 'activeTab', label: 'Active tab', selector: '[role="tab"][aria-selected="true"]' }, { id: 'panel', label: 'Panel', selector: '[role="tabpanel"]' });
    if (kind === 'postListing')
        targets.push(...['item', 'image', 'title', 'excerpt', 'meta', 'link'].map((id) => ({
            id,
            label: `Listing ${id}`,
            selector: `.listing-${id}`,
        })));
    return targets;
}
export function roleFor(node) {
    return (node.role ??
        {
            image: 'media',
            heading: 'heading',
            paragraph: 'description',
            text: 'description',
            subtitle: 'subtitle',
            button: 'actions',
            iconButton: 'actions',
            socialButtons: 'actions',
            icon: 'icon',
            price: 'price',
            quote: 'quote',
            iconList: 'features',
        }[node.kind] ??
        'extra');
}
/** A layout change annotates existing children; it never removes or recreates content. */
export function applyVariation(node, id) {
    if (!variationsFor(node.kind).some((variation) => variation.id === id))
        return node;
    return {
        ...node,
        variation: { id, version: 1 },
        children: node.children?.map((child) => ({ ...child, role: roleFor(child) })),
    };
}
export function variationStyles(node) {
    if (!node.variation)
        return {};
    const registered = variationsFor(node.kind).find((item) => item.id === node.variation?.id)?.styles;
    if (registered)
        return registered;
    const kind = node.kind, id = node.variation.id;
    return {
        desktop: {
            ...(compositeKinds.has(kind)
                ? { padding: kind === 'hero' ? '64px 32px' : '24px', borderRadius: '8px' }
                : {}),
            ...(kind === 'hero' ? { minHeight: '360px' } : {}),
            ...(['card', 'pricingBox', 'testimonial', 'teamMember'].includes(kind)
                ? { borderWidth: '1px', borderColor: '#d1d5db' }
                : {}),
            ...(id === 'compact' ? { padding: '16px' } : {}),
            ...(id === 'colored' ? { backgroundColor: '#eef2ff', color: '#17212e' } : {}),
            ...(id === 'plain' || id === 'simple' ? { borderWidth: '0px', padding: '0px' } : {}),
        },
        mobile: compositeKinds.has(kind) ? { padding: '20px' } : {},
    };
}
export function effectiveStyles(node) {
    const base = variationStyles(node);
    const devices = ['desktop', 'tablet', 'mobile'];
    return Object.fromEntries(devices.map((device, index) => [
        device,
        {
            ...Object.assign({}, ...devices.slice(0, index + 1).map((key) => base[key])),
            ...Object.assign({}, ...devices.slice(0, index + 1).map((key) => node.styles?.[key])),
        },
    ]));
}
export function resetLayoutStyles(node) {
    const keys = /^(width|minWidth|maxWidth|height|minHeight|maxHeight|aspectRatio|padding|margin|display|flexDirection|flexWrap|alignItems|justifyContent|gap|gridTemplateColumns)/;
    return (node.styles &&
        Object.fromEntries(Object.entries(node.styles).map(([device, values]) => [
            device,
            Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => !keys.test(key))),
        ])));
}
export function validateVariation(node) {
    if (node.role !== undefined && !/^[a-zA-Z][\w-]{0,39}$/.test(node.role))
        return 'Invalid content role.';
    if (node.variation &&
        registeredVariations.has(node.kind) &&
        (node.variation.version !== 1 ||
            typeof node.variation.id !== 'string' ||
            !variationsFor(node.kind).some((v) => v.id === node.variation.id)))
        return 'Unknown block layout variation.';
}
