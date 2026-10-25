import type { InformationCategory } from '../organizations/policy'
import type { ImportTableRow } from './import-csv'

type ReferenceDomain =
  | 'contacts'
  | 'households'
  | 'relationship-types'
  | 'funds'
  | 'campaigns'
  | 'appeals'
  | 'membership-types'
  | 'memberships'
  | 'volunteer-activities'
export type ImportField = {
  id: string
  label: string
  kind: 'text' | 'date' | 'boolean' | 'integer' | 'amount' | 'list' | 'reference' | 'allocations'
  reference?: ReferenceDomain
}
const field = (id: string, label: string, kind: ImportField['kind'] = 'text'): ImportField => ({
  id,
  label,
  kind,
})
const reference = (id: string, label: string, domain: ReferenceDomain): ImportField => ({
  id,
  label,
  kind: 'reference',
  reference: domain,
})
const common = [
  field('sourceID', 'Source record identifier'),
  field('recordID', 'Existing CRM record identifier'),
]
const contact = reference('contact', 'Contact', 'contacts')
export const importDomains = {
  contacts: {
    label: 'Contacts',
    category: 'identity',
    fields: [
      field('kind', 'Person or organization'),
      field('firstName', 'First name'),
      field('lastName', 'Last name'),
      field('organizationName', 'Organization name'),
      field('preferredName', 'Preferred name'),
      field('email', 'Primary email'),
      field('phone', 'Primary phone'),
      field('addressLines', 'Address lines'),
      field('city', 'City'),
      field('region', 'State or region'),
      field('postalCode', 'Postal code'),
      field('country', 'Country'),
      field('emailAllowed', 'Email allowed', 'boolean'),
      field('phoneAllowed', 'Phone allowed', 'boolean'),
      field('mailAllowed', 'Mail allowed', 'boolean'),
      field('volunteerAllowed', 'Volunteer outreach allowed', 'boolean'),
      field('roles', 'Chapter roles', 'list'),
      field('tags', 'Chapter tags', 'list'),
    ],
  },
  households: {
    label: 'Households',
    category: 'affiliations',
    fields: [
      field('name', 'Household name'),
      field('address', 'Household address'),
      reference('primaryContact', 'Primary contact', 'contacts'),
      field('startedOn', 'Primary member start date', 'date'),
    ],
  },
  'household-members': {
    label: 'Household member history',
    category: 'affiliations',
    fields: [
      reference('household', 'Household', 'households'),
      contact,
      field('role', 'Household role'),
      field('startedOn', 'Member start date', 'date'),
      field('endedOn', 'Member end date', 'date'),
    ],
  },
  relationships: {
    label: 'Relationships',
    category: 'affiliations',
    fields: [
      reference('source', 'Source contact', 'contacts'),
      reference('target', 'Related contact', 'contacts'),
      reference('type', 'Relationship type', 'relationship-types'),
      field('startedOn', 'Relationship start date', 'date'),
      field('endedOn', 'Relationship end date', 'date'),
      field('notes', 'Relationship notes'),
    ],
  },
  gifts: {
    label: 'Recorded gifts',
    category: 'finances',
    fields: [
      contact,
      field('kind', 'Gift kind'),
      field('receivedOn', 'Received date', 'date'),
      field('amount', 'Gift amount', 'amount'),
      field('currency', 'Currency'),
      field('exponent', 'Currency decimal places', 'integer'),
      reference('fund', 'Fund', 'funds'),
      field('allocations', 'Split fund allocations', 'allocations'),
      reference('campaign', 'Campaign', 'campaigns'),
      reference('appeal', 'Appeal', 'appeals'),
      field('reference', 'Gift reference'),
      field('notes', 'Gift notes'),
    ],
  },
  memberships: {
    label: 'Membership terms',
    category: 'memberships',
    fields: [
      reference('type', 'Membership type', 'membership-types'),
      contact,
      reference('household', 'Household', 'households'),
      reference('billingContact', 'Billing contact', 'contacts'),
      field('startsOn', 'Term start date', 'date'),
      field('endsOn', 'Term end date', 'date'),
      field('cancelledOn', 'Cancellation date', 'date'),
      field('cancellationReason', 'Cancellation reason'),
      reference('renewedFrom', 'Previous membership term', 'memberships'),
    ],
  },
  'volunteer-profiles': {
    label: 'Volunteer skills and preferences',
    category: 'volunteer-experience',
    fields: [
      contact,
      field('skills', 'Skills', 'list'),
      field('interests', 'Interests', 'list'),
      field('availability', 'Availability'),
      field('doNotContact', 'Do not contact', 'boolean'),
    ],
  },
  'volunteer-activities': {
    label: 'Volunteer activities',
    category: 'restricted-activity',
    fields: [
      field('name', 'Activity name'),
      field('description', 'Description'),
      field('location', 'Location'),
      field('startsOn', 'Start date', 'date'),
      field('endsOn', 'End date', 'date'),
      field('skills', 'Skills', 'list'),
      field('state', 'Activity status'),
    ],
  },
  'volunteer-participation': {
    label: 'Volunteer participation',
    category: 'restricted-activity',
    fields: [
      contact,
      reference('activity', 'Activity', 'volunteer-activities'),
      field('state', 'Participation status'),
      field('notes', 'Participation notes'),
    ],
  },
  'volunteer-hours': {
    label: 'Volunteer hours',
    category: 'volunteer-hours',
    fields: [
      contact,
      reference('activity', 'Activity', 'volunteer-activities'),
      field('occurredOn', 'Service date', 'date'),
      field('minutes', 'Service minutes', 'integer'),
      field('state', 'Hour review status'),
      field('reason', 'Review reason'),
    ],
  },
} as const satisfies Record<
  string,
  { label: string; category: InformationCategory; fields: ImportField[] }
>
export type ImportDomain = keyof typeof importDomains
export function importDomain(value: unknown): ImportDomain {
  if (typeof value !== 'string' || !Object.hasOwn(importDomains, value))
    throw new Error('Choose a supported import section.')
  return value as ImportDomain
}
export function importFields(domain: ImportDomain): ImportField[] {
  return [...common, ...importDomains[domain].fields]
}
export type ImportColumnMapping = {
  field: string
  column?: number
  value?: string
  clearBlank: boolean
  referenceMode: 'record' | 'source'
  translations?: Array<{ source: string; value: string }>
  unmatched?: 'error' | 'source'
}
export type ImportMapping = {
  version: 1 | 2
  domain: ImportDomain
  headers: string[]
  columns: ImportColumnMapping[]
}
export function importMapping(raw: unknown): ImportMapping {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Choose a valid import mapping.')
  const value = raw as Record<string, unknown>,
    domain = importDomain(value.domain),
    fields = importFields(domain)
  if (
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.headers) ||
    !value.headers.length ||
    value.headers.length > 256 ||
    value.headers.some((h) => typeof h !== 'string' || h.length > 32768) ||
    !Array.isArray(value.columns) ||
    !value.columns.length ||
    value.columns.length > fields.length
  )
    throw new Error('Choose a complete import mapping with at most 256 source columns.')
  const headers = [...value.headers] as string[],
    seen = new Set<string>()
  const columns = value.columns.map((rawColumn) => {
    if (!rawColumn || typeof rawColumn !== 'object' || Array.isArray(rawColumn))
      throw new Error('Choose a valid mapped field.')
    const c = rawColumn as Record<string, unknown>,
      definition = fields.find((f) => f.id === c.field)
    if (
      !definition ||
      seen.has(definition.id) ||
      typeof c.clearBlank !== 'boolean' ||
      !['record', 'source'].includes(String(c.referenceMode))
    )
      throw new Error('Choose each mapped field once and an explicit blank-cell action.')
    seen.add(definition.id)
    const byColumn = c.column !== undefined,
      byValue = c.value !== undefined
    if (
      byColumn === byValue ||
      (byColumn &&
        (!Number.isInteger(c.column) ||
          Number(c.column) < 0 ||
          Number(c.column) >= headers.length)) ||
      (byValue && (typeof c.value !== 'string' || c.value.length > 32768))
    )
      throw new Error('Choose either a source column or a fixed value for each field.')
    if (c.referenceMode === 'source' && definition.kind !== 'reference')
      throw new Error('Choose source-identifier resolution only for a linked record.')
    if (c.clearBlank && ['sourceID', 'recordID'].includes(definition.id))
      throw new Error('Choose preserve for record identifiers; import lineage is retained.')
    let translations: ImportColumnMapping['translations']
    if (c.translations !== undefined || c.unmatched !== undefined) {
      if (
        value.version !== 2 ||
        !byColumn ||
        ['sourceID', 'recordID'].includes(definition.id) ||
        !Array.isArray(c.translations) ||
        !c.translations.length ||
        c.translations.length > 1000 ||
        !['error', 'source'].includes(String(c.unmatched))
      )
        throw new Error(
          'Choose version 2 source-value translations with an explicit unmatched-value action; identifiers retain their original lineage.',
        )
      const sourceValues = new Set<string>()
      translations = c.translations.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new Error('Enter valid source-value translations.')
        const pair = entry as Record<string, unknown>
        if (
          typeof pair.source !== 'string' ||
          !pair.source.trim() ||
          pair.source.length > 32768 ||
          typeof pair.value !== 'string' ||
          !pair.value.trim() ||
          pair.value.length > 32768 ||
          sourceValues.has(pair.source)
        )
          throw new Error('Enter unique nonblank original values and nonblank translated values.')
        sourceValues.add(pair.source)
        return { source: pair.source, value: pair.value }
      })
      if (new TextEncoder().encode(JSON.stringify(translations)).length > 1048576)
        throw new Error('Choose source-value translations smaller than 1 MiB.')
    }
    return {
      field: definition.id,
      ...(byColumn ? { column: Number(c.column) } : { value: c.value as string }),
      clearBlank: c.clearBlank,
      referenceMode: c.referenceMode as 'record' | 'source',
      ...(translations ? { translations, unmatched: c.unmatched as 'error' | 'source' } : {}),
    }
  })
  return { version: value.version as 1 | 2, domain, headers, columns }
}
export function importHeadersMatch(mapping: ImportMapping, headers: string[]) {
  return (
    mapping.headers.length === headers.length &&
    mapping.headers.every((value, index) => value === headers[index])
  )
}
export type MappedImportCell = { value: string; clear: boolean; referenceMode: 'record' | 'source' }
export function mapImportRow(row: ImportTableRow, mapping: ImportMapping) {
  const values: Record<string, MappedImportCell> = Object.create(null)
  const used = new Set(mapping.columns.flatMap((c) => (c.column === undefined ? [] : [c.column])))
  const issues: Array<{ column: number; field?: string; message: string }> = row.issues
    .filter((issue) => issue.column < 0 || used.has(issue.column))
    .map((issue) => ({ ...issue }))
  for (const column of mapping.columns) {
    const raw = column.column === undefined ? column.value : row.values[column.column]
    // A missing ragged CSV column is not an explicit blank cell and cannot clear data.
    if (raw === undefined) continue
    const blank = !raw.trim()
    if (blank && !column.clearBlank) continue
    let translated = raw
    if (!blank && column.translations) {
      const pair = column.translations.find((entry) => entry.source === raw)
      if (pair) translated = pair.value
      else if (column.unmatched !== 'source') {
        issues.push({
          column: column.column ?? -1,
          field: column.field,
          message:
            'Choose a translation for this source value or explicitly retain unmatched source values.',
        })
        continue
      }
    }
    values[column.field] = {
      value: blank ? '' : translated,
      clear: blank,
      referenceMode: column.referenceMode,
    }
  }
  return { number: row.number, values, issues }
}
export function importSourceSystem(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 120 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Enter a source-system name of at most 120 characters.')
  return value.normalize('NFC').trim()
}
