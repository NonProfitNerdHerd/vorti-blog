import { cache } from 'react'
import type { Payload, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'

/** Request-scoped only: a saved switch must take effect without restarting a Worker. */
export const readCategoriesEnabled = cache(async (payload: Payload): Promise<boolean> => {
  const settings = await payload.findGlobal({
    slug: 'system-settings',
    depth: 0,
    overrideAccess: false,
  })
  return settings.categoriesEnabled !== false
})

export async function categoriesEnabledForRequest(req: PayloadRequest): Promise<boolean> {
  const key = 'systemCategoriesEnabled'
  if (!req.context[key]) req.context[key] = readCategoriesEnabled(req.payload)
  return req.context[key] as Promise<boolean>
}

export function categoryIDs(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item && typeof item === 'object' ? item.id : item))
    .sort()
}

export function sameCategories(left: unknown, right: unknown) {
  return JSON.stringify(categoryIDs(left)) === JSON.stringify(categoryIDs(right))
}

export async function protectCategoryValues(
  req: PayloadRequest,
  fields: Array<{ id: string; relationTo?: string }>,
  values: Record<string, unknown>,
  previous: Record<string, unknown>,
  prefix: string,
) {
  const categoryFields = fields.filter(field => field.relationTo === 'categories')
  if (!categoryFields.length || await categoriesEnabledForRequest(req)) return
  const references = (value: unknown) => value == null || value === '' ? [] : Array.isArray(value) ? value : [value]
  for (const field of categoryFields) {
    if (!sameCategories(references(values[field.id]), references(previous[field.id])))
      throw new ValidationError({ errors: [{ path: `${prefix}.${field.id}`, message: 'Categories are disabled in Site Settings.' }] })
  }
}
