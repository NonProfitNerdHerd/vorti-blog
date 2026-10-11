export type Rule = {
  field: string
  operator: 'equals' | 'notEquals' | 'empty' | 'notEmpty' | 'contains'
  value?: string
}
export type BlockPresentation = {
  background?: { imageURL?: string; overlay?: string; opacity?: number }
  tag?: 'div' | 'section' | 'article' | 'aside' | 'figure'
  className?: string
  attributes?: Record<string, string>
  css?: string
  hidden?: Partial<Record<'desktop' | 'tablet' | 'mobile', boolean>>
  hover?: Record<string, string>
  focus?: Record<string, string>
  link?: { url?: string; newTab?: boolean; rel?: string; title?: string; lightbox?: boolean }
  condition?: { match: 'all' | 'any'; rules: Rule[]; start?: string; end?: string }
  motion?: {
    trigger: 'entrance' | 'scroll'
    x?: number
    y?: number
    scale?: number
    rotate?: number
    skew?: number
    opacity?: number
    blur?: number
    duration?: number
    delay?: number
    easing?: 'ease' | 'linear' | 'ease-in' | 'ease-out'
  }
}
export const publicDocumentFields: string[] = [
  'title',
  'slug',
  'excerpt',
  'publishedAt',
  'categories',
  'tags',
]
/** Host applications opt in additional publicly renderable fields in a shared server/admin entry. */
export function registerPublicDocumentField(path: string) {
  if (
    !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)*$/.test(path) ||
    path.split('.').some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
  )
    throw new Error('Invalid public field path.')
  if (!publicDocumentFields.includes(path)) publicDocumentFields.push(path)
}
export function readPublicDocumentField(document: Record<string, unknown>, path: string): unknown {
  if (!publicDocumentFields.includes(path)) return undefined
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      document,
    )
}
export function conditionVisible(
  condition: BlockPresentation['condition'],
  document: Record<string, unknown>,
  now = Date.now(),
) {
  if (!condition) return true
  if (condition.start && now < Date.parse(condition.start)) return false
  if (condition.end && now >= Date.parse(condition.end)) return false
  const checks = condition.rules.map((rule) => {
    if (!(publicDocumentFields as readonly string[]).includes(rule.field)) return false
    const value = readPublicDocumentField(document, rule.field)
    const empty = value == null || value === '' || (Array.isArray(value) && !value.length)
    if (rule.operator === 'empty') return empty
    if (rule.operator === 'notEmpty') return !empty
    const values = (Array.isArray(value) ? value : [value]).map((item) =>
      String(item && typeof item === 'object' ? (item as { id?: unknown }).id : (item ?? '')),
    )
    if (rule.operator === 'contains') return values.includes(rule.value ?? '')
    const equal = values.some((item) => item === rule.value)
    return rule.operator === 'notEquals' ? !equal : equal
  })
  return (
    !checks.length || (condition.match === 'any' ? checks.some(Boolean) : checks.every(Boolean))
  )
}

/** A deliberately restricted CSS grammar: declarations, &-anchored rules, and media queries. */
export function compileBlockCSS(input: string | undefined, selector: string): string {
  if (!input?.trim()) return ''
  if (
    input.length > 20000 ||
    /[<>\\]|\/\*|@import|url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i.test(
      input,
    )
  )
    throw new Error(
      'CSS contains unsupported or unsafe syntax. Use block-scoped rules without imports or URLs.',
    )
  const declarations = (body: string) =>
    body
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = /^([a-z][a-z-]*|--[a-z][\w-]*)\s*:\s*([^{};]+)$/i.exec(part)
        if (!match || /["'@]/.test(match[2]) || /!\s*important/i.test(match[2]))
          throw new Error('Invalid CSS declaration.')
        return `${match[1]}:${match[2]}`
      })
      .join(';')
  if (!input.includes('{')) return `${selector}{${declarations(input)}}`
  const parse = (source: string, nested = false): string => {
    let result = '',
      offset = 0
    while (offset < source.length) {
      if (!source.slice(offset).trim()) break
      const open = source.indexOf('{', offset)
      if (open < 0) throw new Error('Expected a CSS rule.')
      const header = source.slice(offset, open).trim()
      let depth = 1,
        close = open + 1
      for (; close < source.length && depth; close++) {
        if (source[close] === '{') depth++
        else if (source[close] === '}') depth--
      }
      if (depth) throw new Error('Unclosed CSS rule.')
      const body = source.slice(open + 1, close - 1)
      if (header.startsWith('@media')) {
        if (nested || !/^@media\s+\((?:min|max)-width:\s*\d+(?:px|rem|em)\)$/.test(header))
          throw new Error('Use a single min-width or max-width media query.')
        result += `${header}{${parse(body, true)}}`
      } else {
        const selectors = header.split(',').map((part) => part.trim())
        if (
          !selectors.every((part) => /^&(?=$|[\s.:#\[])[\w\s.:[\]="'-]*$/.test(part)) ||
          selectors.some((part) => part.includes('&', 1))
        )
          throw new Error('Every CSS selector must start with & and stay inside this block.')
        result += `${selectors.map((part) => part.replace('&', selector)).join(',')}{${declarations(body)}}`
      }
      offset = close
    }
    return result
  }
  return parse(input)
}

export function validatePresentation(value: BlockPresentation | undefined): string | undefined {
  if (!value) return
  if (typeof value !== 'object' || Array.isArray(value)) return 'Invalid block presentation.'
  for (const key of [
    'background',
    'attributes',
    'hidden',
    'hover',
    'focus',
    'link',
    'condition',
    'motion',
  ] as const) {
    const item = value[key]
    if (item !== undefined && (!item || typeof item !== 'object' || Array.isArray(item)))
      return `Invalid ${key} settings.`
  }
  for (const key of ['tag', 'className', 'css'] as const)
    if (value[key] !== undefined && typeof value[key] !== 'string') return `Invalid ${key}.`
  for (const [key, hidden] of Object.entries(value.hidden ?? {}))
    if (!['desktop', 'tablet', 'mobile'].includes(key) || typeof hidden !== 'boolean')
      return 'Invalid device visibility.'
  for (const key of ['url', 'title', 'rel'] as const)
    if (value.link?.[key] !== undefined && typeof value.link[key] !== 'string')
      return 'Invalid block link.'
  if (value.link?.url && !/^(https?:\/\/|mailto:|tel:|#|\/(?!\/))[^<>\s]*$/i.test(value.link.url))
    return 'Invalid block link URL.'
  if (value.tag && !['div', 'section', 'article', 'aside', 'figure'].includes(value.tag))
    return 'Unsupported block HTML tag.'
  if (value.className && !/^[\w\s-]+$/.test(value.className)) return 'Invalid CSS class.'
  if (value.background) {
    if (
      value.background.imageURL &&
      (!/^(https?:\/\/|\/(?!\/))/.test(value.background.imageURL) ||
        /["'<>\\\s]/.test(value.background.imageURL))
    )
      return 'Invalid background image URL.'
    if (value.background.overlay && !/^#[\da-f]{6}$/i.test(value.background.overlay))
      return 'Use a six-digit overlay color.'
    if (
      value.background.opacity !== undefined &&
      (!Number.isFinite(value.background.opacity) ||
        value.background.opacity < 0 ||
        value.background.opacity > 1)
    )
      return 'Overlay opacity must be between zero and one.'
  }
  for (const [key, attribute] of Object.entries(value.attributes ?? {})) {
    if (
      !/^(data-[a-z][\w-]*|aria-[a-z][\w-]*|title|role|lang|dir)$/.test(key) ||
      typeof attribute !== 'string'
    )
      return 'Unsupported HTML attribute.'
  }
  try {
    compileBlockCSS(value.css, '.block')
  } catch (error) {
    return (error as Error).message
  }
  const condition = value.condition
  if (condition) {
    if (typeof condition !== 'object') return 'Invalid display conditions.'
    if (
      !['all', 'any'].includes(condition.match) ||
      !Array.isArray(condition.rules) ||
      condition.rules.length > 20
    )
      return 'Invalid display conditions.'
    for (const rule of condition.rules)
      if (rule?.value !== undefined && typeof rule.value !== 'string')
        return 'Invalid display condition value.'
    for (const rule of condition.rules)
      if (
        !rule ||
        typeof rule !== 'object' ||
        !(publicDocumentFields as readonly string[]).includes(rule.field) ||
        !['equals', 'notEquals', 'empty', 'notEmpty', 'contains'].includes(rule.operator)
      )
        return 'Unsupported display condition.'
    for (const date of [condition.start, condition.end])
      if (date && (!Number.isFinite(Date.parse(date)) || !/(Z|[+-]\d\d:\d\d)$/.test(date)))
        return 'Dates must include a timezone.'
  }
  if (value.motion) {
    if (!['entrance', 'scroll'].includes(value.motion.trigger)) return 'Invalid motion trigger.'
    for (const [key, number] of Object.entries(value.motion))
      if (
        !['trigger', 'easing'].includes(key) &&
        (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 10000)
      )
        return 'Invalid motion value.'
    if (
      value.motion.easing &&
      !['ease', 'linear', 'ease-in', 'ease-out'].includes(value.motion.easing)
    )
      return 'Invalid motion easing.'
  }
}
