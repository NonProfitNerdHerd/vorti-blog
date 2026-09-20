import { assertDesignCanDelete, assertTemplateCanDelete, getBlockDesignDependencies, getTemplateDependencies } from './dependencies.js';
import { createPayloadDependencySource } from './payload-store.js';
import { slugs } from './types.js';
import { walkTemplate } from './template-tree.js';
import { validateFieldDefinitions } from './validation.js';
const authenticated = ({ req }) => Boolean(req.user);
const primitiveOptions = ['text', 'textarea', 'number', 'boolean', 'select', 'media', 'url', 'date', 'group'];
export function createDesignCollections(options) {
    const manage = options.canManage ?? authenticated;
    const hiddenFromEditor = ({ user }) => options.isDesignManager ? !options.isDesignManager(user) : !user;
    const designRead = async (args) => (await manage(args)) === true ? true : { _status: { equals: 'published' }, status: { equals: 'published' } };
    const common = {
        admin: { group: 'Design' },
        access: { read: designRead, create: manage, update: manage, delete: manage },
        versions: { drafts: true },
    };
    const blockTypes = {
        ...common,
        slug: slugs.blockTypes,
        labels: { singular: 'Block Type', plural: 'Block Creator' },
        admin: { group: 'Design', useAsTitle: 'name', hidden: hiddenFromEditor, defaultColumns: ['name', 'designCount', 'status'] },
        hooks: {
            beforeChange: [async ({ data }) => {
                    const issues = validateFieldDefinitions((data.fields ?? []));
                    if (issues.length)
                        throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
                    return data;
                }],
            beforeDelete: [async ({ id, req }) => {
                    const designs = await req.payload.find({ collection: slugs.blockDesigns, where: { blockType: { equals: id } }, depth: 0, limit: 1, overrideAccess: true, req });
                    if (designs.totalDocs)
                        throw new Error('Block Type is referenced by a Block Design; archive or replace its designs first');
                }],
        },
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'slug', type: 'text', required: true, unique: true },
            { name: 'description', type: 'textarea' },
            { name: 'rendererKey', type: 'text', required: true },
            { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: ['draft', 'published', 'archived'] },
            { name: 'schemaVersion', type: 'number', defaultValue: 1, required: true, min: 1 },
            { name: 'designCount', label: 'Designs', type: 'number', virtual: true, admin: { readOnly: true }, hooks: {
                    afterRead: [async ({ data, req }) => data?.id ? (await req.payload.count({ collection: slugs.blockDesigns, where: { blockType: { equals: data.id } }, overrideAccess: true, req })).totalDocs : 0],
                } },
            { name: 'fields', type: 'array', fields: [
                    { name: 'key', type: 'text', required: true },
                    { name: 'label', type: 'text', required: true },
                    { name: 'kind', type: 'select', required: true, options: primitiveOptions },
                    { name: 'required', type: 'checkbox' },
                    { name: 'children', type: 'array', fields: [
                            { name: 'key', type: 'text', required: true },
                            { name: 'label', type: 'text', required: true },
                            { name: 'kind', type: 'select', required: true, options: primitiveOptions.filter((option) => option !== 'group') },
                            { name: 'required', type: 'checkbox' },
                        ] },
                ] },
            { name: 'designs', type: 'join', collection: slugs.blockDesigns, on: 'blockType', admin: { defaultColumns: ['name', 'status', '_status'] } },
        ],
    };
    const blockDesigns = {
        ...common,
        slug: slugs.blockDesigns,
        labels: { singular: 'Block Design', plural: 'Design Variants' },
        admin: { group: false, useAsTitle: 'name', hidden: hiddenFromEditor },
        hooks: {
            beforeChange: [async ({ data, originalDoc, req }) => {
                    if (data.status === 'archived' && originalDoc?.status === 'published' && originalDoc.id) {
                        await assertDesignCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), originalDoc.id);
                    }
                    if (data.status === 'published' && data.blockType) {
                        const type = await req.payload.findByID({ collection: slugs.blockTypes, id: typeof data.blockType === 'object' ? data.blockType.id : data.blockType, depth: 0, overrideAccess: true, req });
                        if (type.status !== 'published' || type._status !== 'published')
                            throw new Error('Publish the Block Type before publishing this design');
                    }
                    return data;
                }],
            beforeDelete: [async ({ id, req }) => assertDesignCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), id)],
            afterChange: [async ({ doc, req }) => {
                    if (doc._status === 'published' && doc.status === 'published')
                        await options.onPublish?.({ type: 'blockDesignPublished', id: doc.id, slug: doc.slug });
                    return doc;
                }],
        },
        endpoints: [{
                path: '/:id/dependencies', method: 'get',
                handler: async (req) => {
                    if ((await manage({ req })) !== true)
                        return Response.json({ error: 'Forbidden' }, { status: 403 });
                    const id = req.routeParams?.id;
                    if (typeof id !== 'string')
                        return Response.json({ error: 'Missing design ID' }, { status: 400 });
                    return Response.json(await getBlockDesignDependencies(createPayloadDependencySource(req.payload, options.contentCollections, req), id));
                },
            }],
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'slug', type: 'text', required: true, unique: true },
            { name: 'description', type: 'textarea' },
            { name: 'blockType', type: 'relationship', relationTo: slugs.blockTypes, required: true },
            { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: ['draft', 'published', 'archived'] },
            { name: 'design', type: 'group', fields: [
                    { name: 'alignment', type: 'select', options: ['left', 'center', 'right', 'start', 'end'] },
                    { name: 'tone', type: 'select', options: ['neutral', 'accent'] },
                    { name: 'width', type: 'select', options: ['content', 'wide', 'full'] },
                    { name: 'spacing', type: 'select', options: ['small', 'medium', 'large', 'extra-large', 'compact', 'normal', 'spacious'] },
                    { name: 'imageTreatment', type: 'select', options: ['background', 'split', 'feature'] },
                    { name: 'overlay', type: 'select', options: ['none', 'light', 'dark'] },
                    { name: 'textContrast', type: 'select', options: ['normal', 'light', 'dark'] },
                    { name: 'buttonStyle', type: 'select', options: ['primary', 'outline', 'minimal'] },
                ] },
            { name: 'designPreview', type: 'ui', admin: { components: { Field: '@design-system/payload-design-core/admin#BlockDesignPanel' } } },
        ],
    };
    const templates = {
        ...common,
        slug: slugs.templates,
        labels: { singular: 'Template', plural: 'Templates' },
        admin: {
            group: 'Design', useAsTitle: 'name', hidden: hiddenFromEditor, defaultColumns: ['name', 'status', 'allowedCollections', 'updatedAt'],
            components: { edit: {
                    SaveButton: '@design-system/payload-design-core/admin#TemplateActionPlaceholder',
                    SaveDraftButton: '@design-system/payload-design-core/admin#TemplateActionPlaceholder',
                    PublishButton: '@design-system/payload-design-core/admin#TemplateActionPlaceholder',
                    UnpublishButton: '@design-system/payload-design-core/admin#TemplateActionPlaceholder',
                } },
        },
        hooks: {
            beforeChange: [async ({ data, originalDoc, req }) => {
                    if (!data.slug && data.name)
                        data.slug = String(data.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    if (!data.status)
                        data.status = 'draft';
                    if (data.status === 'archived' && originalDoc?.status === 'published' && originalDoc.id) {
                        await assertTemplateCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), originalDoc.id);
                    }
                    if (Array.isArray(data.sections)) {
                        const keys = new Set();
                        for (const [index, section] of data.sections.entries()) {
                            if (!section.key && section.name) {
                                const base = String(section.name).trim().replace(/[^a-zA-Z0-9]+(.)/g, (_match, next) => next.toUpperCase()).replace(/^[^a-z]+/i, '').replace(/^./, (letter) => letter.toLowerCase()) || 'section';
                                let key = base;
                                let suffix = 2;
                                while (keys.has(key))
                                    key = `${base}${suffix++}`;
                                data.sections[index].key = key;
                            }
                            if (!/^[a-z][a-zA-Z0-9]*$/.test(section.key) || keys.has(section.key))
                                throw new Error('Template section keys must be unique stable camelCase identifiers');
                            keys.add(section.key);
                            const id = typeof section.blockDesign === 'object' ? section.blockDesign.id : section.blockDesign;
                            const design = await req.payload.findByID({ collection: slugs.blockDesigns, id, depth: 0, overrideAccess: true, req });
                            const blockType = typeof section.blockType === 'object' ? section.blockType.id : section.blockType;
                            const selectedDesign = design;
                            const designType = typeof selectedDesign.blockType === 'object' && selectedDesign.blockType !== null ? selectedDesign.blockType.id : selectedDesign.blockType;
                            if (String(designType) !== String(blockType))
                                throw new Error(`Default Design for ${section.name ?? section.key} must belong to its Block Type`);
                            if (data.status === 'published' && (design.status !== 'published' || design._status !== 'published'))
                                throw new Error(`Publish the Block Design for section ${section.name ?? section.key} first`);
                        }
                    }
                    const customFieldIDs = new Set();
                    if (Array.isArray(data.customFields)) {
                        for (const field of data.customFields) {
                            if (!field.id || customFieldIDs.has(field.id))
                                throw new Error('Template Custom Field IDs must be present and unique');
                            if (!field.label?.trim())
                                throw new Error('Every Template Custom Field must have a label');
                            if (!field.fieldType)
                                throw new Error(`Choose a field type for ${field.label}`);
                            if (field.fieldType === 'select' && !field.options?.length)
                                throw new Error(`Add at least one option to ${field.label}`);
                            if (field.fieldType === 'relationship' && !field.relationTo?.trim())
                                throw new Error(`Choose a related collection for ${field.label}`);
                            customFieldIDs.add(field.id);
                        }
                    }
                    if (Array.isArray(data.layout)) {
                        const ids = new Set();
                        const fields = new Set();
                        const blocks = [];
                        walkTemplate(data.layout, (node) => {
                            if (!node.id || ids.has(node.id))
                                throw new Error('Template element IDs must be present and unique');
                            ids.add(node.id);
                            if (node.type === 'field') {
                                fields.add(node.id);
                                if (node.content?.source === 'customField' && !customFieldIDs.has(node.content.fieldId))
                                    throw new Error(`Custom Field bound to ${node.label} does not exist in this Template`);
                            }
                            if (node.type === 'block') {
                                blocks.push(node);
                            }
                            if (node.type === 'layout' && node.layout === 'columns') {
                                const width = (node.columns ?? []).reduce((sum, column) => sum + Number(column.width), 0);
                                if (!node.columns?.length || width !== 100)
                                    throw new Error('Template column widths must total 100');
                                for (const column of node.columns) {
                                    if (!column.id || ids.has(column.id))
                                        throw new Error('Template column IDs must be present and unique');
                                    ids.add(column.id);
                                }
                            }
                        });
                        for (const block of blocks) {
                            const designID = typeof block.blockDesign === 'object' ? block.blockDesign.id : block.blockDesign;
                            const blockTypeID = typeof block.blockType === 'object' ? block.blockType.id : block.blockType;
                            const design = await req.payload.findByID({ collection: slugs.blockDesigns, id: designID, depth: 0, overrideAccess: true, req });
                            const selectedType = design.blockType;
                            const designTypeID = typeof selectedType === 'object' ? selectedType.id : selectedType;
                            if (String(designTypeID) !== String(blockTypeID))
                                throw new Error(`Design for ${block.name} must belong to its Block Type`);
                            if (data.status === 'published' && (design.status !== 'published' || design._status !== 'published'))
                                throw new Error(`Publish the Block Design for ${block.name} first`);
                            for (const [slot, fieldID] of Object.entries(block.slotMappings ?? {})) {
                                if (!fields.has(fieldID))
                                    throw new Error(`Field mapped to ${slot} in ${block.name} does not exist in this Template`);
                            }
                        }
                    }
                    return data;
                }],
            beforeDelete: [async ({ id, req }) => assertTemplateCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), id)],
            afterChange: [async ({ doc }) => {
                    if (doc._status === 'published' && doc.status === 'published')
                        await options.onPublish?.({ type: 'templatePublished', id: doc.id, slug: doc.slug });
                    return doc;
                }],
        },
        endpoints: [{ path: '/:id/dependencies', method: 'get', handler: async (req) => {
                    if ((await manage({ req })) !== true)
                        return Response.json({ error: 'Forbidden' }, { status: 403 });
                    const id = req.routeParams?.id;
                    if (typeof id !== 'string')
                        return Response.json({ error: 'Missing template ID' }, { status: 400 });
                    return Response.json(await getTemplateDependencies(createPayloadDependencySource(req.payload, options.contentCollections, req), id));
                } }],
        fields: [
            { name: 'name', type: 'text', required: true, admin: { hidden: true } },
            { name: 'slug', type: 'text', required: true, unique: true, admin: { hidden: true } },
            { name: 'description', type: 'textarea', admin: { hidden: true } },
            { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: ['draft', 'published', 'archived'], admin: { hidden: true } },
            { name: 'allowedCollections', type: 'select', hasMany: true, options: options.contentCollections.map((slug) => ({ label: slug, value: slug })), admin: { hidden: true } },
            { name: 'layout', type: 'json', defaultValue: [], admin: { hidden: true } },
            { name: 'customFields', type: 'json', defaultValue: [], admin: { hidden: true } },
            { name: 'sections', type: 'array', admin: { hidden: true }, fields: [
                    { name: 'key', type: 'text', required: true },
                    { name: 'name', type: 'text', required: true },
                    { name: 'blockType', type: 'relationship', relationTo: slugs.blockTypes, required: true },
                    { name: 'blockDesign', type: 'relationship', relationTo: slugs.blockDesigns, required: true,
                        filterOptions: ({ siblingData }) => {
                            const selected = siblingData?.blockType;
                            const blockType = typeof selected === 'object' && selected !== null ? selected.id : selected;
                            return { status: { equals: 'published' }, _status: { equals: 'published' }, ...(blockType ? { blockType: { equals: blockType } } : {}) };
                        },
                        admin: { description: 'Choose a published Design belonging to the selected Block Type.' } },
                    { name: 'required', type: 'checkbox', defaultValue: false },
                    { name: 'allowDesignOverride', type: 'checkbox', defaultValue: false },
                ] },
            { name: 'templateBuilder', type: 'ui', admin: { components: { Field: { path: '@design-system/payload-design-core/admin#TemplateBuilder', clientProps: { configuredCollections: options.contentCollections, registeredRendererKeys: options.registeredRendererKeys ?? [] } } } } },
        ],
    };
    return [blockTypes, blockDesigns, templates];
}
