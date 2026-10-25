import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { ImportMappings } from '../../src/crm/import-mappings'
import { OrganizationRepository } from '../../src/organizations/repository'
import { mapImportRow, type ImportMapping } from '../../src/crm/import-model'

let fixture: Awaited<ReturnType<typeof crmImportFixture>>, mappings: ImportMappings
const key = () => crypto.randomUUID()
const mapping: ImportMapping = {
  version: 1,
  domain: 'contacts',
  headers: ['External ID', 'Given name', 'Family name'],
  columns: [
    { field: 'sourceID', column: 0, clearBlank: false, referenceMode: 'record' },
    { field: 'firstName', column: 1, clearBlank: false, referenceMode: 'record' },
    { field: 'lastName', column: 2, clearBlank: true, referenceMode: 'record' },
  ],
}
const input = () => ({
  site: 'default',
  domain: 'contacts',
  name: 'Fictional legacy donor export',
  mapping,
  archived: false,
  operationKey: key(),
})
beforeEach(async () => {
  fixture = await crmImportFixture()
  mappings = new ImportMappings(fixture.db, 1)
})
afterEach(() => fixture.close())

it('saves and reloads exact mappings, retains explicit blank choices and replays without domain writes', async () => {
  const intent = input(),
    saved = await mappings.save(intent)
  expect(await mappings.save(intent)).toEqual(saved)
  const loaded = await new ImportMappings(fixture.db, 1).get(
    'default',
    'contacts',
    String(saved.id),
  )
  expect(loaded.mapping).toEqual(mapping)
  expect(
    mapImportRow({ number: 2, values: ['A', '', ''], issues: [] }, loaded.mapping).values,
  ).toEqual({
    sourceID: { value: 'A', clear: false, referenceMode: 'record' },
    lastName: { value: '', clear: true, referenceMode: 'record' },
  })
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_mappings').get()!.n).toBe(
    1,
  )
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_import_runs').get()!.n).toBe(0)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) AS n FROM vc_platform_audit WHERE record_type='crm-import-mapping'")
      .get()!.n,
  ).toBe(1)
})
it('rejects stale updates, retains archived configurations and paginates every matching mapping', async () => {
  const saved = await mappings.save(input()),
    id = String(saved.id)
  await mappings.save({
    ...input(),
    id,
    expectedRevision: 1,
    name: 'Fictional reviewed mapping',
    archived: true,
  })
  await expect(mappings.save({ ...input(), id, expectedRevision: 1 })).rejects.toThrow()
  expect((await mappings.list({ site: 'default', domain: 'contacts' })).total).toBe(0)
  expect(
    (await mappings.list({ site: 'default', domain: 'contacts', archived: true })).docs[0],
  ).toMatchObject({ id, revision: 2, archived: 1 })
  for (let i = 0; i < 53; i++) await mappings.save({ ...input(), name: `Fictional mapping ${i}` })
  const first = await mappings.list({ site: 'default', domain: 'contacts' })
  expect(first.total).toBe(53)
  expect(first.docs).toHaveLength(50)
  const second = await mappings.list({ site: 'default', domain: 'contacts', after: first.next! })
  expect(second.docs).toHaveLength(3)
  expect(new Set([...first.docs, ...second.docs].map((row) => row.id)).size).toBe(53)
  expect((await mappings.get('default', 'contacts', id)).name).toBe('Fictional reviewed mapping')
})
it('shares configuration only within authorized chapter/domain access and denies read-only writes and revoked access', async () => {
  const saved = await mappings.save(input()),
    id = String(saved.id),
    reader = new ImportMappings(fixture.db, 2)
  expect((await reader.list({ site: 'default', domain: 'contacts' })).docs[0].id).toBe(id)
  expect((await reader.list({ site: 'default', domain: 'contacts' })).canEdit).toBe(false)
  await expect(reader.save(input())).rejects.toThrow()
  const authority = new OrganizationRepository(fixture.db, 1)
  const foreign = await authority.createOrganization({
    name: 'Fictional foreign network',
    siteName: 'Other chapter',
    operationKey: key(),
  })
  expect((await mappings.list({ site: String(foreign.site), domain: 'contacts' })).total).toBe(0)
  await expect(mappings.get(String(foreign.site), 'contacts', id)).rejects.toThrow()
  await expect(mappings.get('default', 'gifts', id)).rejects.toThrow()
  const revision = Number(
    fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
  )
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'identity', operation: 'read' }],
    expectedRevision: revision,
    operationKey: key(),
  })
  await expect(reader.get('default', 'contacts', id)).rejects.toThrow()
  await expect(reader.list({ site: 'default', domain: 'contacts' })).rejects.toThrow()
})
