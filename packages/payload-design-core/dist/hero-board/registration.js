export const heroBoardFields = [
    { key: 'eyebrow', label: 'Eyebrow', kind: 'text' },
    { key: 'headline', label: 'Headline', kind: 'text', required: true },
    { key: 'subheadline', label: 'Subheadline', kind: 'textarea' },
    { key: 'backgroundImage', label: 'Background Image', kind: 'media' },
    { key: 'foregroundImage', label: 'Foreground Image', kind: 'media' },
    { key: 'primaryCTA', label: 'Primary CTA', kind: 'group', children: [{ key: 'label', label: 'Label', kind: 'text' }, { key: 'url', label: 'URL', kind: 'url' }] },
    { key: 'secondaryCTA', label: 'Secondary CTA', kind: 'group', children: [{ key: 'label', label: 'Label', kind: 'text' }, { key: 'url', label: 'URL', kind: 'url' }] },
];
export const heroBoardRegistration = {
    slug: 'hero-board', rendererKey: 'hero-board',
    fields: ['text', 'textarea', 'media', 'group', 'url'],
    design: ['alignment', 'width', 'spacing', 'imageTreatment', 'overlay', 'textContrast', 'buttonStyle'],
};
export const heroBoardSample = {
    eyebrow: 'Example Category', headline: 'Example Hero Headline',
    subheadline: 'This is sample content used to preview the Hero Board design.',
    primaryCTA: { label: 'Learn More', url: '/example' },
};
export const heroBoardDesigns = [
    { name: 'Hero Board - Classic', slug: 'hero-board-classic', design: { alignment: 'left', width: 'full', spacing: 'large', imageTreatment: 'background', overlay: 'dark', textContrast: 'light', buttonStyle: 'primary' } },
    { name: 'Hero Board - Centered', slug: 'hero-board-centered', design: { alignment: 'center', width: 'full', spacing: 'large', imageTreatment: 'background', overlay: 'dark', textContrast: 'light', buttonStyle: 'outline' } },
    { name: 'Hero Board - Split', slug: 'hero-board-split', design: { alignment: 'left', width: 'wide', spacing: 'medium', imageTreatment: 'split', overlay: 'none', textContrast: 'light', buttonStyle: 'primary' } },
    { name: 'Hero Board - Feature', slug: 'hero-board-feature', design: { alignment: 'left', width: 'wide', spacing: 'extra-large', imageTreatment: 'feature', overlay: 'dark', textContrast: 'light', buttonStyle: 'minimal' } },
];
