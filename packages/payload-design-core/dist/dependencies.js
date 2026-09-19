export async function getTemplateDependencies(source, templateId) {
    return source.contentUsingTemplate(templateId);
}
export async function getBlockDesignDependencies(source, designId) {
    const templates = await source.templatesUsingDesign(designId);
    return {
        templates,
        content: (await Promise.all(templates.map((template) => source.contentUsingTemplate(template.id)))).flat(),
    };
}
export async function assertDesignCanDelete(source, designId) {
    if ((await source.templatesUsingDesign(designId)).length)
        throw new Error('Block Design is referenced by a Template; archive or replace it first');
}
export async function assertTemplateCanDelete(source, templateId) {
    if ((await source.contentUsingTemplate(templateId)).length)
        throw new Error('Template is referenced by content; archive or replace it first');
}
