import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import './hero-board.css';
function safeURL(url) {
    if (!url)
        return undefined;
    return /^https?:\/\//.test(url) || /^\/(?!\/)/.test(url) ? url : undefined;
}
export function HeroBoardRenderer({ design, values, headingLevel = 2 }) {
    const Heading = `h${headingLevel}`;
    const treatment = design.imageTreatment ?? 'background';
    const classes = [
        'hero-board', `hero-board--${treatment}`, `hero-board--${design.width ?? 'wide'}`,
        `hero-board--${design.spacing ?? 'large'}`, `hero-board--align-${design.alignment ?? 'left'}`,
        `hero-board--overlay-${design.overlay ?? 'dark'}`, `hero-board--text-${design.textContrast ?? 'light'}`,
    ].join(' ');
    const background = safeURL(values.backgroundImage?.url);
    const foreground = safeURL(values.foregroundImage?.url);
    return _jsxs("section", { className: classes, "aria-label": values.headline, children: [background && treatment !== 'split' && _jsx("img", { className: "hero-board__background", src: background, alt: values.backgroundImage?.alt || '' }), _jsx("div", { className: "hero-board__overlay", "aria-hidden": "true" }), _jsxs("div", { className: "hero-board__inner", children: [_jsxs("div", { className: "hero-board__copy", children: [values.eyebrow && _jsx("p", { className: "hero-board__eyebrow", children: values.eyebrow }), _jsx(Heading, { className: "hero-board__headline", children: values.headline }), values.subheadline && _jsx("p", { className: "hero-board__subheadline", children: values.subheadline }), _jsx("div", { className: "hero-board__actions", children: [values.primaryCTA, values.secondaryCTA].map((cta, index) => {
                                    const href = safeURL(cta?.url);
                                    return href && cta?.label ? _jsx("a", { className: `hero-board__button hero-board__button--${index === 0 ? design.buttonStyle ?? 'primary' : 'outline'}`, href: href, children: cta.label }, index) : null;
                                }) })] }), foreground && (treatment === 'split' || treatment === 'feature') && _jsx("img", { className: "hero-board__foreground", src: foreground, alt: values.foregroundImage?.alt || '' })] })] });
}
