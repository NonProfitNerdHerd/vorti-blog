export type Audience = 'public' | 'intranet'
export const CMS_EXPORT_WRITE = Symbol.for('vorticause.server-export-file-write')
export type Readership = 'site' | 'restricted'
export interface PublishingRecord {
  audience: Audience
  site: string
  tenant: string
  owner: number
  readership: Readership
  people: number[]
  groups: string[]
}
export interface PublishingReader {
  id: number
  site: string
  tenant: string
  active: boolean
  permitted: boolean
  tenantAdministrator: boolean
  groups: ReadonlySet<string>
}

/** Pure record policy. Server repositories supply membership and permission decisions. */
export function permitsInternalRead(
  reader: PublishingReader | null,
  record: PublishingRecord,
  ancestors: readonly PublishingRecord[] = [],
): { allowed: boolean; administratorException: boolean } {
  const denied = { allowed: false, administratorException: false }
  if (!reader || !reader.active || !reader.permitted || record.audience !== 'intranet' ||
      reader.site !== record.site || reader.tenant !== record.tenant) return denied
  if (ancestors.some(parent => parent.site !== record.site || parent.tenant !== record.tenant || parent.audience !== 'intranet')) return denied
  const records = [record, ...ancestors]
  if (records.some(item => !['site', 'restricted'].includes(item.readership))) return denied
  if (reader.tenantAdministrator) return { allowed: true, administratorException: true }
  const allowed = records.every(item => item.readership === 'site' ||
    item.owner === reader.id || item.people.includes(reader.id) ||
    item.groups.some(group => reader.groups.has(group)))
  return { allowed, administratorException: false }
}

export const CMS_AUDIENCE = Symbol.for('vorticause.server-publishing-audience')
export const CMS_PUBLIC_RENDER = Symbol.for('vorticause.server-public-render')
export const CMS_AUDIENCE_OPERATION = Symbol.for('vorticause.server-publishing-transfer')
