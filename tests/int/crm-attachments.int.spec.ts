import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { attachmentSchemaV1 } from '../../src/crm/attachment-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { OrganizationRepository } from '../../src/organizations/repository'
import { CRMAttachments } from '../../src/crm/attachments'
import { cleanCRMAttachments } from '../../src/crm/attachment-maintenance'
import type { CRMRecordLink } from '../../src/crm/record-model'
let fixture: ReturnType<typeof localD1>,
  repo: CRMAttachments,
  contact: string,
  link: CRMRecordLink,
  storage: R2Bucket
const objects = new Map<string, { bytes: Uint8Array; checksums: { sha256: ArrayBuffer } }>()
const bytes = new TextEncoder().encode('%PDF-1.7\nFictional private attachment')
let digest: string,
  failPut = false
const key = () => crypto.randomUUID()
const body = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
beforeEach(async () => {
  fixture = localD1()
  objects.clear()
  failPut = false
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'administrator'),(2,'editor');",
  )
  for (const sql of [
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...financeSchemaV1,
    ...fundraisingSchemaV1,
    ...householdSchemaV1,
    ...commitmentSchemaV1,
    ...membershipSchemaV1,
    ...opportunitySchemaV1,
    ...volunteerSchemaV1,
    ...attachmentSchemaV1,
  ])
    fixture.sqlite.exec(sql)
  fixture.sqlite.exec(
    "CREATE TABLE vc_crm_maintenance(name TEXT PRIMARY KEY,cursor TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)",
  )
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional attachment donor' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id,
  )
  link = { type: 'contact', id: contact }
  digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  storage = {
    delete: vi.fn(async (objectKey: string) => {
      objects.delete(objectKey)
    }),
    list: vi.fn(async (options: R2ListOptions) => {
      const keys = [...objects.keys()]
        .sort()
        .filter((key) => key.startsWith(options.prefix || '') && key > (options.cursor || ''))
      const page = keys.slice(0, options.limit || 100)
      return {
        objects: page.map((key) => ({ key, uploaded: new Date(Date.now() - 7200000) })),
        truncated: keys.length > page.length,
        cursor: keys.length > page.length ? page[page.length - 1] : undefined,
      }
    }),
    put: vi.fn(async (objectKey: string, value: Uint8Array, options: R2PutOptions) => {
      if (objects.has(objectKey)) return null
      const checksum = await crypto.subtle.digest('SHA-256', value)
      expect(options.sha256).toBe(digest)
      objects.set(objectKey, { bytes: value.slice(), checksums: { sha256: checksum } })
      if (failPut) {
        failPut = false
        throw new Error('Lost upload acknowledgement')
      }
      return { size: value.length, checksums: { sha256: checksum } }
    }),
    head: vi.fn(async (objectKey: string) => {
      const item = objects.get(objectKey)
      return item ? { size: item.bytes.length, checksums: item.checksums } : null
    }),
    get: vi.fn(async (objectKey: string) => {
      const item = objects.get(objectKey)
      return item
        ? {
            size: item.bytes.length,
            checksums: item.checksums,
            body: new ReadableStream({
              start(c) {
                c.enqueue(item.bytes)
                c.close()
              },
            }),
          }
        : null
    }),
  } as unknown as R2Bucket
  repo = new CRMAttachments(fixture.db, storage, 1)
})

it('expires interrupted uploads and sweeps across pages while retaining published and unknown objects', async () => {
  const published = String((await stage()).id)
  await upload(published)
  await repo.control({
    site: 'default',
    link,
    id: published,
    action: 'archive',
    expectedRevision: 2,
    operationKey: key(),
  })
  const checksum = await crypto.subtle.digest('SHA-256', bytes)
  for (let index = 0; index < 105; index++) {
    const id = String((await stage()).id)
    const objectKey = String(
      fixture.sqlite.prepare('SELECT object_key FROM vc_crm_attachments WHERE id=?').get(id)!
        .object_key,
    )
    objects.set(objectKey, { bytes, checksums: { sha256: checksum } })
  }
  const unknown = `crm/attachments/default/${key()}/${key()}`
  objects.set(unknown, { bytes, checksums: { sha256: checksum } })
  objects.set('unrelated/private-file', { bytes, checksums: { sha256: checksum } })
  const now = Date.now() + 25 * 3600000
  const first = await cleanCRMAttachments(fixture.db, storage, now)
  expect(first.expiredExamined).toBe(100)
  expect(first.more).toBe(true)
  await cleanCRMAttachments(fixture.db, storage, now)
  await cleanCRMAttachments(fixture.db, storage, now)
  expect(objects.size).toBe(3)
  expect(objects.has(unknown)).toBe(true)
  expect(objects.has('unrelated/private-file')).toBe(true)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) n FROM vc_crm_attachment_events WHERE action='expired'")
      .get()!.n,
  ).toBe(105)
  expect(
    fixture.sqlite.prepare("SELECT count(*) n FROM vc_crm_attachments WHERE state='expired'").get()!
      .n,
  ).toBe(105)
  expect(() =>
    fixture.sqlite.exec("UPDATE vc_crm_attachments SET state='staged' WHERE state='expired'"),
  ).toThrow('transition')
  expect((await repo.download({ site: 'default', link, id: published })).ok).toBe(true)
})
afterEach(() => {
  fixture.close()
  vi.restoreAllMocks()
})
const stage = (category = 'communications', operationKey = key()) =>
  repo.stage({
    site: 'default',
    link,
    operationKey,
    values: { filename: 'Fictional receipt.pdf', size: bytes.length, sha256: digest, category },
  })
const upload = (id: string, operationKey = key()) =>
  repo.upload({ site: 'default', link, id, expectedRevision: 1, operationKey, body: body() })

it('publishes one immutable private file, replays upload, and archives/restores without replacing bytes', async () => {
  const operationKey = key(),
    staged = await stage('communications', operationKey),
    id = String(staged.id)
  expect(await stage('communications', operationKey)).toEqual(staged)
  await expect(stage('finances', operationKey)).rejects.toThrow()
  const uploadKey = key(),
    result = await upload(id, uploadKey)
  expect(await upload(id, uploadKey)).toEqual(result)
  expect(objects.size).toBe(1)
  expect(storage.put).toHaveBeenCalledTimes(1)
  const page = await repo.list({ site: 'default', link })
  expect(page.docs).toHaveLength(1)
  expect(page.docs[0]).not.toHaveProperty('object_key')
  expect(page.docs[0].state).toBe('ready')
  const response = await repo.download({ site: 'default', link, id })
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  await repo.control({
    site: 'default',
    link,
    id,
    action: 'archive',
    expectedRevision: 2,
    operationKey: key(),
  })
  expect((await repo.list({ site: 'default', link })).docs).toHaveLength(0)
  expect((await repo.list({ site: 'default', link, archived: true })).docs[0].id).toBe(id)
  await expect(
    repo.control({
      site: 'default',
      link,
      id,
      action: 'restore',
      expectedRevision: 2,
      operationKey: key(),
    }),
  ).rejects.toThrow()
  await repo.control({
    site: 'default',
    link,
    id,
    action: 'restore',
    expectedRevision: 3,
    operationKey: key(),
  })
  expect((await repo.list({ site: 'default', link })).docs[0].revision).toBe(4)
  expect(objects.size).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_attachment_events').get()!.n).toBe(4)
  expect(() => fixture.sqlite.exec("UPDATE vc_crm_attachments SET category='finances'")).toThrow(
    'immutable',
  )
  expect(() => fixture.sqlite.exec('DELETE FROM vc_crm_attachments')).toThrow('retained')
})

it('hides filenames and bytes without the selected category and current chapter record access', async () => {
  const financial = String((await stage('finances')).id),
    ordinary = String((await stage()).id)
  await upload(financial)
  await upload(ordinary)
  const authority = new OrganizationRepository(fixture.db, 1)
  const revision = () =>
    Number(
      fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
    )
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'reader',
    active: true,
    expectedRevision: revision(),
    operationKey: key(),
  })
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const reader = new CRMAttachments(fixture.db, storage, 2)
  expect((await reader.list({ site: 'default', link })).docs.map((d) => d.id)).toEqual([ordinary])
  await expect(reader.download({ site: 'default', link, id: financial })).rejects.toThrow()
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
    .run(contact)
  await expect(repo.list({ site: 'default', link })).rejects.toThrow()
  await expect(repo.download({ site: 'default', link, id: ordinary })).rejects.toThrow()
})

it('recovers a lost R2 acknowledgement without overwriting or duplicating publication', async () => {
  const id = String((await stage()).id),
    uploadKey = key()
  failPut = true
  await expect(upload(id, uploadKey)).rejects.toThrow('Lost upload acknowledgement')
  expect(objects.size).toBe(1)
  expect(fixture.sqlite.prepare('SELECT state FROM vc_crm_attachments').get()!.state).toBe('staged')
  await upload(id, uploadKey)
  expect(objects.size).toBe(1)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) n FROM vc_crm_attachment_events WHERE action='uploaded'")
      .get()!.n,
  ).toBe(1)
})

it('paginates every authorized pending upload without duplicate rows', async () => {
  for (let i = 0; i < 65; i++) await stage()
  const first = await repo.list({ site: 'default', link })
  expect(first.docs).toHaveLength(50)
  expect(first.next).not.toBeNull()
  const second = await repo.list({
    site: 'default',
    link,
    beforeDate: first.next!.date,
    beforeID: first.next!.id,
  })
  expect(second.docs).toHaveLength(15)
  expect(second.next).toBeNull()
  expect(new Set([...first.docs, ...second.docs].map((row) => row.id)).size).toBe(65)
  await expect(repo.list({ site: 'default', link, beforeDate: '2026-01' })).rejects.toThrow()
})

it('cancels the private object stream when access is revoked during storage lookup', async () => {
  const id = String((await stage()).id)
  await upload(id)
  const original = storage.get.bind(storage)
  let cancelled = false
  vi.spyOn(storage, 'get').mockImplementationOnce(async (objectKey) => {
    const object = await original(objectKey)
    if (!object || !('body' in object)) throw new Error('Fixture object is required.')
    const cancel = object.body.cancel.bind(object.body)
    vi.spyOn(object.body, 'cancel').mockImplementation(async (reason) => {
      cancelled = true
      await cancel(reason)
    })
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(contact)
    return object
  })
  await expect(repo.download({ site: 'default', link, id })).rejects.toThrow()
  expect(cancelled).toBe(true)
})

it('rejects corrupted bytes and rolls back publication after a concurrent affiliation revocation', async () => {
  const id = String((await stage()).id)
  await expect(
    repo.upload({
      site: 'default',
      link,
      id,
      expectedRevision: 1,
      operationKey: key(),
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(bytes.length))
          c.close()
        },
      }),
    }),
  ).rejects.toThrow()
  expect(objects.size).toBe(0)
  const batch = fixture.db.batch.bind(fixture.db)
  vi.spyOn(fixture.db, 'batch').mockImplementationOnce(async (statements) => {
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(contact)
    return batch(statements)
  })
  await expect(upload(id)).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT state FROM vc_crm_attachments').get()!.state).toBe('staged')
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) n FROM vc_crm_attachment_events WHERE action='uploaded'")
      .get()!.n,
  ).toBe(0)
  // Unpublished bytes are retained for bounded maintenance; deleting here could race a committed retry.
  expect(objects.size).toBe(1)
})
