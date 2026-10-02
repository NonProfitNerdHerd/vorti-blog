/**
 * Schema-neutral contracts for the future shared builder core.
 *
 * These types deliberately contain no Payload form paths, Template fields,
 * Site Template concepts, or rendering implementation. The current
 * TemplateBuilder does not consume them yet, so introducing this boundary
 * cannot alter its production behavior.
 */
export function builderCapabilities(mode, readOnly = false) {
    return {
        editValues: !readOnly,
        editStructure: !readOnly && mode !== 'template-content',
        editStyles: !readOnly && mode !== 'template-content',
        defineFields: !readOnly && mode === 'template-authoring',
    };
}
