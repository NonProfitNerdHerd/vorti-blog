import { templateStyle, textDocument } from './model.js';
export function readPath(source, path) {
    return path
        .split('.')
        .reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, source);
}
export function templateContentNodes(template, document, types, designs, includeUnplacedFields = false) {
    function fieldNode(field, path) {
        const bindingPath = path ??
            (field.content?.source === 'document'
                ? field.content.field
                : `templateValues.${field.content?.source === 'customField' ? field.content.fieldId : field.id}`);
        const value = field.content?.source === 'static' ? field.content.value : readPath(document, bindingPath);
        const kind = {
            shortText: 'heading',
            longText: 'paragraph',
            richText: 'richText',
            image: 'image',
            images: 'gallery',
            videoURL: 'video',
            link: 'button',
        }[field.fieldType] ?? 'value';
        return {
            id: field.id,
            kind,
            label: field.label,
            text: typeof value === 'string' || typeof value === 'number'
                ? String(value)
                : typeof value === 'boolean'
                    ? value
                        ? 'Yes'
                        : 'No'
                    : value && typeof value === 'object'
                        ? String(value.displayName ??
                            value.title ??
                            '')
                        : '',
            richText: field.fieldType === 'richText' && typeof value === 'string'
                ? textDocument({ id: field.id, kind: 'paragraph', text: value })
                : field.fieldType === 'richText'
                    ? value
                    : undefined,
            media: value,
            url: typeof value === 'string' && ['videoURL', 'link'].includes(field.fieldType)
                ? value
                : undefined,
            styles: templateStyle(field.style),
            anchor: field.style?.anchor,
            binding: field.content?.source === 'static'
                ? undefined
                : {
                    path: bindingPath,
                    kind: field.fieldType,
                    required: field.required,
                    helpText: field.helpText ??
                        template.customFields?.find((custom) => `templateValues.${custom.id}` === bindingPath)?.helpText,
                    options: field.options,
                    relationTo: field.relationTo,
                },
        };
    }
    function convert(node) {
        if (node.type === 'field')
            return fieldNode(node);
        if (node.type === 'layout')
            return {
                id: node.id,
                kind: node.layout === 'container' || node.layout === 'stack' ? 'group' : node.layout,
                label: node.layout,
                anchor: node.style?.anchor,
                styles: {
                    ...templateStyle(node.style),
                    desktop: {
                        ...templateStyle(node.style).desktop,
                        ...(node.layout === 'columns'
                            ? { gridTemplateColumns: node.columns?.map((col) => `${col.width}fr`).join(' ') }
                            : {}),
                    },
                },
                children: node.layout === 'columns'
                    ? node.columns?.map((col) => ({
                        id: col.id,
                        kind: 'column',
                        children: col.children.map(convert),
                    }))
                    : node.children?.map(convert),
            };
        const type = types.find((type) => String(type.id) === String(node.blockType));
        const design = designs.find((design) => String(design.id) === String(node.blockDesign));
        const values = Object.fromEntries(Object.entries(node.slotMappings).map(([slot, id]) => [
            slot,
            readPath(document, `templateValues.${id}`),
        ]));
        return {
            id: node.id,
            kind: 'designed',
            label: node.name,
            rendererKey: type?.rendererKey,
            blockType: node.blockType,
            blockDesign: node.blockDesign,
            design: design?.design,
            values,
            styles: templateStyle(node.style),
            fields: node.fields.map((field) => fieldNode(field)),
        };
    }
    const legacy = (template.sections ?? []).map((section) => {
        const type = types.find((type) => String(type.id) === String(section.blockType));
        const design = designs.find((design) => String(design.id) === String(section.blockDesign));
        const fields = (type?.fields ?? []).flatMap((field) => field.kind === 'group'
            ? (field.children ?? []).map((child) => fieldNode({
                id: `${section.key}_${field.key}_${child.key}`,
                type: 'field',
                fieldType: child.kind === 'media' ? 'image' : 'shortText',
                label: `${field.label}: ${child.label}`,
                required: child.required,
            }, `templateValues.${section.key}.${field.key}.${child.key}`))
            : [
                fieldNode({
                    id: `${section.key}_${field.key}`,
                    type: 'field',
                    fieldType: field.kind === 'media'
                        ? 'image'
                        : field.kind === 'textarea'
                            ? 'longText'
                            : field.kind === 'boolean'
                                ? 'toggle'
                                : field.kind === 'number'
                                    ? 'number'
                                    : field.kind === 'select'
                                        ? 'select'
                                        : 'shortText',
                    label: field.label,
                    required: field.required,
                    options: field.options,
                }, `templateValues.${section.key}.${field.key}`),
            ]);
        return {
            id: section.key,
            kind: 'designed',
            label: section.name,
            blockType: section.blockType,
            blockDesign: section.blockDesign,
            rendererKey: type?.rendererKey,
            design: design?.design,
            values: readPath(document, `templateValues.${section.key}`) ?? {},
            fields,
        };
    });
    const nodes = [...legacy, ...(template.layout ?? []).map(convert)];
    const bound = new Set();
    const collect = (items) => items.forEach((node) => {
        if (node.binding)
            bound.add(node.binding.path);
        collect(node.children ?? []);
        collect(node.fields ?? []);
    });
    collect(nodes);
    for (const field of template.customFields ?? [])
        if (includeUnplacedFields && !bound.has(`templateValues.${field.id}`))
            nodes.push(fieldNode({ ...field, type: 'field' }));
    return nodes;
}
