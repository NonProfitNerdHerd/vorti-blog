import { describe, expect, it } from 'vitest'
import { permitsInternalRead, type PublishingReader, type PublishingRecord } from '@/publishing/readership'

const record: PublishingRecord = { audience: 'intranet', tenant: 'tenant', site: 'site', owner: 1, readership: 'site', people: [], groups: [] }
const reader: PublishingReader = { id: 2, tenant: 'tenant', site: 'site', active: true, permitted: true, tenantAdministrator: false, groups: new Set() }
describe('unified internal readership', () => {
  it('allows permitted active site members and denies anonymous, inactive, foreign and unpermitted readers', () => {
    expect(permitsInternalRead(reader, record).allowed).toBe(true)
    for (const value of [null, { ...reader, active: false }, { ...reader, permitted: false }, { ...reader, tenant: 'foreign' }, { ...reader, site: 'other' }])
      expect(permitsInternalRead(value, record).allowed).toBe(false)
  })
  it('keeps empty restrictions closed, while allowing owner, named people and current groups', () => {
    const restricted = { ...record, readership: 'restricted' as const }
    expect(permitsInternalRead(reader, restricted).allowed).toBe(false)
    expect(permitsInternalRead({ ...reader, id: 1 }, restricted).allowed).toBe(true)
    expect(permitsInternalRead(reader, { ...restricted, people: [2] }).allowed).toBe(true)
    expect(permitsInternalRead({ ...reader, groups: new Set(['team']) }, { ...restricted, groups: ['team'] }).allowed).toBe(true)
    expect(permitsInternalRead(reader, { ...restricted, groups: ['team'] }).allowed).toBe(false)
  })
  it('requires access to every ancestor and rejects foreign or public ancestors', () => {
    expect(permitsInternalRead(reader, record, [{ ...record, readership: 'restricted' }]).allowed).toBe(false)
    expect(permitsInternalRead(reader, record, [{ ...record, audience: 'public' }]).allowed).toBe(false)
    expect(permitsInternalRead(reader, record, [{ ...record, tenant: 'foreign' }]).allowed).toBe(false)
  })
  it('identifies the audited tenant-administrator exception without bypassing tenant or account boundaries', () => {
    const administrator = { ...reader, tenantAdministrator: true }
    expect(permitsInternalRead(administrator, { ...record, readership: 'restricted' })).toEqual({ allowed: true, administratorException: true })
    expect(permitsInternalRead({ ...administrator, tenant: 'foreign' }, record).allowed).toBe(false)
    expect(permitsInternalRead({ ...administrator, active: false }, record).allowed).toBe(false)
  })
})
