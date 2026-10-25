import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { correspondenceJob, privateDocumentPDF } from '../../src/crm/correspondence-job'
import { ContactRepository } from '../../src/crm/contacts'
import { CRMJobs } from '../../src/crm/jobs'
import { cleanDocumentOrphans } from '../../src/crm/document-maintenance'
import { crmJobEndpoints } from '../../src/crm/job-endpoints'
import { attachmentSchemaV1 } from '../../src/crm/attachment-schema-v1'
let fixture: ReturnType<typeof localD1>,
  jobs: CRMJobs,
  issued: { id: string; job: string },
  contact: string
const objects = new Map<
  string,
  { bytes: Uint8Array; metadata: Record<string, string>; uploaded: Date }
>()
let onPut: (() => Promise<void>) | null, onGet: (() => void) | null
const storage = {
  async put(key: string, bytes: Uint8Array, options: { customMetadata: Record<string, string> }) {
    objects.set(key, { bytes, metadata: options.customMetadata, uploaded: new Date() })
    await onPut?.()
    return { key }
  },
  async delete(key: string) {
    objects.delete(key)
  },
  async list(options: { prefix: string; limit: number; cursor?: string }) {
    const matching = [...objects]
      .filter(
        ([key]) => key.startsWith(options.prefix) && (!options.cursor || key > options.cursor),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const current = matching
      .slice(0, options.limit)
      .map(([key, object]) => ({ key, uploaded: object.uploaded }))
    return {
      objects: current,
      truncated: matching.length > options.limit,
      cursor: current[current.length - 1]?.key || '',
    }
  },
  async get(key: string) {
    const object = objects.get(key)
    onGet?.()
    return object
      ? {
          body: new Response(object.bytes).body,
          size: object.bytes.length,
          customMetadata: object.metadata,
        }
      : null
  },
} as unknown as R2Bucket
beforeEach(async () => {
  objects.clear()
  onPut = null
  onGet = null
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'administrator');",
  )
  for (const sql of [
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...crmJobSchemaV1,
    ...correspondenceSchemaV1,
    ...attachmentSchemaV1,
  ])
    fixture.sqlite.exec(sql)
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional PDF recipient' },
        roles: ['contact'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const template = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: {
          name: 'General',
          kind: 'general',
          subject: 'Thank you',
          body: 'Dear {{recipient.name}}',
        },
      })
    ).id,
  )
  const documents = new CorrespondenceDocuments(fixture.db, 1),
    request = {
      site: 'default',
      contact,
      template,
      issuedOn: '2026-10-24',
      issuerName: 'Fictional nonprofit',
      issuerAddress: '',
    }
  const preview = await documents.preview(request)
  issued = (await documents.issue({
    ...request,
    approval: preview.approval,
    operationKey: crypto.randomUUID(),
  })) as unknown as typeof issued
  jobs = new CRMJobs(fixture.db)
})
afterEach(() => {
  fixture.close()
  vi.unstubAllEnvs()
})
it('publishes one private PDF through the fenced job and re-authorizes downloads', async () => {
  const handler = correspondenceJob(fixture.db, storage)
  expect(await jobs.tick({ correspondence: handler })).toBe(true)
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(issued.job),
  ).toEqual({ status: 'completed' })
  expect(objects.size).toBe(1)
  const response = await privateDocumentPDF(fixture.db, storage, 1, 'default', issued.id)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 5))).toBe(
    '%PDF-',
  )
  await jobs.enqueue({
    actor: 1,
    site: 'default',
    kind: 'correspondence',
    payload: { document: issued.id },
    operationKey: crypto.randomUUID(),
  })
  await jobs.tick({ correspondence: handler })
  expect(objects.size).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_document_files').get()).toEqual({
    n: 1,
  })
  onGet = () => {
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(contact)
  }
  await expect(privateDocumentPDF(fixture.db, storage, 1, 'default', issued.id)).rejects.toThrow()
})
it('discards staged bytes if generation is cancelled before its checkpoint', async () => {
  onPut = async () => {
    await jobs.cancel(1, 'default', issued.job, crypto.randomUUID())
  }
  await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })
  expect(objects.size).toBe(0)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_document_files').get()).toEqual({
    n: 0,
  })
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(issued.job),
  ).toEqual({ status: 'cancelled' })
  onPut = null
  const documents = new CorrespondenceDocuments(fixture.db, 1)
  const generation = await documents.generation('default', issued.id)
  expect(generation.job?.canManage).toBe(true)
  const request = {
    site: 'default',
    document: issued.id,
    job: issued.job,
    expectedFence: generation.job!.fence,
    action: 'retry' as const,
    operationKey: crypto.randomUUID(),
  }
  await documents.controlGeneration(request)
  await documents.controlGeneration(request)
  await expect(
    documents.controlGeneration({ ...request, operationKey: crypto.randomUUID() }),
  ).rejects.toThrow()
  await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })
  expect((await documents.generation('default', issued.id)).ready).toBe(true)
})
it('discards staged bytes and fails the job when recipient access is revoked', async () => {
  onPut = async () => {
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(contact)
  }
  await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })
  expect(objects.size).toBe(0)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_document_files').get()).toEqual({
    n: 0,
  })
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(issued.job),
  ).toEqual({ status: 'failed' })
})
it('sweeps old interrupted objects across pages without deleting published, recent or live-lease files', async () => {
  await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })
  const published = [...objects.keys()][0],
    now = Date.now(),
    old = new Date(now - 7200000)
  objects.get(published)!.uploaded = old
  const liveJob = crypto.randomUUID(),
    recentKey = `crm/documents/default/${issued.id}/${crypto.randomUUID()}-1.pdf`,
    liveKey = `crm/documents/default/${issued.id}/${liveJob}-1.pdf`
  fixture.sqlite
    .prepare(
      "INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,status,fence,lease_until,next_attempt_at,created_at,updated_at) VALUES(?,'default',1,'correspondence',?,'running',1,?,?,?,?)",
    )
    .run(
      liveJob,
      JSON.stringify({ document: issued.id }),
      new Date(now + 60000).toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    )
  objects.set(liveKey, { bytes: new Uint8Array([1]), metadata: {}, uploaded: old })
  objects.set(recentKey, { bytes: new Uint8Array([1]), metadata: {}, uploaded: new Date(now) })
  for (let index = 0; index < 105; index++)
    objects.set(`crm/documents/default/${issued.id}/${crypto.randomUUID()}-1.pdf`, {
      bytes: new Uint8Array([1]),
      metadata: {},
      uploaded: old,
    })
  let removed = 0,
    more = true
  while (more) {
    const result = await cleanDocumentOrphans(fixture.db, storage, now)
    removed += result.removed
    more = result.more
  }
  expect(removed).toBe(105)
  expect([...objects.keys()].sort()).toEqual([published, liveKey, recentKey].sort())
})
it('fails unsupported PDF text once with an actionable explanation', async () => {
  await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })
  const template = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: { name: 'Unsupported text', kind: 'general', subject: 'Thanks', body: 'Hello 😀' },
      })
    ).id,
  )
  const documents = new CorrespondenceDocuments(fixture.db, 1),
    request = {
      site: 'default',
      contact,
      template,
      issuedOn: '2026-10-24',
      issuerName: 'Fictional nonprofit',
      issuerAddress: '',
    }
  const preview = await documents.preview(request),
    result = await documents.issue({
      ...request,
      approval: preview.approval,
      operationKey: crypto.randomUUID(),
    })
  await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })
  const failed = fixture.sqlite
    .prepare('SELECT status,attempts,error FROM vc_crm_jobs WHERE id=?')
    .get(String(result.job)) as { status: string; attempts: number; error: string }
  expect(failed.status).toBe('failed')
  expect(failed.attempts).toBe(1)
  expect(failed.error).toContain('Printable HTML')
  expect(await jobs.tick({ correspondence: correspondenceJob(fixture.db, storage) })).toBe(false)
})
it('authenticates scheduled processing before claiming work and processes a bounded document job', async () => {
  const secret = 'fictional-local-crm-job-token-123456789'
  vi.stubEnv('FORM_JOB_TOKEN', secret)
  const endpoint = crmJobEndpoints({ db: fixture.db, storage }, () =>
    Response.json({ message: 'Failed' }, { status: 500 }),
  )[0]
  const request = (token: string) =>
    ({ headers: new Headers({ authorization: token }) }) as PayloadRequest
  expect((await endpoint.handler(request('Bearer wrong'))).status).toBe(403)
  expect(
    (await new CorrespondenceDocuments(fixture.db, 1).generation('default', issued.id)).job?.status,
  ).toBe('pending')
  const result = await endpoint.handler(request(`Bearer ${secret}`))
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ processed: 1 })
  expect(
    (await new CorrespondenceDocuments(fixture.db, 1).generation('default', issued.id)).ready,
  ).toBe(true)
})
