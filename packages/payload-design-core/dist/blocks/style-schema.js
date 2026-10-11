export const styleOptions = {
    display: ['block', 'flex', 'grid', 'inline-block'],
    flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
    flexWrap: ['wrap', 'nowrap'],
    alignItems: ['start', 'center', 'end', 'stretch', 'baseline'],
    justifyContent: ['start', 'center', 'end', 'space-between', 'space-around'],
    textAlign: ['left', 'center', 'right', 'justify', 'start', 'end'],
    position: ['static', 'relative', 'absolute', 'sticky', 'fixed'],
    overflow: ['visible', 'hidden', 'auto', 'scroll'],
    objectFit: ['cover', 'contain', 'fill', 'none'],
    borderStyle: ['solid', 'dashed', 'dotted', 'double', 'none'],
    fontWeight: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    fontStyle: ['normal', 'italic'],
    textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'],
    fontFamily: [
        'inherit',
        'system-ui',
        'serif',
        'sans-serif',
        'monospace',
        'var(--site-type-bodyFont)',
    ],
};
export const dimensionKeys = [
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'height',
    'maxHeight',
    'minWidth',
    'letterSpacing',
    'top',
    'right',
    'bottom',
    'left',
    'objectPosition',
];
export function extendedStyleValue(key, value) {
    if (styleOptions[key])
        return styleOptions[key].includes(value);
    if (key === 'opacity')
        return /^(0(\.\d+)?|1(\.0+)?)$/.test(value);
    if (key === 'zIndex')
        return /^-?\d{1,5}$/.test(value);
    if (key === 'aspectRatio')
        return /^(auto|\d+(\.\d+)?\s*\/\s*[1-9]\d*(\.\d+)?)$/.test(value);
    if (key === 'transform')
        return /^(translate[XY]?|scale|rotate|skew[XY]?)\([-\d.,%\s]+(?:px|deg)?\)(\s+(translate[XY]?|scale|rotate|skew[XY]?)\([-\d.,%\s]+(?:px|deg)?\))*$/.test(value);
    if (key === 'transition')
        return /^(all|transform|opacity|background-color) \d+(\.\d+)?s (ease|linear|ease-in|ease-out)$/.test(value);
    if (key === 'boxShadow')
        return /^(none|[-\d.pxrem\s]+ (#[a-fA-F0-9]{3,8}|[a-z]+))$/.test(value);
    if (key === 'backgroundImage')
        return /^linear-gradient\(\d+deg, #[a-fA-F0-9]{3,8}(, #[a-fA-F0-9]{3,8}){1,7}\)$/.test(value);
}
