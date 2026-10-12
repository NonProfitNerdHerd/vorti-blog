export type BlockListItem = { label: string; url?: string; icon?: string }
export function blockItems(value: unknown, social = false): BlockListItem[] {
  if (Array.isArray(value)) return value as BlockListItem[]
  return String(value ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [label, url] = social ? line.split('|').map((value) => value.trim()) : [line]
      return { label, ...(url ? { url } : {}) }
    })
}
