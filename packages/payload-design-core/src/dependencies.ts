import type { ID } from './types'

export type DependencySource = {
  templatesUsingDesign(id: ID): Promise<Array<{ id: ID; name: string }>>
  contentUsingTemplate(id: ID): Promise<Array<{ collection: string; id: ID; status?: string }>>
}

export async function getTemplateDependencies(source: DependencySource, templateId: ID) {
  return source.contentUsingTemplate(templateId)
}

export async function getBlockDesignDependencies(source: DependencySource, designId: ID) {
  const templates = await source.templatesUsingDesign(designId)
  return {
    templates,
    content: (await Promise.all(templates.map((template) => source.contentUsingTemplate(template.id)))).flat(),
  }
}

export async function assertDesignCanDelete(source: DependencySource, designId: ID) {
  if ((await source.templatesUsingDesign(designId)).length) throw new Error('Block Design is referenced by a Template; archive or replace it first')
}

export async function assertTemplateCanDelete(source: DependencySource, templateId: ID) {
  if ((await source.contentUsingTemplate(templateId)).length) throw new Error('Template is referenced by content; archive or replace it first')
}
