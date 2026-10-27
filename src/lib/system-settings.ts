import { cache } from 'react'
import type { Payload, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'

/** Request-scoped only: a saved switch must take effect without restarting a Worker. */
export const readCategoriesEnabled = cache(async (payload: Payload, user?: PayloadRequest['user']): Promise<boolean> => {
  const settings = await payload.findGlobal({
    slug: 'system-settings',
    depth: 0,
    overrideAccess: false,
    user,
  })
  return settings.categoriesEnabled !== false
})

export async function categoriesEnabledForRequest(req: PayloadRequest): Promise<boolean> {
  const key = 'systemCategoriesEnabled'
  const cached = req.context[key] as Promise<boolean> | boolean | undefined
  if (cached !== undefined) return cached
  // Payload initializes a Local API request in place. A nested read must not
  // replace the outer mutation's context while its access predicate is running.
  const pending = req.payload.findGlobal({
    slug: 'system-settings', depth: 0, overrideAccess: false,
    req: { ...req, context: { ...req.context } },
  }).then(settings => settings.categoriesEnabled !== false)
  req.context[key] = pending
  return pending
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
