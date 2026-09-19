import { createDesignCollections } from './collections.js';
import { createBlockRegistry } from './registry.js';
import { slugs } from './types.js';
import { validateTemplatedContent } from './validation.js';
import { createPayloadDesignStore } from './payload-store.js';
export function designSystemPlugin(options = {}) {
    if (options.templates === true && options.blockCreator === false)
        throw new Error('Templates require Block Creator');
    createBlockRegistry(options.blockPacks);
    return (config) => {
        if (options.enabled === false)
            return config;
        const contentCollections = options.templatableCollections ?? [];
        const existing = new Set(config.collections?.map((collection) => collection.slug));
        for (const slug of contentCollections)
            if (!existing.has(slug))
                throw new Error(`Unknown templatable collection: ${slug}`);
        const added = createDesignCollections({ contentCollections, canManage: options.canManage, isDesignManager: options.isDesignManager, onPublish: options.onPublish });
        const collections = [...(config.collections ?? []), ...added.filter((collection) => collection.slug === slugs.blockTypes ||
                (options.blockCreator !== false && collection.slug === slugs.blockDesigns) ||
                (options.templates !== false && collection.slug === slugs.templates))];
        for (const collection of collections) {
            if (!contentCollections.includes(collection.slug))
                continue;
            collection.fields = [...collection.fields,
                { name: 'designTemplate', label: 'Template', type: 'relationship', relationTo: slugs.templates,
                    filterOptions: { status: { equals: 'published' }, _status: { equals: 'published' }, allowedCollections: { contains: collection.slug } } },
                { name: 'templateValues', type: 'json', admin: { components: { Field: '@design-system/payload-design-core/admin#TemplateContentEditor' } } },
                { name: 'designOverrides', type: 'json', defaultValue: {}, hooks: { afterRead: [({ value }) => value ?? {}] }, admin: { hidden: true } },];
            collection.hooks = {
                ...collection.hooks,
                beforeChange: [
                    ...(collection.hooks?.beforeChange ?? []),
                    async ({ data, originalDoc, req }) => {
                        const incomingValues = data.templateValues;
                        // The Admin transports override edits with values; normalize before validation/storage.
                        if (incomingValues?.__designOverrides && typeof incomingValues.__designOverrides === 'object') {
                            data.designOverrides = { ...(originalDoc?.designOverrides ?? {}), ...(data.designOverrides ?? {}), ...incomingValues.__designOverrides };
                            const { __designOverrides, ...contentValues } = incomingValues;
                            data.templateValues = contentValues;
                        }
                        const reference = data.designTemplate ?? originalDoc?.designTemplate;
                        const template = typeof reference === 'object' && reference !== null ? reference.id : reference;
                        if (!template)
                            return data;
                        const selectedTemplate = await req.payload.findByID({ collection: slugs.templates, id: template, depth: 0, overrideAccess: true, req });
                        if (!selectedTemplate.allowedCollections?.includes(collection.slug))
                            throw new Error(`Template is not allowed for ${collection.slug}`);
                        const issues = await validateTemplatedContent(createPayloadDesignStore(req.payload, req), {
                            id: originalDoc?.id ?? 'new', template,
                            templateValues: data.templateValues ?? originalDoc?.templateValues ?? {},
                            designOverrides: data.designOverrides ?? originalDoc?.designOverrides ?? {},
                        });
                        if (issues.length && data._status !== 'draft')
                            throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
                        return data;
                    },
                ],
            };
        }
        return { ...config, collections };
    };
}
