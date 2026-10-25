import { expect, it } from 'vitest'
import {
  importDomain,
  importDomains,
  importFields,
  importMapping,
  importHeadersMatch,
  importSourceSystem,
  mapImportRow,
} from '../../src/crm/import-model'

const mapping = () =>
  importMapping({
    version: 1,
    domain: 'contacts',
    headers: ['Name', 'Email', 'Phone'],
    columns: [
      { field: 'firstName', column: 0, clearBlank: false, referenceMode: 'record' },
      { field: 'email', column: 1, clearBlank: false, referenceMode: 'record' },
      { field: 'phone', column: 2, clearBlank: true, referenceMode: 'record' },
    ],
  })
it('covers every requested import section with explicit private domain categories and unique allowed fields', () => {
  expect(Object.keys(importDomains)).toEqual([
    'contacts',
    'households',
    'household-members',
    'relationships',
    'gifts',
    'memberships',
    'volunteer-profiles',
    'volunteer-activities',
    'volunteer-participation',
    'volunteer-hours',
  ])
  for (const domain of Object.keys(importDomains)) {
    const fields = importFields(importDomain(domain))
    expect(new Set(fields.map((f) => f.id)).size).toBe(fields.length)
    expect(fields.slice(0, 2).map((f) => f.id)).toEqual(['sourceID', 'recordID'])
  }
  for (const invalid of ['__proto__', 'constructor', 'exports', null])
    expect(() => importDomain(invalid)).toThrow()
})
it('preserves blank and absent columns by default and clears only explicitly selected present blanks', () => {
  const result = mapImportRow(
    { number: 2, values: [' Fictional name ', '', ''], issues: [] },
    mapping(),
  )
  expect({ ...result.values }).toEqual({
    firstName: { value: ' Fictional name ', clear: false, referenceMode: 'record' },
    phone: { value: '', clear: true, referenceMode: 'record' },
  })
  expect(
    mapImportRow({ number: 3, values: ['Fictional other'], issues: [] }, mapping()).values.phone,
  ).toBeUndefined()
})
it('retains exact text and constants and resolves linked source identifiers only when explicitly configured', () => {
  const map = importMapping({
    version: 1,
    domain: 'gifts',
    headers: ['Donor', 'Amount'],
    columns: [
      { field: 'contact', column: 0, clearBlank: false, referenceMode: 'source' },
      { field: 'amount', column: 1, clearBlank: false, referenceMode: 'record' },
      { field: 'currency', value: 'USD', clearBlank: false, referenceMode: 'record' },
    ],
  })
  const result = mapImportRow(
    { number: 2, values: ['000123', '900719925474099.31'], issues: [] },
    map,
  )
  expect(result.values.contact).toEqual({ value: '000123', clear: false, referenceMode: 'source' })
  expect(result.values.amount.value).toBe('900719925474099.31')
  expect(result.values.currency.value).toBe('USD')
})
it('requires exact saved headers including duplicate-column positions and carries only mapped cell errors into validation', () => {
  const map = mapping()
  expect(importHeadersMatch(map, ['Name', 'Email', 'Phone'])).toBe(true)
  expect(importHeadersMatch(map, ['Name', 'Phone', 'Email'])).toBe(false)
  expect(importHeadersMatch(map, ['Name', 'Email'])).toBe(false)
  const result = mapImportRow(
    {
      number: 4,
      values: ['Fictional', '', ''],
      issues: [
        { column: 0, message: 'Review source formula' },
        { column: 99, message: 'Ignored calculation' },
      ],
    },
    map,
  )
  expect(result.issues).toEqual([{ column: 0, message: 'Review source formula' }])
  const duplicate = importMapping({
    version: 1,
    domain: 'contacts',
    headers: ['Name', 'Name'],
    columns: [{ field: 'firstName', column: 1, clearBlank: false, referenceMode: 'record' }],
  })
  expect(
    mapImportRow({ number: 1, values: ['First', 'Second'], issues: [] }, duplicate).values.firstName
      .value,
  ).toBe('Second')
})
it('rejects unknown, duplicate, ambiguous or out-of-range mappings and never clears source lineage', () => {
  const map = mapping(),
    first = map.columns[0]
  for (const column of [
    { ...first, field: '__proto__' },
    { ...first, column: 3 },
    { ...first, column: -1 },
    { ...first, value: 'both' },
    { ...first, referenceMode: 'source' },
    { ...first, clearBlank: undefined },
    { ...first, field: 'sourceID', clearBlank: true },
  ])
    expect(() => importMapping({ ...map, columns: [column] })).toThrow()
  expect(() => importMapping({ ...map, columns: [first, first] })).toThrow()
  expect(() => importMapping({ ...map, version: 3 })).toThrow()
})
it('requires a stable canonical source-system name and rejects control characters', () => {
  expect(importSourceSystem('  Old CRM  ')).toBe('Old CRM')
  expect(importSourceSystem('Cafe\u0301')).toBe('Café')
  for (const value of ['', 'x'.repeat(121), 'bad\nnamespace', null])
    expect(() => importSourceSystem(value)).toThrow()
})

it('translates exact legacy values, flags unknown codes, preserves blanks and retains exact text', () => {
  const map = importMapping({
    version: 2,
    domain: 'gifts',
    headers: ['Fund'],
    columns: [
      {
        field: 'fund',
        column: 0,
        clearBlank: false,
        referenceMode: 'record',
        translations: [
          { source: 'ANNUAL', value: 'annual-fund' },
          { source: '__proto__', value: 'special-fund' },
        ],
        unmatched: 'error',
      },
    ],
  })
  expect(map.version).toBe(2)
  expect(mapImportRow({ number: 2, values: ['ANNUAL'], issues: [] }, map).values.fund.value).toBe(
    'annual-fund',
  )
  const missing = mapImportRow({ number: 3, values: ['annual'], issues: [] }, map)
  expect(missing.values.fund).toBeUndefined()
  expect(missing.issues[0].field).toBe('fund')
  expect(mapImportRow({ number: 4, values: [''], issues: [] }, map).values.fund).toBeUndefined()
  expect(mapImportRow({ number: 5, values: [], issues: [] }, map).values.fund).toBeUndefined()
  const special = mapImportRow({ number: 6, values: ['__proto__'], issues: [] }, map)
  expect(Object.getPrototypeOf(special.values)).toBeNull()
  expect(special.values.fund.value).toBe('special-fund')
  const passthrough = importMapping({
    ...map,
    columns: [{ ...map.columns[0], unmatched: 'source' }],
  })
  expect(
    mapImportRow({ number: 7, values: ['existing-id'], issues: [] }, passthrough).values.fund.value,
  ).toBe('existing-id')
  const clear = importMapping({ ...map, columns: [{ ...map.columns[0], clearBlank: true }] })
  expect(mapImportRow({ number: 8, values: [''], issues: [] }, clear).values.fund.clear).toBe(true)
})

it('rejects ambiguous translations and translating lineage identifiers while retaining old mappings', () => {
  const old = mapping()
  expect(importMapping(old)).toEqual(old)
  const column = {
    field: 'firstName',
    column: 0,
    clearBlank: false,
    referenceMode: 'record',
    translations: [{ source: 'OLD', value: 'New' }],
    unmatched: 'error',
  }
  for (const invalid of [
    { ...column, field: 'sourceID' },
    { ...column, field: 'recordID' },
    { ...column, translations: [{ source: 'OLD', value: '' }] },
    {
      ...column,
      translations: [
        { source: 'OLD', value: 'New' },
        { source: 'OLD', value: 'Other' },
      ],
    },
    { ...column, unmatched: 'guess' },
    {
      field: column.field,
      value: 'fixed',
      clearBlank: false,
      referenceMode: 'record',
      translations: column.translations,
      unmatched: 'error',
    },
  ])
    expect(() => importMapping({ ...old, version: 2, columns: [invalid] })).toThrow()
  expect(() => importMapping({ ...old, columns: [column] })).toThrow('version 2')
})
