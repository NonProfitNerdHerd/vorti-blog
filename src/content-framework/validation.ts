import {
  validateSchedule,
  getView,
  listContentSources,
  validateContentLayout,
  type TypeField,
  type ViewConfig,
  type EventSchedule,
} from '@design-system/payload-design-core'
export const fieldKinds = [
  'text',
  'textarea',
  'richText',
  'number',
  'date',
  'boolean',
  'select',
  'media',
  'url',
  'relationship',
  'eventSchedule',
] as const
export const reservedPrefixes = [
  'admin',
  'api',
  '_next',
  'media',
  'posts',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]
export function validateFields(fields: TypeField[]) {
  if (!Array.isArray(fields) || fields.length > 100)
    throw new Error('A Post Type supports up to 100 fields')
  const ids = new Set<string>()
  for (const f of fields) {
    if (
      !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(f.id) ||
      ['__proto__', 'constructor', 'prototype'].includes(f.id) ||
      ids.has(f.id)
    )
      throw new Error('Fields need unique, stable identifiers')
    ids.add(f.id)
    if (!f.label?.trim() || !fieldKinds.includes(f.kind))
      throw new Error('Each field needs a label and supported kind')
    if (
      f.kind === 'relationship' &&
      !['posts', 'pages', 'media', 'categories', 'tags', 'saved-views'].includes(f.relationTo || '')
    )
      throw new Error('Unsupported relationship collection')
    if (f.kind === 'select' && (!f.options?.length || f.options.some((o) => typeof o !== 'string')))
      throw new Error('Selection fields need options')
  }
}
export function validateValues(
  fields: TypeField[],
  values: Record<string, unknown>,
  published: boolean,
) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('Invalid Post Type values')
  for (const f of fields) {
    const value = values[f.id]
    if (value === undefined || value === null || value === '') {
      if (published && f.required) throw new Error(`${f.label} is required`)
      continue
    }
    if (f.kind === 'eventSchedule') {
      validateSchedule(value as EventSchedule)
      continue
    }
    if (f.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new Error(`${f.label} must be a number`)
    if (
      f.kind === 'number' &&
      ((f.id === 'latitude' && Math.abs(Number(value)) > 90) ||
        (f.id === 'longitude' && Math.abs(Number(value)) > 180))
    )
      throw new Error(`${f.label} is outside the coordinate range`)
    if (f.kind === 'boolean' && typeof value !== 'boolean')
      throw new Error(`${f.label} must be true or false`)
    if (['text', 'textarea', 'date', 'url', 'select'].includes(f.kind) && typeof value !== 'string')
      throw new Error(`${f.label} must be text`)
    if (f.kind === 'date' && !Number.isFinite(Date.parse(String(value))))
      throw new Error(`${f.label} must be a date`)
    if (f.kind === 'select' && !f.options?.includes(String(value)))
      throw new Error(`${f.label} is not an allowed option`)
    if (f.kind === 'url' && !/^(https?:\/\/|\/[^/]|mailto:|tel:)/i.test(String(value)))
      throw new Error(`${f.label} must be a safe URL`)
    if (f.kind === 'richText' && (!value || typeof value !== 'object' || !('root' in value)))
      throw new Error(`${f.label} must contain rich text`)
    if (
      ['relationship', 'media'].includes(f.kind) &&
      !(typeof value === 'number' && Number.isInteger(value) && value > 0)
    )
      throw new Error(`${f.label} must reference an existing item`)
  }
}
export function validateView(config: ViewConfig) {
  if (!config || config.version !== 1 || !getView(config.layout))
    throw new Error('Select a registered layout')
  const source = listContentSources().find((s) => s.key === config.query?.source)
  if (!source) throw new Error('Select a registered content source')
  if (config.design) {
    if (Object.keys(config.design).some((key) => !['styles', 'presentation'].includes(key)))
      throw new Error('Unsupported view design property')
    const valid = validateContentLayout({
      version: 1,
      nodes: [
        {
          id: 'view-design',
          kind: 'group',
          styles: config.design.styles,
          presentation: config.design.presentation,
        },
      ],
    })
    if (valid !== true) throw new Error(valid)
  }
  if (config.timezone) new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format()
  for (const count of [
    config.columns,
    config.responsiveColumns?.tablet,
    config.responsiveColumns?.mobile,
  ])
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 6))
      throw new Error('Columns must be between 1 and 6')
  for (const length of [config.gap, config.radius, config.excerptLength])
    if (length !== undefined && (!Number.isFinite(length) || length < 0 || length > 500))
      throw new Error('Display dimensions must be between 0 and 500')
  if (getView(config.layout)?.capability === 'event' && config.query.source !== 'posts')
    throw new Error('Event displays require Posts')
  if (
    config.query.rules?.some(
      (r) =>
        !source.fields.includes(r.field) ||
        !['any', 'all', 'exclude'].includes(r.operator) ||
        !Array.isArray(r.values) ||
        r.values.length > 100,
    )
  )
    throw new Error('Unsupported query filter')
  if (
    (config.query.rules?.length || 0) > 30 ||
    [config.query.ids, config.query.excludeIDs, config.query.postTypes].some(
      (ids) =>
        ids !== undefined &&
        (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => !/^\d+$/.test(String(id)))),
    )
  )
    throw new Error('Too many query selections')
  if (
    config.query.limit !== undefined &&
    (!Number.isInteger(config.query.limit) || config.query.limit < 1 || config.query.limit > 100)
  )
    throw new Error('Items per page must be 1–100')
  for (const color of [config.background, config.color])
    if (color && !/^#[\da-f]{3,8}$/i.test(color)) throw new Error('Use a hexadecimal color')
}
